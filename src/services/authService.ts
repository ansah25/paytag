import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { ethers } from 'ethers';
import jwt, { SignOptions } from 'jsonwebtoken';
import { supabase } from '../config/supabase';
import { env } from '../config/env';
import { BadRequestError, UnauthorizedError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface JwtPayload {
  sub: string; // wallet address (lowercased)
}

// Sign-in nonces are stateless: the server issues `issuedAt | random | MAC` and stores nothing, so
// there is no per-wallet state anyone can evict, flood or overwrite to lock a user out. The MAC
// binds the nonce to the wallet it was issued for. Single use is enforced on success only, by
// recording the spent nonce (auth_nonces_used); that table grows only with real sign-ins.
//
// Layout, 80 lowercase hex chars: issuedAt (unix seconds, 16 hex) | random (16 bytes, 32 hex) |
// MAC (first 16 bytes of HMAC-SHA256, 32 hex).

const RANDOM_BYTES = 16;
const NONCE_PATTERN = /^[0-9a-f]{80}$/;

/** How far in the future an issuedAt may be (clock skew between API machines). */
export const NONCE_FUTURE_TOLERANCE_SECONDS = 30;

/**
 * How long a spent nonce is remembered. The invariant the design rests on: a nonce stays
 * acceptable until issuedAt + NONCE_TTL_SECONDS, and issuedAt can be up to the future tolerance
 * ahead, so a spent row must outlive NONCE_TTL_SECONDS + NONCE_FUTURE_TOLERANCE_SECONDS or the
 * nonce becomes replayable once its row is pruned. Derived from the TTL so tuning one can't break
 * it; tests/authService.test.ts asserts it.
 */
export const usedNonceRetentionSeconds = (): number =>
  Math.max(15 * 60, 3 * (env.NONCE_TTL_SECONDS + NONCE_FUTURE_TOLERANCE_SECONDS));

// A key of its own, derived from JWT_SECRET, so nonce MACs and JWT signatures never share a key.
const nonceKey = createHmac('sha256', env.JWT_SECRET).update('paytag/auth-nonce/v1').digest();

/**
 * MAC over an unambiguous encoding: a version tag and newline-separated fields. The wallet is
 * 0x + 40 lowercase hex (validated) and the other fields fixed-width hex, so no two different
 * tuples serialize to the same bytes, and adding a field means bumping the tag.
 */
const nonceMac = (wallet: string, issuedHex: string, randomHex: string): Buffer =>
  createHmac('sha256', nonceKey)
    .update(`paytag-auth-nonce-v1\n${wallet}\n${issuedHex}\n${randomHex}`)
    .digest()
    .subarray(0, 16);

const isValidEvmAddress = (address: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(address) && ethers.isAddress(address);

const buildSignMessage = (nonce: string): string =>
  `Paytag authentication\n\nSign this message to log in.\n\nNonce: ${nonce}`;

/** Issues a sign-in nonce for `walletAddress`. Writes nothing. */
export const createNonce = async (walletAddress: string): Promise<string> => {
  if (!isValidEvmAddress(walletAddress)) {
    throw new BadRequestError('Invalid wallet address', 'INVALID_WALLET');
  }
  const wallet = walletAddress.toLowerCase();
  const issuedHex = Math.floor(Date.now() / 1000).toString(16).padStart(16, '0');
  const randomHex = randomBytes(RANDOM_BYTES).toString('hex');
  return issuedHex + randomHex + nonceMac(wallet, issuedHex, randomHex).toString('hex');
};

/** Seconds of issuedAt, if `nonce` was issued by this server for `wallet`; else null. */
const authenticateNonce = (wallet: string, nonce: string): number | null => {
  if (!NONCE_PATTERN.test(nonce)) return null;
  const issuedHex = nonce.slice(0, 16);
  const randomHex = nonce.slice(16, 48);
  const presented = Buffer.from(nonce.slice(48), 'hex');
  const expected = nonceMac(wallet, issuedHex, randomHex);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;
  const issued = Number.parseInt(issuedHex, 16);
  return Number.isSafeInteger(issued) ? issued : null;
};

const PRUNE_EVERY_MS = 60_000;
let lastPrune = 0;

/** Forgets spent nonces older than the retention window, at most once a minute. Best-effort. */
const pruneUsedNonces = async (): Promise<void> => {
  const now = Date.now();
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  const cutoff = new Date(now - usedNonceRetentionSeconds() * 1000).toISOString();
  const { error } = await supabase.from('auth_nonces_used').delete().lt('used_at', cutoff);
  if (error) logger.warn('auth.used_nonce_prune_failed', { message: error.message });
};

/** Tests only. */
export const resetUsedNoncePrune = (): void => {
  lastPrune = 0;
};

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Verifies a signed nonce and issues a JWT. The message checked is rebuilt from the nonce only
 * after its MAC proves this server issued it for this wallet, so request data can't choose what
 * text is verified. Without `nonce` (a page loaded before the web app sent it) the request is
 * refused as CLIENT_OUTDATED: a stateless nonce can't be looked up from the wallet alone.
 */
export const verifySignatureAndIssueToken = async (
  walletAddress: string,
  signature: string,
  nonce?: string,
): Promise<{ token: string; wallet: string }> => {
  if (!isValidEvmAddress(walletAddress)) {
    throw new BadRequestError('Invalid wallet address', 'INVALID_WALLET');
  }
  if (!nonce) {
    throw new BadRequestError('This page is out of date. Reload the page and sign in again.', 'CLIENT_OUTDATED');
  }

  const wallet = walletAddress.toLowerCase();
  const issued = authenticateNonce(wallet, nonce);
  if (issued === null) {
    logger.warn('auth.nonce_invalid', { wallet });
    throw new UnauthorizedError('Invalid nonce', 'NONCE_INVALID');
  }
  const nowSeconds = Date.now() / 1000;
  if (issued > nowSeconds + NONCE_FUTURE_TOLERANCE_SECONDS) {
    logger.warn('auth.nonce_from_future', { wallet });
    throw new UnauthorizedError('Invalid nonce', 'NONCE_INVALID');
  }
  if (nowSeconds - issued > env.NONCE_TTL_SECONDS) {
    throw new UnauthorizedError('Nonce expired', 'NONCE_EXPIRED');
  }

  let recovered: string;
  try {
    recovered = ethers.verifyMessage(buildSignMessage(nonce), signature);
  } catch {
    logger.warn('auth.signature_malformed', { wallet });
    throw new UnauthorizedError('Invalid signature', 'INVALID_SIGNATURE');
  }
  if (recovered.toLowerCase() !== wallet) {
    logger.warn('auth.signature_mismatch', { wallet });
    throw new UnauthorizedError('Signature does not match wallet', 'INVALID_SIGNATURE');
  }

  // Single use, atomically: the primary key (wallet_address, nonce) lets exactly one insert in.
  const { error } = await supabase
    .from('auth_nonces_used')
    .insert({ wallet_address: wallet, nonce, used_at: new Date().toISOString() });
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      logger.warn('auth.nonce_reused', { wallet });
      throw new UnauthorizedError('Nonce already used', 'NONCE_USED');
    }
    throw new Error(`Failed to record nonce: ${error.message}`);
  }
  await pruneUsedNonces();

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
