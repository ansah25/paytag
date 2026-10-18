import { randomBytes } from 'crypto';
import { ethers } from 'ethers';
import jwt, { SignOptions } from 'jsonwebtoken';
import { supabase } from '../config/supabase';
import { env } from '../config/env';
import { BadRequestError, UnauthorizedError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface JwtPayload {
  sub: string; // wallet address (lowercased)
}

const NONCE_BYTES = 16;

const isValidEvmAddress = (address: string): boolean => ethers.isAddress(address);

const buildSignMessage = (nonce: string): string =>
  `Paytag authentication\n\nSign this message to log in.\n\nNonce: ${nonce}`;

/** Outstanding sign-in nonces kept per wallet; the oldest beyond this are dropped. */
export const MAX_NONCES_PER_WALLET = 10;

const CLEANUP_EVERY_MS = 60_000;
let lastCleanup = 0;

/** Deletes expired nonces, at most once a minute per process. Best-effort. */
const pruneExpiredNonces = async (): Promise<void> => {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_EVERY_MS) return;
  lastCleanup = now;
  const cutoff = new Date(now - env.NONCE_TTL_SECONDS * 1000).toISOString();
  const { error } = await supabase.from('auth_nonces').delete().lt('created_at', cutoff);
  if (error) logger.warn('auth.nonce_cleanup_failed', { message: error.message });
};

/** Tests only. */
export const resetNonceCleanup = (): void => {
  lastCleanup = 0;
};

/**
 * Issues a sign-in nonce. Each request adds one; it never replaces another, so nobody can
 * invalidate the nonce someone else is signing. At most MAX_NONCES_PER_WALLET are kept per
 * wallet (oldest dropped), which bounds the table per wallet whatever the rate limiter allows.
 */
export const createNonce = async (walletAddress: string): Promise<string> => {
  if (!isValidEvmAddress(walletAddress)) {
    throw new BadRequestError('Invalid wallet address', 'INVALID_WALLET');
  }

  const wallet = walletAddress.toLowerCase();
  const nonce = randomBytes(NONCE_BYTES).toString('hex');

  const { error } = await supabase
    .from('auth_nonces')
    .insert({ wallet_address: wallet, nonce, created_at: new Date().toISOString() });
  if (error) {
    throw new Error(`Failed to store nonce: ${error.message}`);
  }

  const { data: excess, error: excessErr } = await supabase
    .from('auth_nonces')
    .select('nonce')
    .eq('wallet_address', wallet)
    .order('created_at', { ascending: false })
    .range(MAX_NONCES_PER_WALLET, MAX_NONCES_PER_WALLET + 99);
  if (excessErr) {
    logger.warn('auth.nonce_cap_failed', { wallet, message: excessErr.message });
  } else if (excess && excess.length > 0) {
    await supabase
      .from('auth_nonces')
      .delete()
      .eq('wallet_address', wallet)
      .in(
        'nonce',
        (excess as { nonce: string }[]).map((row) => row.nonce),
      );
  }

  await pruneExpiredNonces();
  return nonce;
};

interface NonceRow {
  nonce: string;
  created_at: string;
}

const isFresh = (row: NonceRow): boolean =>
  (Date.now() - new Date(row.created_at).getTime()) / 1000 <= env.NONCE_TTL_SECONDS;

/**
 * Verifies a signed nonce and issues a JWT.
 *
 * The message checked is always rebuilt from a stored nonce row for this wallet, never from
 * request data: `nonce` only selects which row. With `nonce` absent (pages loaded before the web
 * app sent it; remove next release) every fresh nonce for the wallet is tried, at most
 * MAX_NONCES_PER_WALLET, so an attacker adding newer nonces can't lock those clients out either.
 */
export const verifySignatureAndIssueToken = async (
  walletAddress: string,
  signature: string,
  nonce?: string,
): Promise<{ token: string; wallet: string }> => {
  if (!isValidEvmAddress(walletAddress)) {
    throw new BadRequestError('Invalid wallet address', 'INVALID_WALLET');
  }

  const wallet = walletAddress.toLowerCase();

  let query = supabase.from('auth_nonces').select('nonce, created_at').eq('wallet_address', wallet);
  query = nonce
    ? query.eq('nonce', nonce)
    : query.order('created_at', { ascending: false }).limit(MAX_NONCES_PER_WALLET);
  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load nonce: ${error.message}`);
  }

  const rows = (data ?? []) as NonceRow[];
  if (rows.length === 0) {
    logger.warn('auth.no_nonce', { wallet });
    throw new UnauthorizedError('No nonce issued for this wallet', 'NONCE_NOT_FOUND');
  }
  const fresh = rows.filter(isFresh);
  if (fresh.length === 0) {
    logger.warn('auth.nonce_expired', { wallet });
    throw new UnauthorizedError('Nonce expired', 'NONCE_EXPIRED');
  }

  let matched: NonceRow | undefined;
  for (const row of fresh) {
    let recovered: string;
    try {
      recovered = ethers.verifyMessage(buildSignMessage(row.nonce), signature);
    } catch {
      logger.warn('auth.signature_malformed', { wallet });
      throw new UnauthorizedError('Invalid signature', 'INVALID_SIGNATURE');
    }
    if (recovered.toLowerCase() === wallet) {
      matched = row;
      break;
    }
  }
  if (!matched) {
    logger.warn('auth.signature_mismatch', { wallet });
    throw new UnauthorizedError('Signature does not match wallet', 'INVALID_SIGNATURE');
  }

  // Single use, atomically: only the request whose delete removed this row gets a token, so two
  // concurrent verifies of one signature can't both succeed. A bad signature never gets here, so
  // it doesn't use the nonce up.
  const { data: consumed, error: consumeErr } = await supabase
    .from('auth_nonces')
    .delete()
    .eq('wallet_address', wallet)
    .eq('nonce', matched.nonce)
    .select('nonce');
  if (consumeErr) {
    throw new Error(`Failed to consume nonce: ${consumeErr.message}`);
  }
  if (!consumed || consumed.length === 0) {
    logger.warn('auth.nonce_already_used', { wallet });
    throw new UnauthorizedError('Nonce already used', 'NONCE_NOT_FOUND');
  }

  const payload: JwtPayload = { sub: wallet };
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  const token = jwt.sign(payload, env.JWT_SECRET, options);

  logger.info('auth.success', { wallet });
  return { token, wallet };
};

export const verifyToken = (token: string): JwtPayload => {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === 'string' || !decoded.sub) {
      throw new UnauthorizedError('Invalid token payload', 'TOKEN_INVALID');
    }
    return { sub: String(decoded.sub) };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Invalid or expired token', 'TOKEN_INVALID');
  }
};

export const _internal = { buildSignMessage };
