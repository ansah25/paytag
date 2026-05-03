import './setup';
import { ethers } from 'ethers';

interface UserRow {
  id: string;
  username: string;
  owner_wallet: string;
}
interface MappingRow {
  user_id: string;
  chain: string;
  address: string;
}

const userStore = new Map<string, UserRow>(); // by id
const mappingStore: MappingRow[] = [];

jest.mock('../src/config/supabase', () => {
  type FilterEq = { column: string; value: string };

  const usersBuilder = () => {
    const filters: FilterEq[] = [];
    const builder: Record<string, unknown> = {};
    let nestedSelect = false;

    builder.select = (cols: string = '') => {
      nestedSelect = cols.includes('wallet_mappings');
      return builder;
    };
    builder.eq = (column: string, value: string) => {
      filters.push({ column, value });
      return builder;
    };
    builder.maybeSingle = () => {
      const match = [...userStore.values()].find((u) =>
        filters.every((f) => (u as unknown as Record<string, string>)[f.column] === f.value),
      );
      if (!match) return Promise.resolve({ data: null, error: null });
      if (nestedSelect) {
        const wallet_mappings = mappingStore
          .filter((m) => m.user_id === match.id)
          .map(({ chain, address }) => ({ chain, address }));
        return Promise.resolve({
          data: { username: match.username, wallet_mappings },
          error: null,
        });
      }
      return Promise.resolve({ data: { id: match.id }, error: null });
    };
    return builder;
  };

  const mappingsBuilder = () => {
    const builder: Record<string, unknown> = {};
    builder.upsert = (
      payload: { user_id: string; chain: string; address: string },
      _opts?: unknown,
    ) => {
      const idx = mappingStore.findIndex(
        (m) => m.user_id === payload.user_id && m.chain === payload.chain,
      );
      if (idx >= 0) mappingStore[idx] = payload;
      else mappingStore.push(payload);
      return Promise.resolve({ data: null, error: null });
    };
    return builder;
  };

  return {
    supabase: {
      from: (table: string) => {
        if (table === 'users') return usersBuilder();
        if (table === 'wallet_mappings') return mappingsBuilder();
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
});

import {
  SUPPORTED_CHAINS,
  validateChainAddress,
  addAddress,
  resolveByUsername,
} from '../src/services/walletService';
import { BadRequestError, NotFoundError } from '../src/utils/errors';

const seedUser = (id: string, username: string, ownerWallet: string) => {
  userStore.set(id, { id, username, owner_wallet: ownerWallet.toLowerCase() });
};

beforeEach(() => {
  userStore.clear();
  mappingStore.length = 0;
});

describe('walletService - chain/address validation', () => {
  it('exposes supported chains', () => {
    expect(SUPPORTED_CHAINS).toEqual(['ethereum', 'solana', 'bitcoin']);
  });

  it('rejects unsupported chains', () => {
    expect(() => validateChainAddress('dogecoin', 'D7Y55r')).toThrow(BadRequestError);
  });

  it('accepts a valid EVM address', () => {
    const wallet = ethers.Wallet.createRandom();
    expect(validateChainAddress('ethereum', wallet.address)).toBe('ethereum');
  });

  it('rejects malformed EVM address', () => {
    expect(() => validateChainAddress('ethereum', '0xnothex')).toThrow(BadRequestError);
  });

  it('accepts a valid Solana address', () => {
    expect(validateChainAddress('solana', '4Nd1mYz7K8jM2QpRzWxV3Y5tF7gH9JkLm2NoP4Qr5SsT')).toBe(
      'solana',
    );
  });

  it('rejects Solana addresses with invalid base58 chars', () => {
    expect(() => validateChainAddress('solana', '0OIl' + 'A'.repeat(36))).toThrow(BadRequestError);
  });

  it('accepts Bitcoin legacy and bech32 addresses', () => {
    expect(validateChainAddress('bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe('bitcoin');
    expect(validateChainAddress('bitcoin', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(
      'bitcoin',
    );
  });

  it('rejects garbage Bitcoin addresses', () => {
    expect(() => validateChainAddress('bitcoin', 'not-a-btc-address')).toThrow(BadRequestError);
  });
});

describe('walletService.addAddress', () => {
  it('rejects when wallet has no registered username', async () => {
    const w = ethers.Wallet.createRandom();
    await expect(
      addAddress(w.address, 'ethereum', ethers.Wallet.createRandom().address),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('inserts a new mapping and stores EVM address lowercased', async () => {
    const owner = ethers.Wallet.createRandom();
    seedUser('u1', 'derrick', owner.address);

    const target = ethers.Wallet.createRandom();
    const result = await addAddress(owner.address, 'ethereum', target.address);

    expect(result).toEqual({ chain: 'ethereum', address: target.address.toLowerCase() });
    expect(mappingStore).toHaveLength(1);
    expect(mappingStore[0].address).toBe(target.address.toLowerCase());
  });

  it('upserts (overwrites) when same chain is added twice', async () => {
    const owner = ethers.Wallet.createRandom();
    seedUser('u1', 'derrick', owner.address);

    const a = ethers.Wallet.createRandom();
    const b = ethers.Wallet.createRandom();
    await addAddress(owner.address, 'ethereum', a.address);
    await addAddress(owner.address, 'ethereum', b.address);

    expect(mappingStore).toHaveLength(1);
    expect(mappingStore[0].address).toBe(b.address.toLowerCase());
  });

  it('preserves Solana case', async () => {
    const owner = ethers.Wallet.createRandom();
    seedUser('u1', 'derrick', owner.address);

    const sol = '4Nd1mYz7K8jM2QpRzWxV3Y5tF7gH9JkLm2NoP4Qr5SsT';
    const result = await addAddress(owner.address, 'solana', sol);
    expect(result.address).toBe(sol);
  });
});

describe('walletService.resolveByUsername', () => {
  it('returns 404 for unknown username', async () => {
    await expect(resolveByUsername('ghost')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns username + addresses keyed by chain', async () => {
    seedUser('u1', 'derrick', '0xabc');
    mappingStore.push(
      { user_id: 'u1', chain: 'ethereum', address: '0xeee' },
      { user_id: 'u1', chain: 'solana', address: 'SoLAddr' },
    );

    const result = await resolveByUsername('Derrick'); // tests normalization
    expect(result).toEqual({
      username: 'derrick',
      addresses: { ethereum: '0xeee', solana: 'SoLAddr' },
    });
  });

  it('returns empty addresses object when user has no mappings', async () => {
    seedUser('u1', 'derrick', '0xabc');
    const result = await resolveByUsername('derrick');
    expect(result.addresses).toEqual({});
  });
});
