import { supabase } from '../config/supabase';
import { ConflictError, BadRequestError } from '../utils/errors';
import { logger } from '../utils/logger';

export const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

// Reserved to avoid frontend route collisions and abuse
export const RESERVED_USERNAMES = new Set([
  'app',
  'claim',
  'send',
  'welcome',
  'pay',
  'api',
  'admin',
  'root',
  'paytag',
  'www',
  'public',
  'login',
  'logout',
  'signup',
  'signin',
  'register',
  'dashboard',
  'settings',
  'home',
  'about',
  'support',
  'help',
  'docs',
  'terms',
  'privacy',
  'auth',
  'resolve',
  'available',
]);

const PG_UNIQUE_VIOLATION = '23505';

export interface UserRecord {
  id: string;
  username: string;
  owner_wallet: string;
  created_at: string;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
}

export const USER_COLUMNS = 'id, username, owner_wallet, created_at, display_name, bio, avatar_url';

export const normalizeUsername = (username: string): string => username.trim().toLowerCase();

export const validateUsername = (username: string): void => {
  if (!USERNAME_REGEX.test(username)) {
    throw new BadRequestError(
      'Username must be 3-20 characters, lowercase alphanumeric or underscore',
      'USERNAME_INVALID_FORMAT',
    );
  }
  if (RESERVED_USERNAMES.has(username)) {
    throw new BadRequestError('That username is reserved', 'USERNAME_RESERVED');
  }
};

export const isUsernameAvailable = async (username: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (error) throw new Error(`Failed to check availability: ${error.message}`);
  return !data;
};

export const generateSuggestions = async (
  base: string,
  count = 3,
): Promise<string[]> => {
  const candidates = [
    `${base}_eth`,
    `${base}_pay`,
    `${base}1`,
    `${base}_${Math.floor(Math.random() * 90 + 10)}`,
    `the_${base}`,
    `${base}_x`,
  ];
  const suggestions: string[] = [];
  for (const candidate of candidates) {
    if (suggestions.length >= count) break;
    if (!USERNAME_REGEX.test(candidate) || RESERVED_USERNAMES.has(candidate)) continue;
    if (await isUsernameAvailable(candidate)) suggestions.push(candidate);
  }
  return suggestions;
};

export const findByWallet = async (
  ownerWallet: string,
): Promise<UserRecord | null> => {
  const wallet = ownerWallet.toLowerCase();
  const { data, error } = await supabase
    .from('users')
    .select(USER_COLUMNS)
    .eq('owner_wallet', wallet)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to look up wallet: ${error.message}`);
  }
  return (data as UserRecord | null) ?? null;
};

export const registerUsername = async (
  username: string,
  ownerWallet: string,
): Promise<UserRecord> => {
  const normalized = normalizeUsername(username);
  validateUsername(normalized);

  const wallet = ownerWallet.toLowerCase();

  const existing = await findByWallet(wallet);
  if (existing) {
    throw new ConflictError(
      'This wallet already has a registered username',
      'WALLET_HAS_USERNAME',
    );
  }

  const { data, error } = await supabase
    .from('users')
    .insert({ username: normalized, owner_wallet: wallet })
    .select()
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      // The DB now enforces unique(owner_wallet) too, so disambiguate by
      // constraint to give the client a useful error code.
      const isWalletConflict =
        typeof error.message === 'string' &&
        error.message.includes('users_owner_wallet_unique');
      if (isWalletConflict) {
        throw new ConflictError(
          'This wallet already has a registered username',
          'WALLET_HAS_USERNAME',
        );
      }
      throw new ConflictError('That username is already taken', 'USERNAME_TAKEN');
    }
    throw new Error(`Failed to register username: ${error.message}`);
  }

  // Smart default: register the connected wallet as the user's ethereum address.
  // It's verified from the start — the user just signed in with this wallet.
  // Best-effort — failure here doesn't fail the registration since the user
  // can still add the address manually.
  const { error: defaultErr } = await supabase
    .from('wallet_mappings')
    .upsert(
      {
        user_id: (data as UserRecord).id,
        chain: 'ethereum',
        address: wallet,
        verified_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,chain' },
    );
  if (defaultErr) {
    logger.warn('register.default_address_failed', {
      userId: (data as UserRecord).id,
      message: defaultErr.message,
    });
  }

  logger.info('user.registered', { username: normalized, wallet });
  return data as UserRecord;
};
