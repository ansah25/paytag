import './setup';
import { ethers } from 'ethers';

interface UserRow {
  id: string;
  username: string;
  owner_wallet: string;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
}
interface MappingRow {
  user_id: string;
  chain: string;
  address: string;
  verified_at?: string | null;
}

const userStore = new Map<string, UserRow>(); // by id
const mappingStore: MappingRow[] = [];

jest.mock('../src/config/supabase', () => {
  type FilterEq = { column: string; value: string };

  const matches = (row: object, filters: FilterEq[]) =>
    filters.every((f) => (row as Record<string, unknown>)[f.column] === f.value);

  const pick = (row: object, cols: string) => {
    const data: Record<string, unknown> = {};
    for (const col of cols.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (col in row) data[col] = (row as Record<string, unknown>)[col];
    }
    return data;
  };

  const usersBuilder = () => {
    const filters: FilterEq[] = [];
    const builder: Record<string, unknown> = {};
    let cols = '';

    builder.select = (c: string = '') => {
      cols = c;
      return builder;
    };
    builder.eq = (column: string, value: string) => {
      filters.push({ column, value });
      return builder;
    };
    builder.maybeSingle = () => {
      const match = [...userStore.values()].find((u) => matches(u, filters));
      if (!match) return Promise.resolve({ data: null, error: null });
      if (cols.includes('wallet_mappings')) {
        const wallet_mappings = mappingStore
          .filter((m) => m.user_id === match.id)
          .map(({ chain, address, verified_at }) => ({ chain, address, verified_at: verified_at ?? null }));
        return Promise.resolve({
          data: {
            username: match.username,
            display_name: match.display_name ?? null,
            bio: match.bio ?? null,
            avatar_url: match.avatar_url ?? null,
            wallet_mappings,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: pick(match, cols || 'id'), error: null });
    };
    return builder;
  };

  const mappingsBuilder = () => {
    const filters: FilterEq[] = [];
    const builder: Record<string, unknown> = {};
    let cols = '';
    let deleting = false;

    builder.select = (c: string = '') => {
      cols = c;
      if (deleting) {
        const removed = mappingStore.filter((m) => matches(m, filters));
        for (const row of removed) mappingStore.splice(mappingStore.indexOf(row), 1);
        return Promise.resolve({ data: removed.map((r) => pick(r, cols)), error: null });
      }
      return builder;
    };
    builder.eq = (column: string, value: string) => {
      filters.push({ column, value });
      return builder;
    };
    builder.maybeSingle = () => {
      const match = mappingStore.find((m) => matches(m, filters));
      return Promise.resolve({ data: match ? pick(match, cols) : null, error: null });
    };
    builder.delete = () => {
      deleting = true;
      return builder;
    };
    builder.upsert = (payload: MappingRow, _opts?: unknown) => {
      const idx = mappingStore.findIndex(
        (m) => m.user_id === payload.user_id && m.chain === payload.chain,
      );
      if (idx >= 0) mappingStore[idx] = { ...mappingStore[idx], ...payload };
      else mappingStore.push({ ...payload });
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
  removeAddress,
  resolveByUsername,
  resolveForWallet,
  clearResolveCache,
} from '../src/services/walletService';
import { BadRequestError, NotFoundError } from '../src/utils/errors';

const seedUser = (id: string, username: string, ownerWallet: string, extra: Partial<UserRow> = {}) => {
  userStore.set(id, { id, username, owner_wallet: ownerWallet.toLowerCase(), ...extra });
};

beforeEach(() => {
  userStore.clear();
  mappingStore.length = 0;
  clearResolveCache();
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
    expect(mappingStore[0].verified_at).toBeNull();
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

  it('marks the owner wallet as verified when mapped to ethereum', async () => {
    const owner = ethers.Wallet.createRandom();
    seedUser('u1', 'derrick', owner.address);

    await addAddress(owner.address, 'ethereum', owner.address);
    expect(mappingStore[0].verified_at).toEqual(expect.any(String));
  });

  it('keeps verification when the same address is saved again', async () => {
    const owner = ethers.Wallet.createRandom();
    seedUser('u1', 'derrick', owner.address);
    const sol = '4Nd1mYz7K8jM2QpRzWxV3Y5tF7gH9JkLm2NoP4Qr5SsT';
    mappingStore.push({ user_id: 'u1', chain: 'solana', address: sol, verified_at: '2026-09-01T00:00:00Z' });

    await addAddress(owner.address, 'solana', sol);
    expect(mappingStore[0].verified_at).toBe('2026-09-01T00:00:00Z');
  });

  it('resets verification when the address changes', async () => {
    const owner = ethers.Wallet.createRandom();
    seedUser('u1', 'derrick', owner.address);
    mappingStore.push({
      user_id: 'u1',
      chain: 'solana',
      address: '4Nd1mYz7K8jM2QpRzWxV3Y5tF7gH9JkLm2NoP4Qr5SsT',
      verified_at: '2026-09-01T00:00:00Z',
    });

    await addAddress(owner.address, 'solana', '7Gk2pQv9xYt3LmN8rB4sW6cD1eF5hJ9kZ2aUmQ9xAb');
    expect(mappingStore[0].verified_at).toBeNull();
  });
});

describe('walletService.removeAddress', () => {
  it('removes the mapping for a chain and refreshes resolve', async () => {
    const owner = ethers.Wallet.createRandom();
    seedUser('u1', 'derrick', owner.address);
    mappingStore.push(
      { user_id: 'u1', chain: 'ethereum', address: '0xeee' },
      { user_id: 'u1', chain: 'solana', address: 'SoLAddr' },
    );
    await resolveByUsername('derrick'); // warm the cache

    await expect(removeAddress(owner.address, 'solana')).resolves.toEqual({ chain: 'solana' });

    expect(mappingStore.map((m) => m.chain)).toEqual(['ethereum']);
    const fresh = await resolveByUsername('derrick');
    expect(fresh.addresses).toEqual({ ethereum: '0xeee' });
  });

  it('404s when nothing is mapped for the chain', async () => {
    const owner = ethers.Wallet.createRandom();
    seedUser('u1', 'derrick', owner.address);
    await expect(removeAddress(owner.address, 'bitcoin')).rejects.toMatchObject({
      errorCode: 'ADDRESS_NOT_FOUND',
    });
  });

  it('rejects unsupported chains', async () => {
    const owner = ethers.Wallet.createRandom();
    seedUser('u1', 'derrick', owner.address);
    await expect(removeAddress(owner.address, 'dogecoin')).rejects.toMatchObject({
      errorCode: 'UNSUPPORTED_CHAIN',
    });
  });

  it('404s for a wallet without a username', async () => {
    await expect(
      removeAddress(ethers.Wallet.createRandom().address, 'ethereum'),
    ).rejects.toMatchObject({ errorCode: 'USER_NOT_FOUND' });
  });
});

describe('walletService.resolveByUsername', () => {
  it('returns 404 for unknown username', async () => {
    await expect(resolveByUsername('ghost')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns username, addresses, verification and profile fields', async () => {
    seedUser('u1', 'derrick', '0xabc', { display_name: 'Derrick A.', bio: 'Builds things' });
    mappingStore.push(
      { user_id: 'u1', chain: 'ethereum', address: '0xeee', verified_at: '2026-09-01T00:00:00Z' },
      { user_id: 'u1', chain: 'solana', address: 'SoLAddr', verified_at: null },
    );

    const result = await resolveByUsername('Derrick'); // tests normalization
    expect(result).toEqual({
      username: 'derrick',
      addresses: { ethereum: '0xeee', solana: 'SoLAddr' },
      verified: { ethereum: true },
      displayName: 'Derrick A.',
      bio: 'Builds things',
      avatarUrl: null,
    });
  });

  it('returns empty addresses object when user has no mappings', async () => {
    seedUser('u1', 'derrick', '0xabc');
    const result = await resolveByUsername('derrick');
    expect(result.addresses).toEqual({});
    expect(result.verified).toEqual({});
  });

  it('fresh reads bypass a stale cached copy and replace it', async () => {
    seedUser('u1', 'derrick', '0xabc');
    mappingStore.push({ user_id: 'u1', chain: 'ethereum', address: '0xold' });
    await resolveByUsername('derrick'); // cached

    // Simulate a write handled by another API instance (this cache not cleared).
    mappingStore[0].address = '0xnew';

    expect((await resolveByUsername('derrick')).addresses.ethereum).toBe('0xold');
    expect((await resolveByUsername('derrick', { fresh: true })).addresses.ethereum).toBe('0xnew');
    expect((await resolveByUsername('derrick')).addresses.ethereum).toBe('0xnew');
  });
});

describe('walletService.resolveForWallet', () => {
  it("returns the owner's resolution from the database", async () => {
    const owner = ethers.Wallet.createRandom();
    seedUser('u1', 'derrick', owner.address);
    await resolveByUsername('derrick'); // warm the cache with no addresses

    await addAddress(owner.address, 'solana', '4Nd1mYz7K8jM2QpRzWxV3Y5tF7gH9JkLm2NoP4Qr5SsT');
    const result = await resolveForWallet(owner.address.toUpperCase().replace('0X', '0x'));

    expect(result.username).toBe('derrick');
    expect(result.addresses).toEqual({ solana: '4Nd1mYz7K8jM2QpRzWxV3Y5tF7gH9JkLm2NoP4Qr5SsT' });
  });

  it('404s for a wallet without a username', async () => {
    await expect(resolveForWallet(ethers.Wallet.createRandom().address)).rejects.toMatchObject({
      errorCode: 'USER_NOT_FOUND',
    });
  });
});
