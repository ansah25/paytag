import { createPublicKey, randomBytes, verify as verifyEd25519 } from 'crypto';
import { ethers } from 'ethers';
import { supabase } from '../config/supabase';
import { env } from '../config/env';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';
import { base58ToBytes } from '../utils/base58';
import { assertSupportedChain, Chain, findOwnedUser, invalidateResolveCache } from './walletService';

const NONCE_BYTES = 16;

const CHAIN_LABEL: Record<Chain, string> = {
  ethereum: 'Ethereum',
  solana: 'Solana',
  bitcoin: 'Bitcoin',
};

/** Bitcoin (BIP-322) message verification isn't implemented yet. */
export const VERIFIABLE_CHAINS: readonly Chain[] = ['ethereum', 'solana'];

export const buildVerificationMessage = (params: {
  username: string;
  chain: Chain;
  address: string;
  nonce: string;
}): string =>
  [
    'Paytag address verification',
    '',
    `I control this ${CHAIN_LABEL[params.chain]} address and link it to @${params.username}.`,
    '',
    `Address: ${params.address}`,
    `Nonce: ${params.nonce}`,
  ].join('\n');

/**
 * Whether `signature` over `message` was made by the key behind `address`.
 * EVM: EIP-191 personal_sign (hex). Solana: ed25519 over the UTF-8 message
 * (base64). Never throws — malformed input is simply not verified.
 */
export const verifyChainSignature = (
  chain: Chain,
  address: string,
  message: string,
  signature: string,
): boolean => {
  try {
    if (chain === 'ethereum') {
      return ethers.verifyMessage(message, signature).toLowerCase() === address.toLowerCase();
    }
    if (chain === 'solana') {
      const publicKey = base58ToBytes(address);
      const sig = Buffer.from(signature, 'base64');
      if (publicKey.length !== 32 || sig.length !== 64) return false;
      const key = createPublicKey({
        key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey).toString('base64url') },
        format: 'jwk',
      });
      return verifyEd25519(null, Buffer.from(message, 'utf8'), key, sig);
    }
    return false;
  } catch {
    return false;
  }
};

export interface VerificationChallenge {
  chain: Chain;
  address: string;
  message: string;
}

export const createVerificationChallenge = async (
  ownerWallet: string,
  rawChain: string,
): Promise<VerificationChallenge> => {
  const chain = assertSupportedChain(rawChain);
  if (!VERIFIABLE_CHAINS.includes(chain)) {
    throw new BadRequestError(
      `${CHAIN_LABEL[chain]} verification isn't supported yet`,
      'VERIFICATION_UNSUPPORTED',
    );
  }

  const user = await findOwnedUser(ownerWallet);
  const { data: mapping, error: mappingErr } = await supabase
    .from('wallet_mappings')
    .select('address')
    .eq('user_id', user.id)
    .eq('chain', chain)
    .maybeSingle();

  if (mappingErr) {
    throw new Error(`Failed to load address: ${mappingErr.message}`);
  }
  if (!mapping) {
    throw new NotFoundError('No address mapped for this chain', 'ADDRESS_NOT_FOUND');
  }

  const address = (mapping as { address: string }).address;
  const nonce = randomBytes(NONCE_BYTES).toString('hex');
  const { error } = await supabase
    .from('address_verification_nonces')
    .upsert(
      { user_id: user.id, chain, address, nonce, created_at: new Date().toISOString() },
      { onConflict: 'user_id,chain' },
    );

  if (error) {
    throw new Error(`Failed to store verification nonce: ${error.message}`);
  }

  return {
    chain,
    address,
    message: buildVerificationMessage({ username: user.username, chain, address, nonce }),
  };
};

export const verifyAddress = async (
  ownerWallet: string,
  rawChain: string,
  signature: string,
): Promise<{ chain: Chain; verified: true; verifiedAt: string }> => {
  const chain = assertSupportedChain(rawChain);
  const user = await findOwnedUser(ownerWallet);

  const { data, error } = await supabase
    .from('address_verification_nonces')
    .select('address, nonce, created_at')
    .eq('user_id', user.id)
    .eq('chain', chain)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load verification nonce: ${error.message}`);
  }
  if (!data) {
    throw new BadRequestError('No verification in progress for this chain', 'CHALLENGE_NOT_FOUND');
  }
  const challenge = data as { address: string; nonce: string; created_at: string };

  // Single-use: consume the challenge whatever the outcome (replay protection). Atomic: only the
  // request whose delete removed this exact challenge goes on, so two concurrent submissions of
  // one signature can't both succeed, and a newer challenge isn't consumed by mistake.
  const { data: consumed, error: consumeErr } = await supabase
    .from('address_verification_nonces')
    .delete()
    .eq('user_id', user.id)
    .eq('chain', chain)
    .eq('nonce', challenge.nonce)
    .select('nonce');
  if (consumeErr) {
    throw new Error(`Failed to consume verification nonce: ${consumeErr.message}`);
  }
  if (!consumed || consumed.length === 0) {
    throw new BadRequestError('No verification in progress for this chain', 'CHALLENGE_NOT_FOUND');
  }

  const ageSeconds = (Date.now() - new Date(challenge.created_at).getTime()) / 1000;
  if (ageSeconds > env.NONCE_TTL_SECONDS) {
    throw new BadRequestError('Verification request expired. Start again.', 'CHALLENGE_EXPIRED');
  }

  const message = buildVerificationMessage({
    username: user.username,
    chain,
    address: challenge.address,
    nonce: challenge.nonce,
  });
  // 400, not 401: a bad address signature says nothing about the session.
  if (!verifyChainSignature(chain, challenge.address, message, signature)) {
    logger.warn('address.verify_mismatch', { username: user.username, chain });
    throw new BadRequestError('Signature does not match this address', 'INVALID_SIGNATURE');
  }

  const verifiedAt = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from('wallet_mappings')
    .update({ verified_at: verifiedAt })
    .eq('user_id', user.id)
    .eq('chain', chain)
    .eq('address', challenge.address)
    .select('chain');

  if (updateErr) {
    throw new Error(`Failed to mark address verified: ${updateErr.message}`);
  }
  if (!updated || updated.length === 0) {
    throw new ConflictError('The address changed while verifying. Start again.', 'ADDRESS_CHANGED');
  }

  invalidateResolveCache(user.username);
  logger.info('address.verified', { username: user.username, chain });
  return { chain, verified: true, verifiedAt };
};
