import { z } from 'zod';

// Upper bounds on every string the API accepts, checked by Zod before any service code runs (a
// long input must never reach normalization or a regex). Generous next to the real formats.
export const MAX_LEN = {
  username: 64, // the real rule is 3–20 after trimming
  wallet: 100,
  authSignature: 200, // EIP-191 hex is 132
  address: 128,
  chain: 32,
  nonce: 64, // 32 hex
} as const;

export const bounded = (max: number) => z.string().min(1).max(max);
