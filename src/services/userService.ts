import { supabase } from '../config/supabase';
import { ConflictError, BadRequestError } from '../utils/errors';

export const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

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
    );
  }
};

export const registerUsername = async (
  username: string,
  ownerWallet: string,
): Promise<UserRecord> => {
  const normalized = normalizeUsername(username);
  validateUsername(normalized);

  const wallet = ownerWallet.toLowerCase();

  // Enforce one username per wallet
  const { data: existing, error: existingErr } = await supabase
    .from('users')
    .select('id')
    .eq('owner_wallet', wallet)
    .maybeSingle();

  if (existingErr) {
    throw new Error(`Failed to check existing user: ${existingErr.message}`);
  }
  if (existing) {
    throw new ConflictError('Wallet already has a registered username');
  }

  const { data, error } = await supabase
    .from('users')
    .insert({ username: normalized, owner_wallet: wallet })
    .select()
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      throw new ConflictError('Username already taken');
    }
    throw new Error(`Failed to register username: ${error.message}`);
  }

  return data as UserRecord;
};
