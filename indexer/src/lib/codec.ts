import { base58, bech32, bech32m, createBase58check } from "@scure/base";
import { type Hex, bytesToHex, getAddress, hexToBytes, isAddress, sha256 } from "viem";

// ENSIP-9 address encodings for resolver records. The contract stores opaque bytes; this module
// is the single definition of what those bytes mean for each coin type.
//   60          Ethereum: the 20 address bytes
//   501         Solana:   the 32-byte ed25519 public key (base58-decoded)
//   0           Bitcoin:  the output's scriptPubKey (P2PKH, P2SH, P2WPKH, P2WSH, P2TR), mainnet
//   0x80000000|chainId    other EVM chains (ENSIP-11): 20 address bytes
// Unknown coin types and undecodable bytes yield null: callers still get the raw hex.

export const COIN_TYPE = {
  BTC: 0n,
  ETH: 60n,
  SOL: 501n,
} as const;

// ENSIP-11: coinType = 0x80000000 | chainId with chainId < 2^31, i.e. exactly bit 31 of a
// 32-bit value.
const EVM_CHAIN_FLAG = 0x80000000n;
const EVM_CHAIN_MASK = ~0x7fffffffn;

const base58check = createBase58check((data: Uint8Array) => sha256(data, "bytes"));

const P2PKH_VERSION = 0x00;
const P2SH_VERSION = 0x05;
const BTC_HRP = "bc";

export function isEvmCoinType(coinType: bigint): boolean {
  return coinType === COIN_TYPE.ETH || (coinType & EVM_CHAIN_MASK) === EVM_CHAIN_FLAG;
}

/** Decode record bytes to the chain's display address, or null if they don't decode. */
export function decodeAddress(coinType: bigint, value: Hex): string | null {
  const bytes = hexToBytes(value);
  if (bytes.length === 0) return null;
  try {
    if (isEvmCoinType(coinType)) {
      return bytes.length === 20 ? getAddress(value) : null;
    }
    if (coinType === COIN_TYPE.SOL) {
      return bytes.length === 32 ? base58.encode(bytes) : null;
    }
    if (coinType === COIN_TYPE.BTC) return decodeBitcoinScript(bytes);
  } catch {
    return null;
  }
  return null;
}

/** Encode a display address to record bytes. Throws on an invalid address for the coin type. */
export function encodeAddress(coinType: bigint, address: string): Hex {
  if (isEvmCoinType(coinType)) {
    // EIP-55: all-lowercase or all-uppercase hex carries no checksum; mixed case must be valid.
    const hex = address.slice(2);
    const uncased = hex === hex.toLowerCase() || hex === hex.toUpperCase();
    if (!isAddress(address, { strict: !uncased })) {
      throw new Error("invalid EVM address or checksum");
    }
    return address.toLowerCase() as Hex;
  }
  if (coinType === COIN_TYPE.SOL) {
    const bytes = base58.decode(address);
    if (bytes.length !== 32) throw new Error("invalid Solana address: expected 32 bytes");
    return bytesToHex(bytes);
  }
  if (coinType === COIN_TYPE.BTC) return bytesToHex(encodeBitcoinScript(address));
  throw new Error(`unsupported coin type ${coinType}`);
}

function decodeBitcoinScript(s: Uint8Array): string | null {
  // P2PKH: OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
  if (s.length === 25 && s[0] === 0x76 && s[1] === 0xa9 && s[2] === 0x14 && s[23] === 0x88 && s[24] === 0xac) {
    return base58check.encode(concat([P2PKH_VERSION], s.subarray(3, 23)));
  }
  // P2SH: OP_HASH160 <20> OP_EQUAL
  if (s.length === 23 && s[0] === 0xa9 && s[1] === 0x14 && s[22] === 0x87) {
    return base58check.encode(concat([P2SH_VERSION], s.subarray(2, 22)));
  }
  // Segwit v0: OP_0 <20 | 32>
  if (s[0] === 0x00 && s[1] === s.length - 2 && (s.length === 22 || s.length === 34)) {
    return bech32.encode(BTC_HRP, [0, ...bech32.toWords(s.subarray(2))]);
  }
  // Taproot (segwit v1): OP_1 <32>
  if (s.length === 34 && s[0] === 0x51 && s[1] === 0x20) {
    return bech32m.encode(BTC_HRP, [1, ...bech32m.toWords(s.subarray(2))]);
  }
  return null;
}

function encodeBitcoinScript(address: string): Uint8Array {
  if (address.toLowerCase().startsWith(`${BTC_HRP}1`)) {
    // BIP-173: all-lowercase or all-uppercase only. Version 0 must be bech32 and version 1+
    // bech32m (BIP-350); each decoder rejects the other.
    if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
      throw new Error("mixed-case bech32 address");
    }
    const lower = address.toLowerCase();
    const v0 = bech32.decodeUnsafe(lower);
    if (v0 && v0.prefix === BTC_HRP && v0.words[0] === 0) {
      const program = bech32.fromWords(v0.words.slice(1));
      if (program.length !== 20 && program.length !== 32) throw new Error("invalid segwit v0 program");
      return concat([0x00, program.length], program);
    }
    const v1 = bech32m.decodeUnsafe(lower);
    if (v1 && v1.prefix === BTC_HRP && v1.words[0] === 1) {
      const program = bech32m.fromWords(v1.words.slice(1));
      if (program.length !== 32) throw new Error("invalid taproot program");
      return concat([0x51, 0x20], program);
    }
    throw new Error("invalid or unsupported bech32 address");
  }
  const payload = base58check.decode(address);
  if (payload.length !== 21) throw new Error("invalid base58 address length");
  const hash = payload.subarray(1);
  if (payload[0] === P2PKH_VERSION) return concat([0x76, 0xa9, 0x14], hash, [0x88, 0xac]);
  if (payload[0] === P2SH_VERSION) return concat([0xa9, 0x14], hash, [0x87]);
  throw new Error("unsupported base58 version (mainnet P2PKH/P2SH only)");
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
