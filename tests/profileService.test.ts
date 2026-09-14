import './setup';

type Row = Record<string, unknown>;

const users: Row[] = [];

jest.mock('../src/config/supabase', () => {
  const pick = (row: Row, cols: string) => {
    const out: Row = {};
    for (const col of cols.split(',').map((s) => s.trim())) {
      if (col in row) out[col] = row[col];
    }
    return out;
  };

  const usersBuilder = () => {
    const filters: Array<[string, unknown]> = [];
    let patch: Row | null = null;
    let cols = '';
    const builder: Record<string, unknown> = {
      update: (p: Row) => {
        patch = p;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      select: (c: string) => {
        cols = c;
        return builder;
      },
      maybeSingle: () => {
        const match = users.find((u) => filters.every(([c, v]) => u[c] === v));
        if (match && patch) Object.assign(match, patch);
        return Promise.resolve({ data: match ? pick(match, cols) : null, error: null });
      },
    };
    return builder;
  };

  return {
    supabase: {
      from: (table: string) => {
        if (table === 'users') return usersBuilder();
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
});

import * as walletService from '../src/services/walletService';
import { updateProfile } from '../src/services/profileService';
import { updateProfileBodySchema } from '../src/controllers/userController';

const WALLET = '0xabc0000000000000000000000000000000000001';

beforeEach(() => {
  users.length = 0;
  users.push({
    id: 'u1',
    username: 'derrick',
    owner_wallet: WALLET,
    created_at: '2026-09-01T00:00:00Z',
    display_name: null,
    bio: null,
    avatar_url: null,
  });
  jest.restoreAllMocks();
});

describe('profileService.updateProfile', () => {
  it('saves display name and bio and drops the cached resolve', async () => {
    const invalidate = jest.spyOn(walletService, 'invalidateResolveCache');

    const user = await updateProfile(WALLET.toUpperCase().replace('0X', '0x'), {
      displayName: 'Derrick A.',
      bio: 'Builds payment rails',
    });

    expect(user).toMatchObject({ username: 'derrick', display_name: 'Derrick A.', bio: 'Builds payment rails' });
    expect(invalidate).toHaveBeenCalledWith('derrick');
  });

  it('leaves omitted fields alone and clears null ones', async () => {
    users[0].display_name = 'Old name';
    users[0].bio = 'Old bio';

    const user = await updateProfile(WALLET, { bio: null });

    expect(user.display_name).toBe('Old name');
    expect(user.bio).toBeNull();
  });

  it('rejects an empty update', async () => {
    await expect(updateProfile(WALLET, {})).rejects.toMatchObject({ errorCode: 'EMPTY_UPDATE' });
  });

  it('rejects over-long fields', async () => {
    await expect(updateProfile(WALLET, { displayName: 'x'.repeat(41) })).rejects.toMatchObject({
      errorCode: 'DISPLAY_NAME_TOO_LONG',
    });
    await expect(updateProfile(WALLET, { bio: 'x'.repeat(121) })).rejects.toMatchObject({
      errorCode: 'BIO_TOO_LONG',
    });
  });

  it('404s for a wallet without a username', async () => {
    await expect(
      updateProfile('0xabc0000000000000000000000000000000000999', { bio: 'hi' }),
    ).rejects.toMatchObject({ errorCode: 'USER_NOT_FOUND' });
  });
});

describe('updateProfileBodySchema', () => {
  it('trims text, strips control characters and maps empty strings to null', () => {
    expect(updateProfileBodySchema.parse({ displayName: '  Nadia\n K. ', bio: '   ' })).toEqual({
      displayName: 'Nadia  K.',
      bio: null,
    });
  });

  it('accepts null to clear a field', () => {
    expect(updateProfileBodySchema.parse({ bio: null })).toEqual({ bio: null });
  });

  it('rejects over-long values after trimming', () => {
    expect(updateProfileBodySchema.safeParse({ displayName: `  ${'x'.repeat(40)}  ` }).success).toBe(true);
    expect(updateProfileBodySchema.safeParse({ displayName: 'x'.repeat(41) }).success).toBe(false);
    expect(updateProfileBodySchema.safeParse({ bio: 'x'.repeat(121) }).success).toBe(false);
  });

  it('requires at least one field', () => {
    expect(updateProfileBodySchema.safeParse({}).success).toBe(false);
  });
});
