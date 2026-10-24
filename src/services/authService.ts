import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { ethers } from 'ethers';
import jwt, { SignOptions } from 'jsonwebtoken';
import { supabase } from '../config/supabase';
import { env, jwtExpiresInSeconds, siweDomains } from '../config/env';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../utils/errors';
import { logger } from '../utils/logger';
import { dbError } from '../utils/dbErrors';

export interface JwtPayload {
  sub: string; // wallet address (lowercased)
  /** The account's session_version when the token was issued; see requireAuth. */
  sv: number;
}

const JWT_ISSUER = 'api.paytag.dev';
const JWT_AUDIENCE = 'paytag-web';

// Sign-in nonces are stateless: the server issues `issuedAt | random | MAC` and stores nothing, so
// there is no per-wallet state anyone can evict, flood or overwrite to lock a user out. The MAC
// binds the nonce to the wallet and the sign-in domain it was issued for. Single use is enforced on success only, by
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
 * 0x + 40 lowercase hex, the domain host[:port] (validated, no newlines) and the other fields
 * fixed-width hex, so no two different tuples serialize to the same bytes. Adding a field means
 * bumping the tag (v2 added the domain).
 */
const nonceMac = (wallet: string, domain: string, issuedHex: string, randomHex: string): Buffer =>
  createHmac('sha256', nonceKey)
    .update(`paytag-auth-nonce-v2\n${wallet}\n${domain}\n${issuedHex}\n${randomHex}`)
    .digest()
    .subarray(0, 16);

const isValidEvmAddress = (address: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(address) && ethers.isAddress(address);

// --- Sign-In with Ethereum (EIP-4361) ---------------------------------------------------------
//
// The server writes the whole message and the client signs it verbatim, so wallets that check
// SIWE domains warn when a page on another origin asks for it (phishing). The allowlist stops a
// site requesting a message naming its own domain; the Origin check stops it requesting one
// naming ours from a browser.
//
// Chain ID is 1 on purpose. Verification is ecrecover only (EOAs), and for an EOA the chain ID
// carries no meaning; a Paytag account is not tied to one chain either. Known limitation:
// smart-contract wallets (Coinbase Smart Wallet, Safe) can't sign in, because their signatures
// verify through EIP-1271 isValidSignature on the chain the account is deployed on. Adding that
// means setting Chain ID to that chain (most likely Base, 8453) and calling the account there.
export const SIWE_CHAIN_ID = 1;
const SIWE_STATEMENT = 'Sign in to Paytag.';

const isLocalHost = (domain: string): boolean => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(domain);
const siweScheme = (domain: string): 'http' | 'https' => (isLocalHost(domain) ? 'http' : 'https');
const siweUri = (domain: string): string => `${siweScheme(domain)}://${domain}`;

/**
 * The exact text signed. Issued At comes from the nonce and Expiration Time is Issued At plus
 * NONCE_TTL_SECONDS, the same constant verify enforces, so the message never claims a validity
 * the server doesn't honour.
 */
export const buildSiweMessage = (params: { domain: string; wallet: string; nonce: string; issuedAt: number }): string =>
  [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    ethers.getAddress(params.wallet),
    '',
    SIWE_STATEMENT,
    '',
    `URI: ${siweUri(params.domain)}`,
    'Version: 1',
    `Chain ID: ${SIWE_CHAIN_ID}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${new Date(params.issuedAt * 1000).toISOString()}`,
    `Expiration Time: ${new Date((params.issuedAt + env.NONCE_TTL_SECONDS) * 1000).toISOString()}`,
  ].join('\n');

/**
 * `domain` must be on the allowlist, and when the request carries an Origin (browsers always do
 * on these cross-origin calls) its host must be that domain. Non-browser callers send no Origin;
 * the allowlist still applies to them.
 */
const assertSignInDomain = (domain: string, origin: string | undefined): void => {
  if (!siweDomains.includes(domain)) {
    throw new BadRequestError('Sign-in is not available for this site', 'DOMAIN_NOT_ALLOWED');
  }
  if (origin === undefined) return;
  // Host and scheme: the page asking must be exactly the origin the message's URI names.
  let originHost: string | null = null;
  let originScheme: string | null = null;
  try {
    const url = new URL(origin);
    originHost = url.host;
    originScheme = url.protocol;
  } catch {
    originHost = null;
  }
  if (originHost !== domain || originScheme !== `${siweScheme(domain)}:`) {
    throw new BadRequestError('Sign-in domain does not match this site', 'ORIGIN_MISMATCH');
  }
};

/** Issues a sign-in nonce and the SIWE message to sign. Writes nothing. */
export const createNonce = async (
  walletAddress: string,
  domain: string,
  origin?: string,
): Promise<{ nonce: string; message: string }> => {
  if (!isValidEvmAddress(walletAddress)) {
    throw new BadRequestError('Invalid wallet address', 'INVALID_WALLET');
  }
  assertSignInDomain(domain, origin);
  const wallet = walletAddress.toLowerCase();
  const issuedAt = Math.floor(Date.now() / 1000);
  const issuedHex = issuedAt.toString(16).padStart(16, '0');
  const randomHex = randomBytes(RANDOM_BYTES).toString('hex');
  const nonce = issuedHex + randomHex + nonceMac(wallet, domain, issuedHex, randomHex).toString('hex');
  return { nonce, message: buildSiweMessage({ domain, wallet, nonce, issuedAt }) };
};

/** Seconds of issuedAt, if `nonce` was issued by this server for `wallet` and `domain`; else null. */
const authenticateNonce = (wallet: string, domain: string, nonce: string): number | null => {
  if (!NONCE_PATTERN.test(nonce)) return null;
  const issuedHex = nonce.slice(0, 16);
  const randomHex = nonce.slice(16, 48);
  const presented = Buffer.from(nonce.slice(48), 'hex');
  const expected = nonceMac(wallet, domain, issuedHex, randomHex);
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
 * Verifies a signed SIWE message and issues a JWT. The message checked is rebuilt by the server
 * from the nonce, and only after its MAC proves this server issued it for this wallet and domain,
 * so request data can't choose what text is verified. Without `nonce` and `domain` (a page loaded
 * before the SIWE change) the request is refused as CLIENT_OUTDATED.
 */
export const verifySignatureAndIssueToken = async (
  walletAddress: string,
  signature: string,
  nonce?: string,
  domain?: string,
  origin?: string,
): Promise<{ token: string; wallet: string }> => {
  if (!isValidEvmAddress(walletAddress)) {
    throw new BadRequestError('Invalid wallet address', 'INVALID_WALLET');
  }
  if (!nonce || !domain) {
    throw new BadRequestError('This page is out of date. Reload the page and sign in again.', 'CLIENT_OUTDATED');
  }
  assertSignInDomain(domain, origin);

  const wallet = walletAddress.toLowerCase();
  const issued = authenticateNonce(wallet, domain, nonce);
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
    recovered = ethers.verifyMessage(buildSiweMessage({ domain, wallet, nonce, issuedAt: issued }), signature);
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
    throw dbError('record nonce', error);
  }
  // In the background: the nonce is already spent, so a prune failure must not fail the sign-in.
  void pruneUsedNonces().catch((err: unknown) =>
    logger.warn('auth.used_nonce_prune_failed', { message: err instanceof Error ? err.message : String(err) }),
  );

  const token = signSessionToken(wallet, (await getSessionVersion(wallet)) ?? 0);
  logger.info('auth.success', { wallet });
  return { token, wallet };
};

// --- Sessions ------------------------------------------------------------------------------------

/** users.session_version for the account owned by `wallet`, or null if it has no account. */
export const getSessionVersion = async (wallet: string): Promise<number | null> => {
  const { data, error } = await supabase
    .from('users')
    .select('session_version')
    .eq('owner_wallet', wallet.toLowerCase())
    .maybeSingle();
  if (error) throw dbError('load session version', error);
  return data ? Number((data as { session_version: number }).session_version) : null;
};

export const signSessionToken = (wallet: string, sessionVersion: number): string => {
  const payload: JwtPayload = { sub: wallet.toLowerCase(), sv: sessionVersion };
  const options: SignOptions = {
    expiresIn: jwtExpiresInSeconds,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: 'HS256',
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
};

/**
 * Invalidates every token issued for this wallet's account by bumping session_version. Tokens are
 * checked against it on each authenticated request (requireAuth).
 */
export const revokeAllSessions = async (wallet: string): Promise<void> => {
  const current = await getSessionVersion(wallet);
  if (current === null) throw new NotFoundError('No account for this wallet', 'USER_NOT_FOUND');
  const { error } = await supabase
    .from('users')
    .update({ session_version: current + 1 })
    .eq('owner_wallet', wallet.toLowerCase())
    .eq('session_version', current);
  // No row matched: a concurrent revoke already bumped it, which revokes these tokens too.
  if (error) throw dbError('revoke sessions', error);
  logger.info('auth.sessions_revoked', { wallet: wallet.toLowerCase() });
};

/** Signature, expiry, issuer and audience. The session-version check is requireAuth's. */
export const verifyToken = (token: string): JwtPayload => {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof decoded === 'string' || !decoded.sub || typeof decoded.sv !== 'number') {
      throw new UnauthorizedError('Invalid token payload', 'TOKEN_INVALID');
    }
    return { sub: String(decoded.sub), sv: decoded.sv };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Invalid or expired token', 'TOKEN_INVALID');
  }
};

