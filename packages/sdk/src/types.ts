export const SUPPORTED_CHAINS = ['ethereum', 'solana', 'bitcoin'] as const;

export type ChainId = (typeof SUPPORTED_CHAINS)[number];

/**
 * Whether the on-chain name of the same spelling belongs to this account:
 * - `linked`: its on-chain owner is the account's verified Ethereum address.
 * - `not_linked`: someone holds it on-chain, but not that address.
 * - `none`: not registered on-chain.
 * - `unavailable`: the API couldn't read the chain right now.
 * - `syncing`: no longer sent (the API reads the contracts directly, so there's no sync lag).
 *   Kept in the type for compatibility; it will be removed in the next minor release.
 */
export type OnchainLinkStatus = 'linked' | 'not_linked' | 'none' | 'syncing' | 'unavailable';

/** Results are frozen (deeply): copy before changing one, e.g. `{ ...res, addresses: { ...res.addresses } }`. */
export interface ResolveResponse {
  readonly username: string;
  readonly addresses: Readonly<Partial<Record<ChainId, string>>>;
  /** Chains whose mapped address the owner proved with a signature. Absent on older API versions. */
  readonly verified?: Readonly<Partial<Record<ChainId, boolean>>>;
  readonly displayName?: string | null;
  readonly bio?: string | null;
  readonly avatarUrl?: string | null;
  /** From `resolve` (the API) only; absent on older API versions. */
  readonly onchain?: Readonly<{ status: OnchainLinkStatus }>;
}

/** `TAKEN_ONCHAIN`: free off-chain, but registered on-chain by a different wallet. */
export type UnavailableReason = 'TAKEN' | 'INVALID_FORMAT' | 'RESERVED' | 'TAKEN_ONCHAIN';

export interface AvailabilityResponse {
  readonly available: boolean;
  readonly reason?: UnavailableReason;
  readonly suggestions: readonly string[];
}

export const DEFAULT_BASE_URL = 'https://api.paytag.dev';

/** The Paytag API's on-chain endpoints (reads of the Base registry + resolver). */
export const DEFAULT_INDEXER_URL = 'https://api.paytag.dev/onchain';

/** One resolver record as stored on-chain (ENSIP-9 coin type → bytes). */
export interface OnchainRecord {
  /** ENSIP-9 / SLIP-44 coin type as a decimal string (60 = ETH, 0 = BTC, 501 = SOL, …). */
  readonly coinType: string;
  /** Raw record bytes, 0x-prefixed hex. */
  readonly value: string;
  /** Decoded display address, or null when the bytes don't decode for the coin type. */
  readonly address: string | null;
}

/**
 * `resolveViaIndexer` result: the `resolve` username and addresses, plus on-chain ownership and
 * raw records. Frozen, like `ResolveResponse`.
 */
export interface OnchainResolveResponse extends Pick<ResolveResponse, 'username' | 'addresses'> {
  /** The name's namehash, 0x + 64 hex. */
  readonly node: string;
  readonly owner: string;
  /** Registration time, unix seconds. */
  readonly registeredAt: number;
  /**
   * Transfers to a different owner so far. A transfer starts a new epoch on-chain and every
   * earlier record stops resolving, so all `records` were set by the owner at read time.
   */
  readonly epoch: number;
  /**
   * True when the name has changed owner and the current owner hasn't set any record since,
   * as opposed to a name that never had records.
   */
  readonly recordsReset: boolean;
  readonly records: readonly OnchainRecord[];
  readonly source: 'onchain';
}
