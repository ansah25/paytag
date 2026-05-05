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

export const createNonce = async (walletAddress: string): Promise<string> => {
  if (!isValidEvmAddress(walletAddress)) {
    throw new BadRequestError('Invalid wallet address', 'INVALID_WALLET');
  }

  const wallet = walletAddress.toLowerCase();
  const nonce = randomBytes(NONCE_BYTES).toString('hex');

  const { error } = await supabase
    .from('auth_nonces')
    .upsert({ wallet_address: wallet, nonce, created_at: new Date().toISOString() });

  if (error) {
    throw new Error(`Failed to store nonce: ${error.message}`);
  }

  return nonce;
};

export const verifySignatureAndIssueToken = async (
  walletAddress: string,
  signature: string,
): Promise<{ token: string; wallet: string }> => {
  if (!isValidEvmAddress(walletAddress)) {
    throw new BadRequestError('Invalid wallet address', 'INVALID_WALLET');
  }

  const wallet = walletAddress.toLowerCase();

  const { data, error } = await supabase
    .from('auth_nonces')
    .select('nonce, created_at')
    .eq('wallet_address', wallet)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load nonce: ${error.message}`);
  }
  if (!data) {
    logger.warn('auth.no_nonce', { wallet });
    throw new UnauthorizedError('No nonce issued for this wallet', 'NONCE_NOT_FOUND');
  }

  const ageSeconds = (Date.now() - new Date(data.created_at).getTime()) / 1000;
  if (ageSeconds > env.NONCE_TTL_SECONDS) {
    await supabase.from('auth_nonces').delete().eq('wallet_address', wallet);
    logger.warn('auth.nonce_expired', { wallet });
    throw new UnauthorizedError('Nonce expired', 'NONCE_EXPIRED');
  }

  let recovered: string;
  try {
    recovered = ethers.verifyMessage(buildSignMessage(data.nonce), signature);
  } catch {
    logger.warn('auth.signature_malformed', { wallet });
    throw new UnauthorizedError('Invalid signature', 'INVALID_SIGNATURE');
  }

  if (recovered.toLowerCase() !== wallet) {
    logger.warn('auth.signature_mismatch', { wallet });
    throw new UnauthorizedError('Signature does not match wallet', 'INVALID_SIGNATURE');
  }

  // Single-use nonce: delete after successful verification (replay protection)
  await supabase.from('auth_nonces').delete().eq('wallet_address', wallet);

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
