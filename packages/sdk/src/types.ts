export const SUPPORTED_CHAINS = ['ethereum', 'solana', 'bitcoin'] as const;

export type ChainId = (typeof SUPPORTED_CHAINS)[number];

/**
 * Whether the on-chain name of the same spelling belongs to this account:
 * - `linked`: its on-chain owner is the account's verified Ethereum address.
 * - `not_linked`: someone holds it on-chain, but not that address.
 * - `none`: not registered on-chain.
 * - `syncing` / `unavailable`: the API couldn't tell right now (indexer syncing / unreachable).
 */
export type OnchainLinkStatus = 'linked' | 'not_linked' | 'none' | 'syncing' | 'unavailable';

export interface ResolveResponse {
  username: string;
  addresses: Partial<Record<ChainId, string>>;
  /** From `resolve` (the API) only; absent on older API versions. */
  onchain?: { status: OnchainLinkStatus };
}

/** `TAKEN_ONCHAIN`: free off-chain, but registered on-chain by a different wallet. */
export type UnavailableReason = 'TAKEN' | 'INVALID_FORMAT' | 'RESERVED' | 'TAKEN_ONCHAIN';

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
export interface OnchainResolveResponse extends Omit<ResolveResponse, 'onchain'> {
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
