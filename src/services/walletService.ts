import { ethers } from 'ethers';
import { supabase } from '../config/supabase';
import { BadRequestError, NotFoundError } from '../utils/errors';
import { normalizeUsername } from './userService';
import { TtlCache } from '../utils/cache';
import { logger } from '../utils/logger';

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

const SOLANA_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BITCOIN_LEGACY_REGEX = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const BITCOIN_BECH32_REGEX = /^bc1[ac-hj-np-z02-9]{8,87}$/i;

const validators: Record<Chain, (address: string) => boolean> = {
  ethereum: (addr) => ethers.isAddress(addr),
  solana: (addr) => SOLANA_REGEX.test(addr),
  bitcoin: (addr) => BITCOIN_LEGACY_REGEX.test(addr) || BITCOIN_BECH32_REGEX.test(addr),
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

const canonicalizeAddress = (chain: Chain, address: string): string =>
  chain === 'ethereum' ? address.toLowerCase() : address;

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
}

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
  const { data: user, error } = await supabase
    .from('users')
    .select('id, username')
    .eq('owner_wallet', ownerWallet.toLowerCase())
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up user: ${error.message}`);
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

  const { data: existing, error: existingErr } = await supabase
    .from('wallet_mappings')
    .select('address')
    .eq('user_id', user.id)
    .eq('chain', chain)
    .maybeSingle();

  if (existingErr) {
    throw new Error(`Failed to load address: ${existingErr.message}`);
  }
  // Re-saving the same address must not throw away its verification.
  if ((existing as { address?: string } | null)?.address === address) {
    return { chain, address };
  }

  // A new address starts unverified — except the owner wallet, which already
  // proved control by signing in.
  const verifiedAt = chain === 'ethereum' && address === wallet ? new Date().toISOString() : null;

  const { error: upsertErr } = await supabase
    .from('wallet_mappings')
    .upsert(
      { user_id: user.id, chain, address, verified_at: verifiedAt },
      { onConflict: 'user_id,chain' },
    );

  if (upsertErr) {
    throw new Error(`Failed to save address: ${upsertErr.message}`);
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

  const { data, error } = await supabase
    .from('wallet_mappings')
    .delete()
    .eq('user_id', user.id)
    .eq('chain', chain)
    .select('chain');

  if (error) {
    throw new Error(`Failed to remove address: ${error.message}`);
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

  const { data, error } = await supabase
    .from('users')
    .select('username, display_name, bio, avatar_url, wallet_mappings(chain, address, verified_at)')
    .eq('username', username)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve username: ${error.message}`);
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

  const resolution: Resolution = {
    username: row.username,
    addresses,
    verified,
    displayName: row.display_name ?? null,
    bio: row.bio ?? null,
    avatarUrl: row.avatar_url ?? null,
  };
  resolveCache.set(username, resolution);
  logger.info('resolve.miss', { username });
  return resolution;
};
