import './setup';
import { generateKeyPairSync, sign as signEd25519, KeyObject } from 'crypto';
import { ethers } from 'ethers';

type Row = Record<string, unknown>;

// Tiny in-memory stand-in for the supabase query builder: select / eq /
// maybeSingle, upsert, update and delete (awaited directly or via .select()).
const tables: Record<string, Row[]> = {
  users: [],
  wallet_mappings: [],
  address_verification_nonces: [],
};

jest.mock('../src/config/supabase', () => {
  const conflictKeys: Record<string, string[]> = {
    wallet_mappings: ['user_id', 'chain'],
    address_verification_nonces: ['user_id', 'chain'],
  };

  const pick = (row: Row, cols: string) => {
    if (cols === '*') return { ...row };
    const out: Row = {};
    for (const col of cols.split(',').map((s) => s.trim())) {
      if (col in row) out[col] = row[col];
    }
    return out;
  };

  const builderFor = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let op: 'select' | 'update' | 'delete' = 'select';
    let patch: Row = {};
    let cols = '*';

    const run = (): Row[] => {
      const hits = tables[table].filter((r) => filters.every(([c, v]) => r[c] === v));
      if (op === 'update') hits.forEach((r) => Object.assign(r, patch));
      if (op === 'delete') tables[table] = tables[table].filter((r) => !hits.includes(r));
      return hits.map((r) => pick(r, cols));
    };

    const builder: Record<string, unknown> = {
      select: (c: string = '*') => {
        cols = c;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      update: (p: Row) => {
        op = 'update';
        patch = p;
        return builder;
      },
      delete: () => {
        op = 'delete';
        return builder;
      },
      upsert: (p: Row) => {
        const keys = conflictKeys[table];
        const idx = tables[table].findIndex((r) => keys.every((k) => r[k] === p[k]));
        if (idx >= 0) tables[table][idx] = { ...tables[table][idx], ...p };
        else tables[table].push({ ...p });
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: run(), error: null }).then(resolve, reject),
    };
    return builder;
  };

  return { supabase: { from: (table: string) => builderFor(table) } };
});

import {
  buildVerificationMessage,
  createVerificationChallenge,
  verifyAddress,
  verifyChainSignature,
} from '../src/services/verificationService';
import { clearResolveCache } from '../src/services/walletService';

const OWNER = ethers.Wallet.createRandom();

const solanaKeypair = (): { address: string; privateKey: KeyObject } => {
  // Skip keys with a leading zero byte so the test doesn't depend on how the
  // encoder pads — real Solana addresses handle it via leading "1"s.
  for (;;) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url');
    if (raw[0] !== 0) return { address: ethers.encodeBase58(raw), privateKey };
  }
};

const signSolana = (privateKey: KeyObject, message: string) =>
  signEd25519(null, Buffer.from(message, 'utf8'), privateKey).toString('base64');

const mapAddress = (chain: string, address: string) =>
  tables.wallet_mappings.push({ user_id: 'u1', chain, address, verified_at: null });

beforeEach(() => {
  tables.users = [{ id: 'u1', username: 'derrick', owner_wallet: OWNER.address.toLowerCase() }];
  tables.wallet_mappings = [];
  tables.address_verification_nonces = [];
  clearResolveCache();
});

describe('buildVerificationMessage', () => {
  it('names the chain, user, address and nonce', () => {
    const message = buildVerificationMessage({
      username: 'derrick',
      chain: 'solana',
      address: 'SoLAddr',
      nonce: 'abc123',
    });
    expect(message).toBe(
      'Paytag address verification\n\nI control this Solana address and link it to @derrick.\n\nAddress: SoLAddr\nNonce: abc123',
    );
  });
});

describe('verifyChainSignature', () => {
  it('accepts an EVM signature from the address key', () => {
    const wallet = ethers.Wallet.createRandom();
    const message = 'hello paytag';
    expect(
      verifyChainSignature('ethereum', wallet.address.toLowerCase(), message, wallet.signMessageSync(message)),
    ).toBe(true);
  });

  it('rejects an EVM signature from a different key', () => {
    const wallet = ethers.Wallet.createRandom();
    const other = ethers.Wallet.createRandom();
    expect(verifyChainSignature('ethereum', wallet.address, 'hi', other.signMessageSync('hi'))).toBe(false);
  });

  it('accepts an ed25519 signature for a Solana address', () => {
    const { address, privateKey } = solanaKeypair();
    expect(verifyChainSignature('solana', address, 'hello', signSolana(privateKey, 'hello'))).toBe(true);
  });

  it('rejects a Solana signature over a different message', () => {
    const { address, privateKey } = solanaKeypair();
    expect(verifyChainSignature('solana', address, 'hello', signSolana(privateKey, 'goodbye'))).toBe(false);
  });

  it('returns false for malformed input instead of throwing', () => {
    const { address } = solanaKeypair();
    expect(verifyChainSignature('ethereum', OWNER.address, 'hi', '0xdead')).toBe(false);
    expect(verifyChainSignature('solana', address, 'hi', 'not-a-signature')).toBe(false);
    expect(verifyChainSignature('solana', '0OIl', 'hi', Buffer.alloc(64).toString('base64'))).toBe(false);
  });

  it('never verifies Bitcoin yet', () => {
    expect(verifyChainSignature('bitcoin', 'bc1qexample', 'hi', 'sig')).toBe(false);
  });
});

describe('address verification flow', () => {
  it('requires an address to be mapped for the chain', async () => {
    await expect(createVerificationChallenge(OWNER.address, 'solana')).rejects.toMatchObject({
      errorCode: 'ADDRESS_NOT_FOUND',
    });
  });

  it('does not offer Bitcoin verification yet', async () => {
    mapAddress('bitcoin', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    await expect(createVerificationChallenge(OWNER.address, 'bitcoin')).rejects.toMatchObject({
      errorCode: 'VERIFICATION_UNSUPPORTED',
    });
  });

  it('verifies an Ethereum address signed by its own key', async () => {
    const other = ethers.Wallet.createRandom();
    mapAddress('ethereum', other.address.toLowerCase());

    const challenge = await createVerificationChallenge(OWNER.address, 'ethereum');
    expect(challenge.message).toContain(`Address: ${other.address.toLowerCase()}`);

    const result = await verifyAddress(OWNER.address, 'ethereum', await other.signMessage(challenge.message));

    expect(result).toEqual({ chain: 'ethereum', verified: true, verifiedAt: expect.any(String) });
    expect(tables.wallet_mappings[0].verified_at).toBe(result.verifiedAt);
    expect(tables.address_verification_nonces).toHaveLength(0);
  });

  it('verifies a Solana address signed by its own key', async () => {
    const { address, privateKey } = solanaKeypair();
    mapAddress('solana', address);

    const { message } = await createVerificationChallenge(OWNER.address, 'solana');
    const result = await verifyAddress(OWNER.address, 'solana', signSolana(privateKey, message));

    expect(result.verified).toBe(true);
    expect(tables.wallet_mappings[0].verified_at).toEqual(expect.any(String));
  });

  it('rejects a signature from the wrong key and consumes the challenge', async () => {
    mapAddress('ethereum', ethers.Wallet.createRandom().address.toLowerCase());
    const { message } = await createVerificationChallenge(OWNER.address, 'ethereum');
    const impostor = ethers.Wallet.createRandom();

    await expect(
      verifyAddress(OWNER.address, 'ethereum', await impostor.signMessage(message)),
    ).rejects.toMatchObject({ status: 400, errorCode: 'INVALID_SIGNATURE' });

    expect(tables.wallet_mappings[0].verified_at).toBeNull();
    await expect(verifyAddress(OWNER.address, 'ethereum', '0x00')).rejects.toMatchObject({
      errorCode: 'CHALLENGE_NOT_FOUND',
    });
  });

  it('rejects an expired challenge', async () => {
    const other = ethers.Wallet.createRandom();
    mapAddress('ethereum', other.address.toLowerCase());
    const { message } = await createVerificationChallenge(OWNER.address, 'ethereum');
    tables.address_verification_nonces[0].created_at = new Date(Date.now() - 301_000).toISOString();

    await expect(
      verifyAddress(OWNER.address, 'ethereum', await other.signMessage(message)),
    ).rejects.toMatchObject({ errorCode: 'CHALLENGE_EXPIRED' });
  });

  it('refuses to verify when the address changed after the challenge', async () => {
    const original = ethers.Wallet.createRandom();
    mapAddress('ethereum', original.address.toLowerCase());
    const { message } = await createVerificationChallenge(OWNER.address, 'ethereum');
    tables.wallet_mappings[0].address = ethers.Wallet.createRandom().address.toLowerCase();

    await expect(
      verifyAddress(OWNER.address, 'ethereum', await original.signMessage(message)),
    ).rejects.toMatchObject({ errorCode: 'ADDRESS_CHANGED' });
    expect(tables.wallet_mappings[0].verified_at).toBeNull();
  });
});
