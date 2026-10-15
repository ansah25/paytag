export const SUPPORTED_CHAINS = ['ethereum', 'solana', 'bitcoin'] as const;

export type ChainId = (typeof SUPPORTED_CHAINS)[number];

export interface ResolveResponse {
  username: string;
  addresses: Partial<Record<ChainId, string>>;
}

export type UnavailableReason = 'TAKEN' | 'INVALID_FORMAT' | 'RESERVED';

export interface AvailabilityResponse {
  available: boolean;
  reason?: UnavailableReason;
  suggestions: string[];
}

export const DEFAULT_BASE_URL = 'https://api.paytag.dev';

/** Paytag's on-chain indexer (Ponder over the Base registry + resolver). */
export const DEFAULT_INDEXER_URL = 'https://indexer.paytag.dev';

/** One resolver record as stored on-chain (ENSIP-9 coin type → bytes). */
export interface OnchainRecord {
  /** ENSIP-9 / SLIP-44 coin type as a decimal string (60 = ETH, 0 = BTC, 501 = SOL, …). */
  coinType: string;
  /** Raw record bytes, 0x-prefixed hex. */
  value: string;
  /** Decoded display address, or null when the bytes don't decode for the coin type. */
  address: string | null;
}

/** `resolveViaIndexer` result: the `resolve` shape plus on-chain ownership and raw records. */
export interface OnchainResolveResponse extends ResolveResponse {
  node: string;
  owner: string;
  /** Registration time, unix seconds. */
  registeredAt: number;
  /**
   * Transfers to a different owner so far. A transfer starts a new epoch on-chain and every
   * earlier record stops resolving, so all `records` were set by the current owner.
   */
  epoch: number;
  /**
   * True when the name has changed owner and the current owner hasn't set any record since,
   * as opposed to a name that never had records.
   */
  recordsReset: boolean;
  records: OnchainRecord[];
  source: 'onchain';
}
