import './setup';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';
import express from 'express';
import request from 'supertest';

// In-memory tables: auth_nonces_used (insert with the primary-key conflict, delete + lt) and
// users.session_version (select + eq + maybeSingle, update + eq + eq).
interface UsedRow {
  wallet_address: string;
  nonce: string;
  used_at: string;
}
const used: UsedRow[] = [];
const sessionVersions = new Map<string, number>(); // owner_wallet -> session_version
const touchedTables = new Set<string>();

jest.mock('../src/config/supabase', () => {
  const usedBuilder = () => {
    const filters: ((r: UsedRow) => boolean)[] = [];
    const b: Record<string, unknown> = {
      insert: (row: UsedRow) => {
        if (used.some((r) => r.wallet_address === row.wallet_address && r.nonce === row.nonce)) {
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
        }
        used.push({ ...row });
        return Promise.resolve({ data: null, error: null });
      },
      delete: () => b,
      lt: (column: keyof UsedRow, value: string) => {
        filters.push((r) => r[column] < value);
        return b;
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const gone = used.filter((r) => filters.every((f) => f(r)));
        for (const r of gone) used.splice(used.indexOf(r), 1);
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return b;
  };
  const usersBuilder = () => {
    const eqs: Record<string, unknown> = {};
    let update: { session_version: number } | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      update: (values: { session_version: number }) => {
        update = values;
        return b;
      },
      eq: (column: string, value: unknown) => {
        eqs[column] = value;
        return b;
      },
      maybeSingle: () => {
        const v = sessionVersions.get(eqs.owner_wallet as string);
        return Promise.resolve({ data: v === undefined ? null : { session_version: v }, error: null });
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const wallet = eqs.owner_wallet as string;
        if (update && sessionVersions.get(wallet) === eqs.session_version) {
          sessionVersions.set(wallet, update.session_version);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => {
        touchedTables.add(table);
        if (table === 'auth_nonces_used') return usedBuilder();
        if (table === 'users') return usersBuilder();
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
});

import { env } from '../src/config/env';
import {
  NONCE_FUTURE_TOLERANCE_SECONDS,
  SIWE_CHAIN_ID,
  buildSiweMessage,
  createNonce,
  resetUsedNoncePrune,
  revokeAllSessions,
  signSessionToken,
  usedNonceRetentionSeconds,
  verifySignatureAndIssueToken,
  verifyToken,
} from '../src/services/authService';
import { requireAuth } from '../src/middleware/auth';
import { errorHandler } from '../src/middleware/errorHandler';
import { BadRequestError, UnauthorizedError } from '../src/utils/errors';

const DOMAIN = 'www.paytag.dev';
const ORIGIN = 'https://www.paytag.dev';
const at = (ms: number) => jest.spyOn(Date, 'now').mockReturnValue(ms);
// The prune runs in the background after a sign-in; let it finish before asserting on it.
const flushPrune = () => new Promise((resolve) => setImmediate(resolve));
const issuedAtOf = (nonce: string) => parseInt(nonce.slice(0, 16), 16);

const issue = (wallet: ethers.HDNodeWallet, domain = DOMAIN) => createNonce(wallet.address, domain, `https://${domain}`);
const signIn = async (wallet: ethers.HDNodeWallet) => {
  const { nonce, message } = await issue(wallet);
  return verifySignatureAndIssueToken(wallet.address, await wallet.signMessage(message), nonce, DOMAIN, ORIGIN);
};

beforeEach(() => {
  used.length = 0;
  sessionVersions.clear();
  touchedTables.clear();
  resetUsedNoncePrune();
  jest.restoreAllMocks();
});

describe('SIWE message', () => {
  it('is an EIP-4361 message the server writes, with expiry = issuedAt + NONCE_TTL_SECONDS', async () => {
    const wallet = ethers.Wallet.createRandom();
    const t0 = Date.UTC(2026, 9, 18, 20, 0, 0);
    at(t0);
    const { nonce, message } = await issue(wallet);
    expect(message).toBe(
      [
        'www.paytag.dev wants you to sign in with your Ethereum account:',
        wallet.address, // EIP-55 checksummed
        '',
        'Sign in to Paytag.',
        '',
        'URI: https://www.paytag.dev',
        'Version: 1',
        `Chain ID: ${SIWE_CHAIN_ID}`,
        `Nonce: ${nonce}`,
        'Issued At: 2026-10-18T20:00:00.000Z',
        `Expiration Time: ${new Date(t0 + env.NONCE_TTL_SECONDS * 1000).toISOString()}`,
      ].join('\n'),
    );
  });

  it('uses http only for localhost', async () => {
    const { message } = await issue(ethers.Wallet.createRandom(), 'localhost:3002');
    expect(message).toContain('URI: http://localhost:3002');
  });
});

describe('domain and origin', () => {
  it('refuses a domain outside the allowlist', async () => {
    const wallet = ethers.Wallet.createRandom();
    await expect(createNonce(wallet.address, 'evil.example', 'https://evil.example')).rejects.toMatchObject({
      errorCode: 'DOMAIN_NOT_ALLOWED',
    });
  });

  it('refuses an allowed domain requested from another origin', async () => {
    const wallet = ethers.Wallet.createRandom();
    for (const origin of ['https://evil.example', 'https://www.paytag.dev.evil.example', 'null']) {
      await expect(createNonce(wallet.address, DOMAIN, origin)).rejects.toMatchObject({ errorCode: 'ORIGIN_MISMATCH' });
    }
  });

  it('allows a request without Origin (non-browser), the allowlist still applying', async () => {
    await expect(createNonce(ethers.Wallet.createRandom().address, DOMAIN)).resolves.toBeDefined();
  });

  it('binds the nonce to its domain: a nonce for one allowed domain fails with another', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { nonce } = await issue(wallet, 'localhost:3002');
    const forged = buildSiweMessage({ domain: DOMAIN, wallet: wallet.address, nonce, issuedAt: issuedAtOf(nonce) });
    await expect(
      verifySignatureAndIssueToken(wallet.address, await wallet.signMessage(forged), nonce, DOMAIN, ORIGIN),
    ).rejects.toMatchObject({ errorCode: 'NONCE_INVALID' });
  });

  it('checks Origin on verify too', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { nonce, message } = await issue(wallet);
    await expect(
      verifySignatureAndIssueToken(wallet.address, await wallet.signMessage(message), nonce, DOMAIN, 'https://evil.example'),
    ).rejects.toMatchObject({ errorCode: 'ORIGIN_MISMATCH' });
  });
});

describe('sign-in (stateless nonces)', () => {
  it('createNonce rejects invalid addresses, including ICAP', async () => {
    await expect(createNonce('not-an-address', DOMAIN)).rejects.toBeInstanceOf(BadRequestError);
    await expect(createNonce('XE7338O073KYGTWWZN0F2WZ0R8PX5ZPPZS', DOMAIN)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('issues an 80-hex nonce and writes nothing', async () => {
    const { nonce } = await issue(ethers.Wallet.createRandom());
    expect(nonce).toMatch(/^[0-9a-f]{80}$/);
    expect(touchedTables.size).toBe(0);
  });

  it('issues a JWT for the signed message and records the nonce as spent', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { token, wallet: returned } = await signIn(wallet);
    expect(returned).toBe(wallet.address.toLowerCase());
    expect(verifyToken(token)).toEqual({ sub: wallet.address.toLowerCase(), sv: 0 });
    expect(used).toHaveLength(1);
  });

  it('refuses a replay of a spent nonce', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { nonce, message } = await issue(wallet);
    const signature = await wallet.signMessage(message);
    await verifySignatureAndIssueToken(wallet.address, signature, nonce, DOMAIN, ORIGIN);
    await expect(verifySignatureAndIssueToken(wallet.address, signature, nonce, DOMAIN, ORIGIN)).rejects.toMatchObject({
      errorCode: 'NONCE_USED',
    });
  });

  it('lets only one of two concurrent verifies of the same signature succeed', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { nonce, message } = await issue(wallet);
    const signature = await wallet.signMessage(message);
    const results = await Promise.allSettled([
      verifySignatureAndIssueToken(wallet.address, signature, nonce, DOMAIN, ORIGIN),
      verifySignatureAndIssueToken(wallet.address, signature, nonce, DOMAIN, ORIGIN),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('has no per-wallet state to evict: any number of newer nonces leaves an earlier one valid', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { nonce, message } = await issue(wallet);
    const signature = await wallet.signMessage(message);
    for (let i = 0; i < 100; i++) await issue(wallet);
    await expect(verifySignatureAndIssueToken(wallet.address, signature, nonce, DOMAIN, ORIGIN)).resolves.toBeDefined();
  });

  it('builds the checked message only from an authenticated nonce: body nonce A with a signature over B is refused', async () => {
    const wallet = ethers.Wallet.createRandom();
    const a = await issue(wallet);
    const b = await issue(wallet);
    await expect(
      verifySignatureAndIssueToken(wallet.address, await wallet.signMessage(b.message), a.nonce, DOMAIN, ORIGIN),
    ).rejects.toMatchObject({ errorCode: 'INVALID_SIGNATURE' });
    expect(used).toHaveLength(0);
  });

  it('refuses a signature over a message the server did not write (e.g. the old plain format)', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { nonce } = await issue(wallet);
    const old = `Paytag authentication\n\nSign this message to log in.\n\nNonce: ${nonce}`;
    await expect(
      verifySignatureAndIssueToken(wallet.address, await wallet.signMessage(old), nonce, DOMAIN, ORIGIN),
    ).rejects.toMatchObject({ errorCode: 'INVALID_SIGNATURE' });
  });

  it('refuses a nonce issued for another wallet (the MAC binds the wallet)', async () => {
    const victim = ethers.Wallet.createRandom();
    const attacker = ethers.Wallet.createRandom();
    const { nonce } = await issue(victim);
    const forged = buildSiweMessage({ domain: DOMAIN, wallet: attacker.address, nonce, issuedAt: issuedAtOf(nonce) });
    await expect(
      verifySignatureAndIssueToken(attacker.address, await attacker.signMessage(forged), nonce, DOMAIN, ORIGIN),
    ).rejects.toMatchObject({ errorCode: 'NONCE_INVALID' });
  });

  it('refuses a tampered or forged nonce', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { nonce } = await issue(wallet);
    const flipped = nonce.slice(0, 20) + (nonce[20] === 'a' ? 'b' : 'a') + nonce.slice(21);
    for (const bad of [flipped, 'ab'.repeat(40)]) {
      await expect(
        verifySignatureAndIssueToken(wallet.address, '0x' + '11'.repeat(65), bad, DOMAIN, ORIGIN),
      ).rejects.toMatchObject({ errorCode: 'NONCE_INVALID' });
    }
  });

  it("doesn't spend the nonce on a bad signature", async () => {
    const wallet = ethers.Wallet.createRandom();
    const { nonce, message } = await issue(wallet);
    const other = await ethers.Wallet.createRandom().signMessage(message);
    await expect(verifySignatureAndIssueToken(wallet.address, other, nonce, DOMAIN, ORIGIN)).rejects.toMatchObject({
      errorCode: 'INVALID_SIGNATURE',
    });
    await expect(
      verifySignatureAndIssueToken(wallet.address, await wallet.signMessage(message), nonce, DOMAIN, ORIGIN),
    ).resolves.toBeDefined();
  });

  it('refuses an expired nonce', async () => {
    const wallet = ethers.Wallet.createRandom();
    const t0 = Date.now();
    at(t0);
    const { nonce, message } = await issue(wallet);
    const signature = await wallet.signMessage(message);
    at(t0 + (env.NONCE_TTL_SECONDS + 2) * 1000);
    await expect(verifySignatureAndIssueToken(wallet.address, signature, nonce, DOMAIN, ORIGIN)).rejects.toMatchObject({
      errorCode: 'NONCE_EXPIRED',
    });
  });

  it('refuses a nonce dated beyond the future tolerance, and accepts one within it', async () => {
    const wallet = ethers.Wallet.createRandom();
    const t0 = Date.now();
    at(t0 + (NONCE_FUTURE_TOLERANCE_SECONDS + 5) * 1000);
    const far = await issue(wallet);
    at(t0);
    await expect(
      verifySignatureAndIssueToken(wallet.address, await wallet.signMessage(far.message), far.nonce, DOMAIN, ORIGIN),
    ).rejects.toMatchObject({ errorCode: 'NONCE_INVALID' });

    at(t0 + 5_000);
    const near = await issue(wallet);
    at(t0);
    await expect(
      verifySignatureAndIssueToken(wallet.address, await wallet.signMessage(near.message), near.nonce, DOMAIN, ORIGIN),
    ).resolves.toBeDefined();
  });

  it('answers a request without nonce or domain (an outdated page) with 400 CLIENT_OUTDATED', async () => {
    const wallet = ethers.Wallet.createRandom();
    const { nonce } = await issue(wallet);
    await expect(verifySignatureAndIssueToken(wallet.address, '0x' + '00'.repeat(65))).rejects.toMatchObject({
      status: 400,
      errorCode: 'CLIENT_OUTDATED',
    });
    await expect(verifySignatureAndIssueToken(wallet.address, '0x' + '00'.repeat(65), nonce)).rejects.toMatchObject({
      errorCode: 'CLIENT_OUTDATED',
    });
  });
});

describe('spent-nonce retention', () => {
  it('outlives every nonce that could still be accepted (else a spent nonce becomes replayable)', () => {
    expect(usedNonceRetentionSeconds()).toBeGreaterThan(env.NONCE_TTL_SECONDS + NONCE_FUTURE_TOLERANCE_SECONDS);
    expect(usedNonceRetentionSeconds()).toBeGreaterThanOrEqual(15 * 60);
  });

  it('prunes only rows older than the retention window', async () => {
    const now = Date.now();
    used.push(
      { wallet_address: '0xold', nonce: 'a', used_at: new Date(now - (usedNonceRetentionSeconds() + 60) * 1000).toISOString() },
      { wallet_address: '0xnew', nonce: 'b', used_at: new Date(now - 60_000).toISOString() },
    );
    const wallet = ethers.Wallet.createRandom();
    await signIn(wallet);
    await flushPrune();
    expect(used.map((r) => r.wallet_address)).toEqual(['0xnew', wallet.address.toLowerCase()]);
  });

  it('still refuses a replay at the very end of the acceptance window', async () => {
    // Worst case: issued by a machine whose clock is a full tolerance ahead, spent immediately,
    // replayed at the last second it would still be accepted (issuedAt + TTL). A prune running
    // just before must keep the spent row; a retention of only the TTL would not.
    const wallet = ethers.Wallet.createRandom();
    const t0 = Date.now();
    at(t0 + NONCE_FUTURE_TOLERANCE_SECONDS * 1000);
    const { nonce, message } = await issue(wallet);
    const signature = await wallet.signMessage(message);
    at(t0);
    await verifySignatureAndIssueToken(wallet.address, signature, nonce, DOMAIN, ORIGIN);

    at(t0 + (NONCE_FUTURE_TOLERANCE_SECONDS + env.NONCE_TTL_SECONDS - 1) * 1000);
    resetUsedNoncePrune();
    await signIn(ethers.Wallet.createRandom());
    await flushPrune();
    expect(used.some((r) => r.nonce === nonce)).toBe(true);

    await expect(verifySignatureAndIssueToken(wallet.address, signature, nonce, DOMAIN, ORIGIN)).rejects.toMatchObject({
      errorCode: 'NONCE_USED',
    });
  });
});

describe('tokens and sessions', () => {
  const secret = process.env.JWT_SECRET as string;
  const app = express();
  app.get('/private', requireAuth, (req, res) => {
    res.json({ sub: req.auth?.sub });
  });
  app.use(errorHandler);
  const call = (token: string) => request(app).get('/private').set('Authorization', `Bearer ${token}`);

  it('carries the account session version, issuer and audience', async () => {
    const wallet = ethers.Wallet.createRandom();
    sessionVersions.set(wallet.address.toLowerCase(), 3);
    const { token } = await signIn(wallet);
    expect(jwt.decode(token)).toMatchObject({
      sub: wallet.address.toLowerCase(),
      sv: 3,
      iss: 'api.paytag.dev',
      aud: 'paytag-web',
    });
  });

  it('refuses tokens with a wrong issuer or audience, no version, alg none, or a wrong secret', () => {
    const sub = '0x' + '1'.repeat(40);
    const good = { issuer: 'api.paytag.dev', audience: 'paytag-web' };
    const bad = [
      jwt.sign({ sub, sv: 0 }, secret, { ...good, issuer: 'evil' }),
      jwt.sign({ sub, sv: 0 }, secret, { ...good, audience: 'other' }),
      jwt.sign({ sub }, secret, good),
      jwt.sign({ sub }, secret), // a pre-SIWE token
      jwt.sign({ sub, sv: 0 }, 'wrong-secret-must-be-32-chars-long-x', good),
      jwt.sign({ sub, sv: 0 }, '', { ...good, algorithm: 'none' }),
    ];
    for (const token of bad) expect(() => verifyToken(token)).toThrow(UnauthorizedError);
  });

  it('signs an account out everywhere: older tokens are refused, a new sign-in works', async () => {
    const wallet = ethers.Wallet.createRandom();
    const w = wallet.address.toLowerCase();
    sessionVersions.set(w, 0);
    const before = signSessionToken(w, 0);
    expect((await call(before)).status).toBe(200);

    await revokeAllSessions(w);
    expect(sessionVersions.get(w)).toBe(1);
    const refused = await call(before);
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('TOKEN_REVOKED');

    const { token: after } = await signIn(wallet);
    expect((await call(after)).status).toBe(200);
  });

  it("accepts a wallet with no account (nothing to revoke; bounded by the token's lifetime)", async () => {
    expect((await call(signSessionToken('0x' + '2'.repeat(40), 0))).status).toBe(200);
  });

  it('refuses to revoke for a wallet with no account', async () => {
    await expect(revokeAllSessions('0x' + '3'.repeat(40))).rejects.toMatchObject({ errorCode: 'USER_NOT_FOUND' });
  });
});
