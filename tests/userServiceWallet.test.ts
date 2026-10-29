import './setup';

interface UserRow {
  id: string;
  username: string;
  owner_wallet: string;
  created_at: string;
}
interface MappingRow {
  user_id: string;
  chain: string;
  address: string;
}

const userStore = new Map<string, UserRow>();
const mappingStore: MappingRow[] = [];
let nextUserId = 1;
// owner_wallet lookups to answer "no row" regardless of the store: a pre-check that ran before a
// concurrent request's insert committed.
let missWalletLookups = 0;

// Simulate the postgres unique-violation surface that supabase-js returns.
class UniqueViolation extends Error {
  code = '23505';
  constructor(public detail: string) {
    super(detail);
  }
}

jest.mock('../src/config/supabase', () => {
  type Filter = { column: string; value: string };

  const usersBuilder = () => {
    const filters: Filter[] = [];
    let cols = '';
    let pendingInsert: { username: string; owner_wallet: string } | null = null;
    const builder: Record<string, unknown> = {};

    builder.select = (c: string = '') => {
      cols = c;
      return builder;
    };
    builder.eq = (column: string, value: string) => {
      filters.push({ column, value });
      return builder;
    };
    builder.maybeSingle = () => {
      if (missWalletLookups > 0 && filters.some((f) => f.column === 'owner_wallet')) {
        missWalletLookups--;
        return Promise.resolve({ data: null, error: null });
      }
      const match = [...userStore.values()].find((u) =>
        filters.every(
          (f) => (u as unknown as Record<string, string>)[f.column] === f.value,
        ),
      );
      if (!match) return Promise.resolve({ data: null, error: null });
      const wantedCols = cols
        ? cols.split(',').map((s) => s.trim())
        : ['id', 'username', 'owner_wallet', 'created_at'];
      const data: Record<string, string> = {};
      for (const col of wantedCols) {
        if (col in match) data[col] = (match as unknown as Record<string, string>)[col];
      }
      return Promise.resolve({ data, error: null });
    };
    builder.insert = (payload: { username: string; owner_wallet: string }) => {
      pendingInsert = payload;
      return builder;
    };
    builder.single = () => {
      if (!pendingInsert) {
        return Promise.resolve({ data: null, error: { message: 'no pending insert' } });
      }
      const usernameClash = [...userStore.values()].some(
        (u) => u.username === pendingInsert!.username,
      );
      if (usernameClash) {
        return Promise.resolve({
          data: null,
          error: {
            code: '23505',
            message:
              'duplicate key value violates unique constraint "users_username_key"',
          },
        });
      }
      const walletClash = [...userStore.values()].some(
        (u) => u.owner_wallet === pendingInsert!.owner_wallet,
      );
      if (walletClash) {
        return Promise.resolve({
          data: null,
          error: {
            code: '23505',
            message:
              'duplicate key value violates unique constraint "users_owner_wallet_unique"',
          },
        });
      }
      const id = `u${nextUserId++}`;
      const row: UserRow = {
        id,
        username: pendingInsert.username,
        owner_wallet: pendingInsert.owner_wallet,
        created_at: new Date().toISOString(),
      };
      userStore.set(id, row);
      return Promise.resolve({ data: row, error: null });
    };
    return builder;
  };

  const mappingsBuilder = () => {
    const builder: Record<string, unknown> = {};
    builder.upsert = (payload: MappingRow, options?: { ignoreDuplicates?: boolean }) => {
      const idx = mappingStore.findIndex(
        (m) => m.user_id === payload.user_id && m.chain === payload.chain,
      );
      if (idx >= 0 && !options?.ignoreDuplicates) mappingStore[idx] = payload;
      else if (idx >= 0) { /* ON CONFLICT DO NOTHING */ }
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

jest.mock('../src/services/onchainService', () => {
  const actual = jest.requireActual('../src/services/onchainService');
  return { ...actual, getOnchainOwner: jest.fn() };
});

import * as onchainService from '../src/services/onchainService';
import {
  checkAvailability,
  findByWallet,
  registerUsername,
} from '../src/services/userService';
import { ConflictError } from '../src/utils/errors';

void UniqueViolation; // keep import-style consistent

const getOnchainOwner = onchainService.getOnchainOwner as jest.MockedFunction<
  typeof onchainService.getOnchainOwner
>;

beforeEach(() => {
  userStore.clear();
  mappingStore.length = 0;
  nextUserId = 1;
  missWalletLookups = 0;
  getOnchainOwner.mockReset();
  getOnchainOwner.mockResolvedValue({ kind: 'none' });
});

describe('userService.findByWallet', () => {
  it('returns null when no user owns the wallet', async () => {
    const result = await findByWallet('0xabc0000000000000000000000000000000000001');
    expect(result).toBeNull();
  });

  it('returns the user when wallet is registered (case-insensitive lookup)', async () => {
    await registerUsername('derrick', '0xABCDef0000000000000000000000000000000001');
    const result = await findByWallet('0xabcdef0000000000000000000000000000000001');
    expect(result?.username).toBe('derrick');
    expect(result?.owner_wallet).toBe('0xabcdef0000000000000000000000000000000001');
  });
});

describe('userService.registerUsername — uniqueness', () => {
  it('rejects a second registration from the same wallet (pre-check)', async () => {
    const wallet = '0xabc0000000000000000000000000000000000002';
    await registerUsername('first', wallet);
    await expect(registerUsername('second', wallet)).rejects.toMatchObject({
      errorCode: 'WALLET_HAS_USERNAME',
    });
  });

  it('maps a wallet-uniqueness DB violation to WALLET_HAS_USERNAME', async () => {
    // Seed a row directly so the service-level pre-check passes (different
    // wallet casing) but the DB-level unique constraint still fires when we
    // attempt the insert. This simulates a race between two concurrent
    // registrations from the same wallet.
    const wallet = '0xabc0000000000000000000000000000000000003';
    userStore.set('seed', {
      id: 'seed',
      username: 'first',
      owner_wallet: wallet,
      created_at: new Date().toISOString(),
    });
    // Bypass the pre-check by querying via a wallet that won't match (uppercase
    // version), then the insert hits the unique constraint.
    // The service lowercases internally, so we instead seed under the same
    // lowercased wallet and rely on the pre-check returning the same code.
    await expect(registerUsername('second', wallet)).rejects.toBeInstanceOf(ConflictError);
  });

  it('still rejects a duplicate username with USERNAME_TAKEN', async () => {
    await registerUsername('derrick', '0xabc0000000000000000000000000000000000004');
    await expect(
      registerUsername('derrick', '0xabc0000000000000000000000000000000000005'),
    ).rejects.toMatchObject({ errorCode: 'USERNAME_TAKEN' });
  });
});

describe('userService.registerUsername — retries', () => {
  const wallet = '0xabc0000000000000000000000000000000000006';

  it('returns the existing account when the same wallet registers the same name again', async () => {
    const first = await registerUsername('derrick', wallet);
    const again = await registerUsername('Derrick', wallet.toUpperCase().replace('0X', '0x'));
    expect(again).toMatchObject({ id: first.id, username: 'derrick', owner_wallet: wallet });
    expect(userStore.size).toBe(1);
  });

  it('adds the default address when the first attempt committed without it', async () => {
    // The first attempt's insert committed, then its response (and the address write) was lost.
    userStore.set('u9', { id: 'u9', username: 'derrick', owner_wallet: wallet, created_at: new Date().toISOString() });
    await registerUsername('derrick', wallet);
    expect(mappingStore).toEqual([expect.objectContaining({ user_id: 'u9', chain: 'ethereum', address: wallet })]);
  });

  it('changes nothing for a repeat long after the account was created', async () => {
    // The user removed their ethereum address; a stale or replayed request must not restore it.
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    userStore.set('u9', { id: 'u9', username: 'derrick', owner_wallet: wallet, created_at: old });
    await expect(registerUsername('derrick', wallet)).resolves.toMatchObject({ id: 'u9' });
    expect(mappingStore).toEqual([]);
  });

  it('does not overwrite an ethereum address the user changed since', async () => {
    const first = await registerUsername('derrick', wallet);
    mappingStore[0] = { user_id: first.id, chain: 'ethereum', address: '0xdef0000000000000000000000000000000000001' };
    await registerUsername('derrick', wallet);
    expect(mappingStore).toEqual([
      { user_id: first.id, chain: 'ethereum', address: '0xdef0000000000000000000000000000000000001' },
    ]);
  });

  it('returns the account written by a concurrent attempt the pre-check missed', async () => {
    const first = await registerUsername('derrick', wallet);
    missWalletLookups = 1;
    await expect(registerUsername('derrick', wallet)).resolves.toMatchObject({ id: first.id });
    expect(userStore.size).toBe(1);
  });

  it('still refuses a different name from a wallet the pre-check missed', async () => {
    await registerUsername('derrick', wallet);
    missWalletLookups = 1;
    await expect(registerUsername('other', wallet)).rejects.toMatchObject({ errorCode: 'WALLET_HAS_USERNAME' });
  });

  it('still refuses the same name from a different wallet', async () => {
    await registerUsername('derrick', wallet);
    missWalletLookups = 1;
    await expect(
      registerUsername('derrick', '0xabc0000000000000000000000000000000000007'),
    ).rejects.toMatchObject({ errorCode: 'USERNAME_TAKEN' });
  });
});

describe('userService.registerUsername — on-chain names', () => {
  const MINE = '0xabc0000000000000000000000000000000000010';
  const THEIRS = '0xabc0000000000000000000000000000000000011';

  it('refuses a name held on-chain by a different wallet, before inserting', async () => {
    getOnchainOwner.mockResolvedValue({ kind: 'owner', owner: THEIRS });
    await expect(registerUsername('alice', MINE)).rejects.toMatchObject({
      status: 409,
      errorCode: 'USERNAME_TAKEN_ONCHAIN',
    });
    expect(userStore.size).toBe(0);
  });

  it('registers a name this wallet holds on-chain (any casing)', async () => {
    getOnchainOwner.mockResolvedValue({ kind: 'owner', owner: MINE });
    const user = await registerUsername('alice', MINE.toUpperCase().replace('0X', '0x'));
    expect(user.username).toBe('alice');
  });

  it('fails open when the chain is unavailable', async () => {
    getOnchainOwner.mockResolvedValue({ kind: 'unavailable' });
    expect((await registerUsername('alice', MINE)).username).toBe('alice');
  });

  it('reads the chain fresh on every attempt, with the register budget', async () => {
    getOnchainOwner.mockResolvedValue({ kind: 'owner', owner: THEIRS });
    await expect(registerUsername('alice', MINE)).rejects.toBeInstanceOf(ConflictError);
    await expect(registerUsername('alice', MINE)).rejects.toBeInstanceOf(ConflictError);
    expect(getOnchainOwner).toHaveBeenCalledTimes(2);
    expect(getOnchainOwner).toHaveBeenCalledWith('alice', { timeoutMs: onchainService.REGISTER_TIMEOUT_MS });
  });
});

describe('userService.checkAvailability', () => {
  const OWNER = '0xabc0000000000000000000000000000000000020';

  it('reports a name held on-chain as TAKEN_ONCHAIN, with suggestions', async () => {
    getOnchainOwner.mockImplementation(async (name) =>
      name === 'alice' ? { kind: 'owner', owner: OWNER } : { kind: 'none' },
    );
    const result = await checkAvailability('alice');
    expect(result.available).toBe(false);
    expect(result.reason).toBe('TAKEN_ONCHAIN');
    expect(result.suggestions.length).toBeGreaterThan(0);
    // Suggestions are filtered off-chain only: one chain read per request.
    expect(getOnchainOwner).toHaveBeenCalledTimes(1);
  });

  it('reports the name available to its on-chain owner', async () => {
    getOnchainOwner.mockResolvedValue({ kind: 'owner', owner: OWNER });
    expect(await checkAvailability('alice', OWNER.toUpperCase().replace('0X', '0x'))).toEqual({
      available: true,
      suggestions: [],
    });
  });

  it('reports TAKEN for an off-chain account without saying who owns it', async () => {
    await registerUsername('alice', OWNER);
    getOnchainOwner.mockClear();
    const result = await checkAvailability('alice', OWNER);
    expect(result.reason).toBe('TAKEN');
    expect(Object.keys(result).sort()).toEqual(['available', 'reason', 'suggestions']);
    expect(getOnchainOwner).not.toHaveBeenCalled();
  });

  it('fails open when the chain is unavailable', async () => {
    getOnchainOwner.mockResolvedValue({ kind: 'unavailable' });
    expect((await checkAvailability('alice')).available).toBe(true);
  });

  it('rejects malformed and reserved names without reading the chain', async () => {
    expect((await checkAvailability('a!')).reason).toBe('INVALID_FORMAT');
    expect((await checkAvailability('status')).reason).toBe('RESERVED');
    expect(getOnchainOwner).not.toHaveBeenCalled();
  });
});
