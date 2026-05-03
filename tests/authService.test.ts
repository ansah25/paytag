import './setup';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';

// Mock supabase client BEFORE importing service
const nonceStore = new Map<string, { nonce: string; created_at: string }>();

jest.mock('../src/config/supabase', () => {
  const buildBuilder = (table: string) => {
    const state: { filter?: { column: string; value: string }; payload?: Record<string, unknown> } = {};
    const builder: Record<string, unknown> = {};

    builder.upsert = (payload: Record<string, unknown>) => {
      if (table === 'auth_nonces') {
        nonceStore.set(payload.wallet_address as string, {
          nonce: payload.nonce as string,
          created_at: payload.created_at as string,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };

    builder.select = (_cols?: string) => builder;
    builder.eq = (column: string, value: string) => {
      state.filter = { column, value };
      return builder;
    };
    builder.maybeSingle = () => {
      if (table === 'auth_nonces' && state.filter?.column === 'wallet_address') {
        const row = nonceStore.get(state.filter.value);
        return Promise.resolve({ data: row ?? null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    builder.delete = () => ({
      eq: (column: string, value: string) => {
        if (table === 'auth_nonces' && column === 'wallet_address') {
          nonceStore.delete(value);
        }
        return Promise.resolve({ data: null, error: null });
      },
    });
    builder.insert = (_payload: Record<string, unknown>) => ({
      select: () => ({
        single: () => Promise.resolve({ data: null, error: null }),
      }),
    });

    return builder;
  };

  return {
    supabase: {
      from: (table: string) => buildBuilder(table),
    },
  };
});

import { createNonce, verifySignatureAndIssueToken, verifyToken, _internal } from '../src/services/authService';
import { BadRequestError, UnauthorizedError } from '../src/utils/errors';

describe('authService', () => {
  beforeEach(() => {
    nonceStore.clear();
  });

  it('createNonce rejects invalid addresses', async () => {
    await expect(createNonce('not-an-address')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('createNonce stores a nonce for a valid address', async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonce = await createNonce(wallet.address);
    expect(nonce).toMatch(/^[0-9a-f]+$/);
    expect(nonceStore.get(wallet.address.toLowerCase())?.nonce).toBe(nonce);
  });

  it('verifySignatureAndIssueToken returns a valid JWT for correct signature', async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonce = await createNonce(wallet.address);
    const message = _internal.buildSignMessage(nonce);
    const signature = await wallet.signMessage(message);

    const { token, wallet: returned } = await verifySignatureAndIssueToken(
      wallet.address,
      signature,
    );

    expect(returned).toBe(wallet.address.toLowerCase());

    const payload = verifyToken(token);
    expect(payload.sub).toBe(wallet.address.toLowerCase());

    // Nonce should be consumed (single-use)
    expect(nonceStore.has(wallet.address.toLowerCase())).toBe(false);
  });

  it('rejects when no nonce was issued', async () => {
    const wallet = ethers.Wallet.createRandom();
    await expect(
      verifySignatureAndIssueToken(wallet.address, '0x' + '00'.repeat(65)),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a signature from a different wallet', async () => {
    const wallet = ethers.Wallet.createRandom();
    const attacker = ethers.Wallet.createRandom();
    const nonce = await createNonce(wallet.address);
    const signature = await attacker.signMessage(_internal.buildSignMessage(nonce));

    await expect(
      verifySignatureAndIssueToken(wallet.address, signature),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects an expired nonce', async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonce = await createNonce(wallet.address);
    const stale = nonceStore.get(wallet.address.toLowerCase())!;
    nonceStore.set(wallet.address.toLowerCase(), {
      ...stale,
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    const signature = await wallet.signMessage(_internal.buildSignMessage(nonce));

    await expect(
      verifySignatureAndIssueToken(wallet.address, signature),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('verifyToken rejects tampered tokens', () => {
    const bad = jwt.sign({ sub: '0xabc' }, 'wrong-secret-must-be-32-chars-long-x');
    expect(() => verifyToken(bad)).toThrow(UnauthorizedError);
  });
});
