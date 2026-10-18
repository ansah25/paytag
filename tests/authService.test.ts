import './setup';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';

// In-memory auth_nonces table behind a chainable, awaitable query builder covering the calls the
// service makes: insert, select + eq/order/range/limit, delete + eq/in/lt (+ select returning).
interface NonceRow {
  wallet_address: string;
  nonce: string;
  created_at: string;
}
const rows: NonceRow[] = [];

jest.mock('../src/config/supabase', () => {
  const builder = (table: string) => {
    if (table !== 'auth_nonces') throw new Error(`Unexpected table: ${table}`);
    let mode: 'select' | 'delete' = 'select';
    let returning = false;
    const filters: ((r: NonceRow) => boolean)[] = [];
    let orderDesc = false;
    let from = 0;
    let to = Infinity;

    const matching = () => {
      let out = rows.filter((r) => filters.every((f) => f(r)));
      out = [...out].sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (orderDesc) out.reverse();
      return out.slice(from, to + 1);
    };
    const run = () => {
      if (mode === 'delete') {
        const gone = rows.filter((r) => filters.every((f) => f(r)));
        for (const r of gone) rows.splice(rows.indexOf(r), 1);
        return { data: returning ? gone.map((r) => ({ nonce: r.nonce })) : null, error: null };
      }
      return { data: matching().map(({ nonce, created_at }) => ({ nonce, created_at })), error: null };
    };

    const b: Record<string, unknown> = {
      insert: (payload: NonceRow) => {
        if (rows.some((r) => r.wallet_address === payload.wallet_address && r.nonce === payload.nonce)) {
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
        }
        rows.push({ ...payload });
        return Promise.resolve({ data: null, error: null });
      },
      select: () => {
        if (mode === 'delete') returning = true;
        return b;
      },
      delete: () => {
        mode = 'delete';
        return b;
      },
      eq: (column: keyof NonceRow, value: string) => {
        filters.push((r) => r[column] === value);
        return b;
      },
      in: (column: keyof NonceRow, values: string[]) => {
        filters.push((r) => values.includes(r[column]));
        return b;
      },
      lt: (column: keyof NonceRow, value: string) => {
        filters.push((r) => r[column] < value);
        return b;
      },
      order: (_column: string, opts: { ascending: boolean }) => {
        orderDesc = !opts.ascending;
        return b;
      },
      range: (a: number, z: number) => {
        from = a;
        to = z;
        return b;
      },
      limit: (n: number) => {
        to = from + n - 1;
        return b;
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return b;
  };
  return { supabase: { from: (table: string) => builder(table) } };
});

import {
  MAX_NONCES_PER_WALLET,
  createNonce,
  resetNonceCleanup,
  verifySignatureAndIssueToken,
  verifyToken,
  _internal,
} from '../src/services/authService';
import { BadRequestError, UnauthorizedError } from '../src/utils/errors';

const sign = (wallet: ethers.HDNodeWallet, nonce: string) => wallet.signMessage(_internal.buildSignMessage(nonce));
const rowsFor = (wallet: ethers.HDNodeWallet) => rows.filter((r) => r.wallet_address === wallet.address.toLowerCase());
const age = (nonce: string, minutes: number) => {
  const row = rows.find((r) => r.nonce === nonce)!;
  row.created_at = new Date(Date.now() - minutes * 60_000).toISOString();
};

describe('authService', () => {
  beforeEach(() => {
    rows.length = 0;
    resetNonceCleanup();
  });

  it('createNonce rejects invalid addresses', async () => {
    await expect(createNonce('not-an-address')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('issues a JWT for a correct signature over the nonce named in the request, and uses it up', async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonce = await createNonce(wallet.address);
    const signature = await sign(wallet, nonce);

    const { token, wallet: returned } = await verifySignatureAndIssueToken(wallet.address, signature, nonce);

    expect(returned).toBe(wallet.address.toLowerCase());
    expect(verifyToken(token).sub).toBe(wallet.address.toLowerCase());
    expect(rowsFor(wallet)).toHaveLength(0);
    await expect(verifySignatureAndIssueToken(wallet.address, signature, nonce)).rejects.toMatchObject({
      errorCode: 'NONCE_NOT_FOUND',
    });
  });

  it("a new nonce request doesn't invalidate one already being signed (no lockout)", async () => {
    const wallet = ethers.Wallet.createRandom();
    const mine = await createNonce(wallet.address);
    const signature = await sign(wallet, mine);
    // Someone else requests nonces for the same wallet meanwhile.
    await createNonce(wallet.address);
    await createNonce(wallet.address);

    await expect(verifySignatureAndIssueToken(wallet.address, signature, mine)).resolves.toMatchObject({
      wallet: wallet.address.toLowerCase(),
    });
  });

  it('builds the checked message from the stored row: body.nonce A with a signature over B is refused', async () => {
    const wallet = ethers.Wallet.createRandom();
    const a = await createNonce(wallet.address);
    const b = await createNonce(wallet.address);
    const signatureOverB = await sign(wallet, b);

    await expect(verifySignatureAndIssueToken(wallet.address, signatureOverB, a)).rejects.toMatchObject({
      errorCode: 'INVALID_SIGNATURE',
    });
    // Neither nonce was used up by the failed attempt.
    expect(rowsFor(wallet).map((r) => r.nonce).sort()).toEqual([a, b].sort());
  });

  it('refuses a nonce that was never issued, even with a valid signature over it', async () => {
    const wallet = ethers.Wallet.createRandom();
    await createNonce(wallet.address);
    const forged = 'ab'.repeat(16);
    await expect(
      verifySignatureAndIssueToken(wallet.address, await sign(wallet, forged), forged),
    ).rejects.toMatchObject({ errorCode: 'NONCE_NOT_FOUND' });
  });

  it("doesn't use up the nonce on a bad signature", async () => {
    const wallet = ethers.Wallet.createRandom();
    const attacker = ethers.Wallet.createRandom();
    const nonce = await createNonce(wallet.address);

    await expect(
      verifySignatureAndIssueToken(wallet.address, await sign(attacker, nonce), nonce),
    ).rejects.toMatchObject({ errorCode: 'INVALID_SIGNATURE' });
    await expect(verifySignatureAndIssueToken(wallet.address, await sign(wallet, nonce), nonce)).resolves.toBeDefined();
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
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(UnauthorizedError);
  });

  it('rejects an expired nonce', async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonce = await createNonce(wallet.address);
    age(nonce, 10);
    await expect(
      verifySignatureAndIssueToken(wallet.address, await sign(wallet, nonce), nonce),
    ).rejects.toMatchObject({ errorCode: 'NONCE_EXPIRED' });
  });

  it('rejects when no nonce was issued', async () => {
    const wallet = ethers.Wallet.createRandom();
    await expect(
      verifySignatureAndIssueToken(wallet.address, '0x' + '00'.repeat(65), 'ab'.repeat(16)),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it(`keeps at most ${MAX_NONCES_PER_WALLET} nonces per wallet, dropping the oldest`, async () => {
    const wallet = ethers.Wallet.createRandom();
    const issued: string[] = [];
    for (let i = 0; i < MAX_NONCES_PER_WALLET + 3; i++) {
      issued.push(await createNonce(wallet.address));
      // Distinct, increasing timestamps.
      rows[rows.length - 1].created_at = new Date(Date.now() - (100 - i) * 1000).toISOString();
    }
    const kept = rowsFor(wallet).map((r) => r.nonce);
    expect(kept).toHaveLength(MAX_NONCES_PER_WALLET);
    expect(kept).not.toContain(issued[0]);
    expect(kept).toContain(issued[issued.length - 1]);
  });

  it('deletes expired nonces of any wallet when issuing a new one', async () => {
    const other = ethers.Wallet.createRandom();
    const stale = await createNonce(other.address);
    age(stale, 10);
    resetNonceCleanup();
    await createNonce(ethers.Wallet.createRandom().address);
    expect(rows.find((r) => r.nonce === stale)).toBeUndefined();
  });

  describe('without a nonce in the request (pages loaded before the web app sent it)', () => {
    it('accepts a signature over any fresh nonce of the wallet', async () => {
      const wallet = ethers.Wallet.createRandom();
      const mine = await createNonce(wallet.address);
      const signature = await sign(wallet, mine);
      await createNonce(wallet.address); // a newer one doesn't lock this client out

      await expect(verifySignatureAndIssueToken(wallet.address, signature)).resolves.toBeDefined();
      expect(rows.find((r) => r.nonce === mine)).toBeUndefined();
    });

    it('still refuses another wallet’s signature and expired nonces', async () => {
      const wallet = ethers.Wallet.createRandom();
      const nonce = await createNonce(wallet.address);
      await expect(
        verifySignatureAndIssueToken(wallet.address, await sign(ethers.Wallet.createRandom(), nonce)),
      ).rejects.toMatchObject({ errorCode: 'INVALID_SIGNATURE' });
      age(nonce, 10);
      await expect(verifySignatureAndIssueToken(wallet.address, await sign(wallet, nonce))).rejects.toMatchObject({
        errorCode: 'NONCE_EXPIRED',
      });
    });
  });

  it('verifyToken rejects tampered tokens', () => {
    const bad = jwt.sign({ sub: '0xabc' }, 'wrong-secret-must-be-32-chars-long-x');
    expect(() => verifyToken(bad)).toThrow(UnauthorizedError);
  });
});
