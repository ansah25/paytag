import { ethers } from 'ethers';

const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Base58 → bytes, keeping leading zero bytes (encoded as leading "1"s). Throws on bad input. */
export const base58ToBytes = (value: string): Uint8Array => {
  if (!BASE58_REGEX.test(value)) throw new Error('Not base58');
  const leadingZeros = value.match(/^1*/)?.[0].length ?? 0;
  const rest = value.slice(leadingZeros);
  const body = rest ? ethers.toBeArray(ethers.decodeBase58(rest)) : new Uint8Array();
  const bytes = new Uint8Array(leadingZeros + body.length);
  bytes.set(body, leadingZeros);
  return bytes;
};
