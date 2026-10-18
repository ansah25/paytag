import { supabase } from '../config/supabase';
import { ConflictError, BadRequestError } from '../utils/errors';
import { logger } from '../utils/logger';
import { REGISTER_TIMEOUT_MS, RESOLVE_TIMEOUT_MS, getOnchainOwner } from './onchainService';

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

// Off-chain only: first path segments of web pages (paytag.dev/<segment>) added after the
// registry was deployed. On-chain names live under /on-chain/<name>, so these can't collide
// there, and they deliberately have no entry in the immutable on-chain blocklist above.
export const ROUTE_RESERVED_USERNAMES = new Set(['status']);

export const isReservedUsername = (username: string): boolean =>
  RESERVED_USERNAMES.has(username) || ROUTE_RESERVED_USERNAMES.has(username);

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

// Trim ASCII whitespace and lowercase ASCII A-Z only. String#trim also strips Unicode whitespace
// and String#toLowerCase folds some non-ASCII characters into ASCII (the Kelvin sign U+212A
// becomes "k"), which would let input the on-chain registry rejects pass here. Leaving non-ASCII
// untouched makes USERNAME_REGEX reject it, matching the contract. A leading "@" is not stripped
// here (clients strip it before calling), so "@name" is rejected as malformed.
export const normalizeUsername = (username: string): string =>
  username.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '').replace(/[A-Z]/g, (c) => c.toLowerCase());

export const validateUsername = (username: string): void => {
  if (!USERNAME_REGEX.test(username)) {
    throw new BadRequestError(
      'Username must be 3-20 characters, lowercase alphanumeric or underscore',
      'USERNAME_INVALID_FORMAT',
    );
  }
  if (isReservedUsername(username)) {
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
    if (!USERNAME_REGEX.test(candidate) || isReservedUsername(candidate)) continue;
    if (await isUsernameAvailable(candidate)) suggestions.push(candidate);
  }
  return suggestions;
};

export type AvailabilityReason = 'INVALID_FORMAT' | 'RESERVED' | 'TAKEN' | 'TAKEN_ONCHAIN';

export interface Availability {
  available: boolean;
  reason?: AvailabilityReason;
  suggestions: string[];
}

/**
 * Whether `rawUsername` can be registered off-chain by `wallet`. A name free off-chain but held
 * on-chain is `TAKEN_ONCHAIN` unless `wallet` is its on-chain owner (registering it would link
 * the two). Only the on-chain owner, which is public, is compared with `wallet`; the response
 * never says which wallet owns an off-chain account. An indexer failure reports the name
 * available: /register checks again. Suggestions are filtered off-chain only, so a request makes
 * at most one indexer call. If this is ever cached, `wallet` must be part of the cache key.
 */
export const checkAvailability = async (rawUsername: string, wallet?: string): Promise<Availability> => {
  const username = normalizeUsername(rawUsername);
  if (!USERNAME_REGEX.test(username)) {
    return { available: false, reason: 'INVALID_FORMAT', suggestions: [] };
  }
  if (isReservedUsername(username)) {
    return { available: false, reason: 'RESERVED', suggestions: await generateSuggestions(username) };
  }
  if (!(await isUsernameAvailable(username))) {
    return { available: false, reason: 'TAKEN', suggestions: await generateSuggestions(username) };
  }

  const onchain = await getOnchainOwner(username, { timeoutMs: RESOLVE_TIMEOUT_MS });
  if (onchain.kind === 'owner' && onchain.owner !== wallet?.toLowerCase()) {
    return { available: false, reason: 'TAKEN_ONCHAIN', suggestions: await generateSuggestions(username) };
  }
  return { available: true, suggestions: [] };
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

  // Held on-chain by another wallet: refuse, so the two namespaces don't drift further apart.
  // Held by this wallet: register, and it comes out linked (this wallet becomes the verified ETH
  // address below). Read fresh, never through the resolve cache. Fails open: if the indexer is
  // down or syncing the signup goes ahead, since the permissionless contract can't prevent
  // collisions anyway. A name taken on-chain between this check and the insert is accepted.
  // Bypasses the circuit breaker, so public reads can't switch this check off.
  const onchain = await getOnchainOwner(normalized, { timeoutMs: REGISTER_TIMEOUT_MS, useBreaker: false });
  if (onchain.kind === 'owner' && onchain.owner !== wallet) {
    throw new ConflictError(
      'That username is registered on-chain by a different wallet',
      'USERNAME_TAKEN_ONCHAIN',
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
