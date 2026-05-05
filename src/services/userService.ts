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
}

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

export const registerUsername = async (
  username: string,
  ownerWallet: string,
): Promise<UserRecord> => {
  const normalized = normalizeUsername(username);
  validateUsername(normalized);

  const wallet = ownerWallet.toLowerCase();

  const { data: existing, error: existingErr } = await supabase
    .from('users')
    .select('id')
    .eq('owner_wallet', wallet)
    .maybeSingle();

  if (existingErr) {
    throw new Error(`Failed to check existing user: ${existingErr.message}`);
  }
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
      throw new ConflictError('That username is already taken', 'USERNAME_TAKEN');
    }
    throw new Error(`Failed to register username: ${error.message}`);
  }

  // Smart default: register the connected wallet as the user's ethereum address.
  // Best-effort — failure here doesn't fail the registration since the user
  // can still add the address manually.
  const { error: defaultErr } = await supabase
    .from('wallet_mappings')
    .upsert(
      { user_id: (data as UserRecord).id, chain: 'ethereum', address: wallet },
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
