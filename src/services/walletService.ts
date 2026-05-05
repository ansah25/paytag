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

const SOLANA_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BITCOIN_LEGACY_REGEX = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const BITCOIN_BECH32_REGEX = /^bc1[ac-hj-np-z02-9]{8,87}$/i;

const validators: Record<Chain, (address: string) => boolean> = {
  ethereum: (addr) => ethers.isAddress(addr),
  solana: (addr) => SOLANA_REGEX.test(addr),
  bitcoin: (addr) => BITCOIN_LEGACY_REGEX.test(addr) || BITCOIN_BECH32_REGEX.test(addr),
};

export const validateChainAddress = (chain: string, address: string): Chain => {
  if (!isSupportedChain(chain)) {
    throw new BadRequestError(
      `Unsupported chain. Supported: ${SUPPORTED_CHAINS.join(', ')}`,
      'UNSUPPORTED_CHAIN',
    );
  }
  if (!validators[chain](address)) {
    throw new BadRequestError(
      `Invalid address format for chain "${chain}"`,
      'INVALID_ADDRESS',
    );
  }
  return chain;
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
}

const RESOLVE_TTL_MS = 30_000;
const resolveCache = new TtlCache<Resolution>(RESOLVE_TTL_MS);

export const invalidateResolveCache = (username: string): void => {
  resolveCache.invalidate(username);
};

export const clearResolveCache = (): void => {
  resolveCache.clear();
};

export const addAddress = async (
  ownerWallet: string,
  rawChain: string,
  rawAddress: string,
): Promise<AddressEntry> => {
  const chain = validateChainAddress(rawChain, rawAddress);
  const address = canonicalizeAddress(chain, rawAddress);
  const wallet = ownerWallet.toLowerCase();

  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, username')
    .eq('owner_wallet', wallet)
    .maybeSingle();

  if (userErr) {
    throw new Error(`Failed to look up user: ${userErr.message}`);
  }
  if (!user) {
    throw new NotFoundError('No registered username for this wallet', 'USER_NOT_FOUND');
  }

  const { error: upsertErr } = await supabase
    .from('wallet_mappings')
    .upsert(
      { user_id: user.id, chain, address },
      { onConflict: 'user_id,chain' },
    );

  if (upsertErr) {
    throw new Error(`Failed to save address: ${upsertErr.message}`);
  }

  invalidateResolveCache(user.username as string);
  return { chain, address };
};

export const resolveByUsername = async (rawUsername: string): Promise<Resolution> => {
  const username = normalizeUsername(rawUsername);

  const cached = resolveCache.get(username);
  if (cached) {
    logger.info('resolve.cache_hit', { username });
    return cached;
  }

  const { data, error } = await supabase
    .from('users')
    .select('username, wallet_mappings(chain, address)')
    .eq('username', username)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve username: ${error.message}`);
  }
  if (!data) {
    throw new NotFoundError('Username not found', 'USER_NOT_FOUND');
  }

  const mappings = (data.wallet_mappings ?? []) as Array<{ chain: string; address: string }>;
  const addresses: Partial<Record<Chain, string>> = {};
  for (const m of mappings) {
    if (isSupportedChain(m.chain)) {
      addresses[m.chain] = m.address;
    }
  }

  const resolution: Resolution = { username: data.username, addresses };
  resolveCache.set(username, resolution);
  logger.info('resolve.miss', { username });
  return resolution;
};
