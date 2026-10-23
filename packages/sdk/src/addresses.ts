import type { ChainId } from './types';

// Format checks for the addresses a server returns. People pay whatever `resolve` hands back,
// so the SDK refuses one that isn't well-formed for its chain. These are deliberately no
// stricter than the API's own checks (the API is the gate; this is the backstop), and need no
// dependencies:
//   ethereum  0x + 40 hex. Case isn't checked: the API stores EVM addresses lowercase.
//   solana    base58 that decodes to a 32-byte public key.
//   bitcoin   mainnet segwit with a valid bech32/bech32m checksum, or legacy P2PKH/P2SH base58
//             of 25 bytes (version 0x00/0x05). The legacy checksum needs SHA-256, which isn't
//             available synchronously in browsers, so it is left to the API.
// Every length is capped before decoding, so a hostile response can't make decoding slow.

const ETH_REGEX = /^0x[0-9a-fA-F]{40}$/;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58 → bytes, keeping leading zero bytes ("1"s). Null on any non-base58 character. */
export function base58Decode(value: string): Uint8Array | null {
  if (value.length === 0) return null;
  const bytes: number[] = [];
  for (const char of value) {
    let carry = BASE58_ALPHABET.indexOf(char);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  while (zeros < value.length && value[zeros] === '1') zeros++;
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i]!;
  return out;
}

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) ^ v) >>> 0;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk = (chk ^ BECH32_GENERATOR[i]!) >>> 0;
    }
  }
  return chk;
}

/** Regroup 5-bit words into bytes (BIP-173 convertbits, no padding allowed). */
function wordsToBytes(words: number[]): Uint8Array | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits >= 5 || acc !== 0) return null;
  return Uint8Array.from(out);
}

/** A mainnet segwit address's witness version and program, or null if it isn't one. */
export function decodeSegwit(address: string): { version: number; program: Uint8Array } | null {
  if (address.length > 90) return null;
  const lower = address.toLowerCase();
  // BIP-173: all-lowercase or all-uppercase only.
  if (address !== lower && address !== address.toUpperCase()) return null;
  if (!lower.startsWith('bc1')) return null;

  const data: number[] = [];
  for (const char of lower.slice(3)) {
    const v = BECH32_CHARSET.indexOf(char);
    if (v < 0) return null;
    data.push(v);
  }
  if (data.length < 7) return null; // version + 6 checksum words

  // hrp "bc" expanded: high bits, 0, low bits.
  const check = bech32Polymod([3, 3, 0, 2, 3, ...data]);
  const version = data[0]!;
  if (version > 16) return null;
  // Version 0 must use bech32 and versions 1+ bech32m (BIP-350).
  if (check !== (version === 0 ? BECH32_CONST : BECH32M_CONST)) return null;

  const program = wordsToBytes(data.slice(1, -6));
  if (!program || program.length < 2 || program.length > 40) return null;
  if (version === 0 && program.length !== 20 && program.length !== 32) return null;
  return { version, program };
}

/** A legacy mainnet address's version byte and 20-byte hash, or null if it isn't one. */
export function decodeBitcoinBase58(address: string): { version: number; hash: Uint8Array } | null {
  if (address.length < 26 || address.length > 35) return null;
  const bytes = base58Decode(address);
  if (!bytes || bytes.length !== 25 || (bytes[0] !== 0x00 && bytes[0] !== 0x05)) return null;
  return { version: bytes[0]!, hash: bytes.subarray(1, 21) };
}

export function isSolanaAddress(address: string): boolean {
  if (address.length < 32 || address.length > 44) return false;
  return base58Decode(address)?.length === 32;
}

export function isBitcoinAddress(address: string): boolean {
  return /^bc1/i.test(address) ? decodeSegwit(address) !== null : decodeBitcoinBase58(address) !== null;
}

export function isValidAddress(chain: ChainId, address: string): boolean {
  switch (chain) {
    case 'ethereum':
      return ETH_REGEX.test(address);
    case 'solana':
      return isSolanaAddress(address);
    case 'bitcoin':
      return isBitcoinAddress(address);
  }
}

const toHex = (bytes: Uint8Array | number[]): string =>
  `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;

/**
 * The on-chain record bytes (ENSIP-9) for a valid address, as lowercase 0x-hex: ETH the 20
 * address bytes, SOL the 32-byte public key, BTC the output script. Null if it doesn't encode.
 */
export function recordValueFor(chain: ChainId, address: string): string | null {
  if (!isValidAddress(chain, address)) return null;
  if (chain === 'ethereum') return address.toLowerCase();
  if (chain === 'solana') return toHex(base58Decode(address)!);

  const segwit = /^bc1/i.test(address) ? decodeSegwit(address) : null;
  if (segwit) {
    // OP_0 or OP_1..OP_16, then a push of the program.
    const op = segwit.version === 0 ? 0x00 : 0x50 + segwit.version;
    return toHex([op, segwit.program.length, ...segwit.program]);
  }
  const legacy = decodeBitcoinBase58(address)!;
  return legacy.version === 0x00
    ? toHex([0x76, 0xa9, 0x14, ...legacy.hash, 0x88, 0xac]) // P2PKH
    : toHex([0xa9, 0x14, ...legacy.hash, 0x87]); // P2SH
}
