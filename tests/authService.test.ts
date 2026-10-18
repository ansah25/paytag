import './setup';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';

// In-memory auth_nonces_used table: insert (with the primary-key conflict) and delete + lt.
interface UsedRow {
  wallet_address: string;
  nonce: string;
  used_at: string;
}
const used: UsedRow[] = [];
const touchedTables = new Set<string>();

jest.mock('../src/config/supabase', () => {
  const builder = (table: string) => {
    touchedTables.add(table);
    if (table !== 'auth_nonces_used') throw new Error(`Unexpected table: ${table}`);
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
  return { supabase: { from: (table: string) => builder(table) } };
});

import { env } from '../src/config/env';
import {
  NONCE_FUTURE_TOLERANCE_SECONDS,
  createNonce,
  resetUsedNoncePrune,
  usedNonceRetentionSeconds,
  verifySignatureAndIssueToken,
  verifyToken,
  _internal,
} from '../src/services/authService';
import { BadRequestError, UnauthorizedError } from '../src/utils/errors';

const sign = (wallet: ethers.HDNodeWallet, nonce: string) => wallet.signMessage(_internal.buildSignMessage(nonce));
const at = (ms: number) => jest.spyOn(Date, 'now').mockReturnValue(ms);
// The prune runs in the background after a sign-in; let it finish before asserting on it.
const flushPrune = () => new Promise((resolve) => setImmediate(resolve));

describe('authService (stateless nonces)', () => {
  beforeEach(() => {
    used.length = 0;
    touchedTables.clear();
    resetUsedNoncePrune();
    jest.restoreAllMocks();
  });

  it('createNonce rejects invalid addresses, including ICAP', async () => {
    await expect(createNonce('not-an-address')).rejects.toBeInstanceOf(BadRequestError);
    await expect(createNonce('XE7338O073KYGTWWZN0F2WZ0R8PX5ZPPZS')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('issues an 80-hex nonce and writes nothing', async () => {
    const nonce = await createNonce(ethers.Wallet.createRandom().address);
    expect(nonce).toMatch(/^[0-9a-f]{80}$/);
    expect(touchedTables.size).toBe(0);
  });

  it('issues a JWT for a correct signature and records the nonce as spent', async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonce = await createNonce(wallet.address);

    const { token, wallet: returned } = await verifySignatureAndIssueToken(wallet.address, await sign(wallet, nonce), nonce);

    expect(returned).toBe(wallet.address.toLowerCase());
    expect(verifyToken(token).sub).toBe(wallet.address.toLowerCase());
    expect(used).toEqual([expect.objectContaining({ wallet_address: wallet.address.toLowerCase(), nonce })]);
  });

  it('refuses a replay of a spent nonce', async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonce = await createNonce(wallet.address);
    const signature = await sign(wallet, nonce);
    await verifySignatureAndIssueToken(wallet.address, signature, nonce);
    await expect(verifySignatureAndIssueToken(wallet.address, signature, nonce)).rejects.toMatchObject({
      errorCode: 'NONCE_USED',
    });
  });

  it('lets only one of two concurrent verifies of the same signature succeed', async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonce = await createNonce(wallet.address);
    const signature = await sign(wallet, nonce);
    const results = await Promise.allSettled([
      verifySignatureAndIssueToken(wallet.address, signature, nonce),
      verifySignatureAndIssueToken(wallet.address, signature, nonce),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('has no per-wallet state to evict: any number of newer nonces leaves an earlier one valid', async () => {
    const wallet = ethers.Wallet.createRandom();
    const mine = await createNonce(wallet.address);
    const signature = await sign(wallet, mine);
    for (let i = 0; i < 100; i++) await createNonce(wallet.address); // an attacker hammering the wallet
    await expect(verifySignatureAndIssueToken(wallet.address, signature, mine)).resolves.toBeDefined();
  });

  it('builds the checked message only from an authenticated nonce: body nonce A with a signature over B is refused', async () => {
    const wallet = ethers.Wallet.createRandom();
    const a = await createNonce(wallet.address);
    const b = await createNonce(wallet.address);
    await expect(verifySignatureAndIssueToken(wallet.address, await sign(wallet, b), a)).rejects.toMatchObject({
      errorCode: 'INVALID_SIGNATURE',
    });
    expect(used).toHaveLength(0); // nothing spent by the failed attempt
  });

  it('refuses a nonce issued for another wallet (the MAC binds the wallet)', async () => {
    const victim = ethers.Wallet.createRandom();
    const attacker = ethers.Wallet.createRandom();
    const nonceForVictim = await createNonce(victim.address);
    await expect(
      verifySignatureAndIssueToken(attacker.address, await sign(attacker, nonceForVictim), nonceForVictim),
    ).rejects.toMatchObject({ errorCode: 'NONCE_INVALID' });
  });

  it('refuses a tampered or forged nonce, even with a valid signature over it', async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonce = await createNonce(wallet.address);
    const flipped = nonce.slice(0, 20) + (nonce[20] === 'a' ? 'b' : 'a') + nonce.slice(21);
    const forged = 'ab'.repeat(40);
    for (const bad of [flipped, forged]) {
      await expect(verifySignatureAndIssueToken(wallet.address, await sign(wallet, bad), bad)).rejects.toMatchObject({
        errorCode: 'NONCE_INVALID',
      });
    }
  });

  it("doesn't spend the nonce on a bad signature", async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonce = await createNonce(wallet.address);
    await expect(
      verifySignatureAndIssueToken(wallet.address, await sign(ethers.Wallet.createRandom(), nonce), nonce),
    ).rejects.toMatchObject({ errorCode: 'INVALID_SIGNATURE' });
    await expect(verifySignatureAndIssueToken(wallet.address, await sign(wallet, nonce), nonce)).resolves.toBeDefined();
  });

  it('refuses an expired nonce', async () => {
    const wallet = ethers.Wallet.createRandom();
    const t0 = Date.now();
    at(t0);
    const nonce = await createNonce(wallet.address);
    const signature = await sign(wallet, nonce);
    at(t0 + (env.NONCE_TTL_SECONDS + 2) * 1000);
    await expect(verifySignatureAndIssueToken(wallet.address, signature, nonce)).rejects.toMatchObject({
      errorCode: 'NONCE_EXPIRED',
    });
  });

  it('refuses a nonce dated beyond the future tolerance, and accepts one within it', async () => {
    const wallet = ethers.Wallet.createRandom();
    const t0 = Date.now();

    at(t0 + (NONCE_FUTURE_TOLERANCE_SECONDS + 5) * 1000);
    const farFuture = await createNonce(wallet.address);
    at(t0);
    await expect(
      verifySignatureAndIssueToken(wallet.address, await sign(wallet, farFuture), farFuture),
    ).rejects.toMatchObject({ errorCode: 'NONCE_INVALID' });

    at(t0 + 5_000);
    const slightlyAhead = await createNonce(wallet.address);
    at(t0);
    await expect(
      verifySignatureAndIssueToken(wallet.address, await sign(wallet, slightlyAhead), slightlyAhead),
    ).resolves.toBeDefined();
  });

  it('answers a request without a nonce (an outdated page) with 400 CLIENT_OUTDATED', async () => {
    const wallet = ethers.Wallet.createRandom();
    await expect(verifySignatureAndIssueToken(wallet.address, '0x' + '00'.repeat(65))).rejects.toMatchObject({
      status: 400,
      errorCode: 'CLIENT_OUTDATED',
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
      const nonce = await createNonce(wallet.address);
      await verifySignatureAndIssueToken(wallet.address, await sign(wallet, nonce), nonce); // triggers the prune
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
      const nonce = await createNonce(wallet.address);
      const signature = await sign(wallet, nonce);
      at(t0);
      await verifySignatureAndIssueToken(wallet.address, signature, nonce);

      at(t0 + (NONCE_FUTURE_TOLERANCE_SECONDS + env.NONCE_TTL_SECONDS - 1) * 1000);
      resetUsedNoncePrune();
      const other = ethers.Wallet.createRandom();
      const otherNonce = await createNonce(other.address);
      await verifySignatureAndIssueToken(other.address, await sign(other, otherNonce), otherNonce);
      await flushPrune();
      expect(used.some((r) => r.nonce === nonce)).toBe(true);

      await expect(verifySignatureAndIssueToken(wallet.address, signature, nonce)).rejects.toMatchObject({
        errorCode: 'NONCE_USED',
      });
    });
  });

  it('verifyToken rejects tampered tokens', () => {
    const bad = jwt.sign({ sub: '0xabc' }, 'wrong-secret-must-be-32-chars-long-x');
    expect(() => verifyToken(bad)).toThrow(UnauthorizedError);
  });
});
