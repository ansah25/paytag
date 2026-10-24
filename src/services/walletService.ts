import { supabase } from '../config/supabase';
import { BadRequestError, NotFoundError } from '../utils/errors';
import { normalizeUsername } from './userService';
import { TtlCache } from '../utils/cache';
import { canonicalAddress, isBitcoinAddress, isEthereumAddress, isSolanaAddress } from '../utils/addresses';
import { logger } from '../utils/logger';
import { RESOLVE_TIMEOUT_MS, getOnchainOwner, linkStatus, type OnchainStatus } from './onchainService';
import { dbError } from '../utils/dbErrors';

export const SUPPORTED_CHAINS = ['ethereum', 'solana', 'bitcoin'] as const;
export type Chain = (typeof SUPPORTED_CHAINS)[number];

export const isSupportedChain = (chain: string): chain is Chain =>
  (SUPPORTED_CHAINS as readonly string[]).includes(chain);

export const assertSupportedChain = (chain: string): Chain => {
  if (!isSupportedChain(chain)) {
    throw new BadRequestError(
      `Unsupported chain. Supported: ${SUPPORTED_CHAINS.join(', ')}`,
      'UNSUPPORTED_CHAIN',
    );
  }
  return chain;
};

const validators: Record<Chain, (address: string) => boolean> = {
  ethereum: isEthereumAddress,
  solana: isSolanaAddress,
  bitcoin: isBitcoinAddress,
};

export const validateChainAddress = (chain: string, address: string): Chain => {
  const supported = assertSupportedChain(chain);
  if (!validators[supported](address)) {
    throw new BadRequestError(
      `Invalid address format for chain "${chain}"`,
      'INVALID_ADDRESS',
    );
  }
  return supported;
};

const canonicalizeAddress = canonicalAddress;

export interface AddressEntry {
  chain: Chain;
  address: string;
}

export interface Resolution {
  username: string;
  addresses: Partial<Record<Chain, string>>;
  /** Chains whose mapped address was proven with a signature. */
  verified: Partial<Record<Chain, boolean>>;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  /** Whether the on-chain name of the same spelling belongs to this account (onchainService). */
  onchain: { status: OnchainStatus };
}

// Staleness window: 30s in this cache for everything in a resolution, including the on-chain
// status and a failed chain read (kept so resolve stays fast while the RPC is down).
// Writes through this API invalidate it; on-chain changes don't. Clients add their own window on
// top: /resolve sends `max-age=30, stale-while-revalidate=60` (walletController), so a viewer can
// see a status up to ~120s old in the worst case.
const RESOLVE_TTL_MS = 30_000;
const resolveCache = new TtlCache<Resolution>(RESOLVE_TTL_MS);

export const invalidateResolveCache = (username: string): void => {
  resolveCache.invalidate(username);
};

export const clearResolveCache = (): void => {
  resolveCache.clear();
};

export interface OwnedUser {
  id: string;
  username: string;
}

/** The user registered to this wallet, or 404. */
export const findOwnedUser = async (ownerWallet: string): Promise<OwnedUser> => {
  const { data: user, error, status } = await supabase
    .from('users')
    .select('id, username')
    .eq('owner_wallet', ownerWallet.toLowerCase())
    .maybeSingle();

  if (error) {
    throw dbError('look up user', error, status);
  }
  if (!user) {
    throw new NotFoundError('No registered username for this wallet', 'USER_NOT_FOUND');
  }
  return user as OwnedUser;
};

export const addAddress = async (
  ownerWallet: string,
  rawChain: string,
  rawAddress: string,
): Promise<AddressEntry> => {
  const chain = validateChainAddress(rawChain, rawAddress);
  const address = canonicalizeAddress(chain, rawAddress);
  const wallet = ownerWallet.toLowerCase();
  const user = await findOwnedUser(wallet);

  const { data: existing, error: existingErr, status: existingStatus } = await supabase
    .from('wallet_mappings')
    .select('address')
    .eq('user_id', user.id)
    .eq('chain', chain)
    .maybeSingle();

  if (existingErr) {
    throw dbError('load address', existingErr, existingStatus);
  }
  // Re-saving the same address must not throw away its verification.
  if ((existing as { address?: string } | null)?.address === address) {
    return { chain, address };
  }

  // A new address starts unverified — except the owner wallet, which already
  // proved control by signing in.
  const verifiedAt = chain === 'ethereum' && address === wallet ? new Date().toISOString() : null;

  const { error: upsertErr, status: upsertStatus } = await supabase
    .from('wallet_mappings')
    .upsert(
      { user_id: user.id, chain, address, verified_at: verifiedAt },
      { onConflict: 'user_id,chain' },
    );

  if (upsertErr) {
    throw dbError('save address', upsertErr, upsertStatus);
  }

  invalidateResolveCache(user.username);
  return { chain, address };
};

export const removeAddress = async (
  ownerWallet: string,
  rawChain: string,
): Promise<{ chain: Chain }> => {
  const chain = assertSupportedChain(rawChain);
  const user = await findOwnedUser(ownerWallet);

  const { data, error, status } = await supabase
    .from('wallet_mappings')
    .delete()
    .eq('user_id', user.id)
    .eq('chain', chain)
    .select('chain');

  if (error) {
    throw dbError('remove address', error, status);
  }
  if (!data || data.length === 0) {
    throw new NotFoundError('No address mapped for this chain', 'ADDRESS_NOT_FOUND');
  }

  invalidateResolveCache(user.username);
  logger.info('address.removed', { username: user.username, chain });
  return { chain };
};

interface ResolveRow {
  username: string;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  wallet_mappings?: Array<{ chain: string; address: string; verified_at?: string | null }>;
}

/** The owner's current resolution, read from the database. Used in mutation responses. */
export const resolveForWallet = async (ownerWallet: string): Promise<Resolution> => {
  const user = await findOwnedUser(ownerWallet);
  return resolveByUsername(user.username, { fresh: true });
};

export const resolveByUsername = async (
  rawUsername: string,
  opts: { fresh?: boolean } = {},
): Promise<Resolution> => {
  const username = normalizeUsername(rawUsername);

  // `fresh` skips the in-memory cache. The cache is per API instance, so a
  // copy cached before a write on another machine can otherwise be returned.
  const cached = opts.fresh ? undefined : resolveCache.get(username);
  if (cached) {
    logger.info('resolve.cache_hit', { username });
    return cached;
  }

  const { data, error, status } = await supabase
    .from('users')
    .select('username, display_name, bio, avatar_url, wallet_mappings(chain, address, verified_at)')
    .eq('username', username)
    .maybeSingle();

  if (error) {
    throw dbError('resolve username', error, status);
  }
  if (!data) {
    throw new NotFoundError('Username not found', 'USER_NOT_FOUND');
  }

  const row = data as ResolveRow;
  const addresses: Partial<Record<Chain, string>> = {};
  const verified: Partial<Record<Chain, boolean>> = {};
  for (const m of row.wallet_mappings ?? []) {
    if (isSupportedChain(m.chain)) {
      addresses[m.chain] = m.address;
      if (m.verified_at) verified[m.chain] = true;
    }
  }

  // Only after the account is found, so made-up names never cost an RPC call.
  const lookup = await getOnchainOwner(row.username, { timeoutMs: RESOLVE_TIMEOUT_MS });

  const resolution: Resolution = {
    username: row.username,
    addresses,
    verified,
    displayName: row.display_name ?? null,
    bio: row.bio ?? null,
    avatarUrl: row.avatar_url ?? null,
    onchain: { status: linkStatus(lookup, verified.ethereum ? addresses.ethereum : undefined) },
  };
  resolveCache.set(username, resolution);
  logger.info('resolve.miss', { username });
  return resolution;
};
