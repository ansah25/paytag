import { createHash } from 'crypto';
import { bech32, bech32m } from 'bech32';
import { ethers } from 'ethers';
import { base58ToBytes } from './base58';

// Address format checks, by chain. People pay whatever /resolve returns, so a published address
// must at least be well-formed: checksums are verified wherever the format has one.

/** 0x + 40 hex. A mixed-case address must carry a valid EIP-55 checksum (ICAP is rejected). */
export const isEthereumAddress = (address: string): boolean =>
  /^0x[0-9a-fA-F]{40}$/.test(address) && ethers.isAddress(address);

/** A Solana public key: base58 that decodes to exactly 32 bytes. */
export const isSolanaAddress = (address: string): boolean => {
  if (address.length < 32 || address.length > 44) return false;
  try {
    return base58ToBytes(address).length === 32;
  } catch {
    return false;
  }
};

const sha256 = (data: Uint8Array): Buffer => createHash('sha256').update(data).digest();

/** Legacy mainnet address (P2PKH `1…`, P2SH `3…`): base58check, version 0x00 or 0x05. */
const isBitcoinBase58 = (address: string): boolean => {
  if (address.length < 26 || address.length > 35) return false;
  let bytes: Uint8Array;
  try {
    bytes = base58ToBytes(address);
  } catch {
    return false;
  }
  if (bytes.length !== 25 || (bytes[0] !== 0x00 && bytes[0] !== 0x05)) return false;
  const checksum = sha256(sha256(bytes.subarray(0, 21))).subarray(0, 4);
  return Buffer.from(bytes.subarray(21)).equals(checksum);
};

/**
 * Mainnet segwit address (`bc1…`): bech32 for witness v0 (BIP-173), bech32m for v1+ (BIP-350),
 * with the program lengths those versions allow. Mixed case is invalid by definition.
 */
const isBitcoinSegwit = (address: string): boolean => {
  const lower = address.toLowerCase();
  if (address !== lower && address !== address.toUpperCase()) return false;
  if (!lower.startsWith('bc1') || lower.length > 90) return false;

  const v0 = bech32.decodeUnsafe(lower, 90);
  const v1plus = v0 ? undefined : bech32m.decodeUnsafe(lower, 90);
  const decoded = v0 ?? v1plus;
  if (!decoded || decoded.prefix !== 'bc' || decoded.words.length === 0) return false;

  const version = decoded.words[0];
  if (version > 16) return false;
  // v0 must be bech32 and v1+ must be bech32m (BIP-350).
  if ((version === 0) !== Boolean(v0)) return false;

  const program = bech32.fromWordsUnsafe(decoded.words.slice(1));
  if (!program || program.length < 2 || program.length > 40) return false;
  if (version === 0 && program.length !== 20 && program.length !== 32) return false;
  return true;
};

export const isBitcoinAddress = (address: string): boolean =>
  /^bc1/i.test(address) ? isBitcoinSegwit(address) : isBitcoinBase58(address);

/**
 * Canonical stored form. Case is only folded where the format is case-insensitive: EVM hex and
 * bech32/bech32m. Base58 (legacy Bitcoin, Solana) is case-sensitive and kept byte-for-byte.
 */
export const canonicalAddress = (chain: 'ethereum' | 'solana' | 'bitcoin', address: string): string => {
  if (chain === 'ethereum') return address.toLowerCase();
  if (chain === 'bitcoin' && /^bc1/i.test(address)) return address.toLowerCase();
  return address;
};
