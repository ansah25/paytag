import { Paytag, type OnchainResolveResponse } from '@paytagdev/sdk';
import { API_URL } from '../endpoints';

// Reads of on-chain names (the Base registry), through the Paytag API's /onchain endpoints: they
// read the contracts directly, so there is no indexer to wait for. Resolution goes through the
// published SDK; the rest are plain fetches.

/** Base of the API's on-chain endpoints. */
export const ONCHAIN_API = `${API_URL}/onchain`;

export class OnchainReadError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OnchainReadError';
  }
}

export type AvailabilityReason = 'TAKEN' | 'RESERVED' | 'INVALID_FORMAT';
export interface Availability {
  available: boolean;
  reason?: AvailabilityReason;
  suggestions: readonly string[];
}
export interface OwnedName {
  name: string;
  node: `0x${string}`;
  registeredAt: number;
}

/** A name you don't own whose Ethereum record points at your wallet, so it can be your primary name. */
export interface PointingName {
  name: string;
  node: `0x${string}`;
  owner: string;
}

// The newest block this tab has written in. Every read after a write asks the API for at least
// that block, so it reflects the write (or answers 503 ONCHAIN_BEHIND until its RPC catches up)
// instead of a copy cached from before it. Per tab: this module runs in the browser.
let lastWriteBlock: bigint | undefined;

/** Call when a write's receipt arrives. */
export function noteWrite(blockNumber: bigint): void {
  if (lastWriteBlock === undefined || blockNumber > lastWriteBlock) lastWriteBlock = blockNumber;
}

/** Tests only. */
export const resetWrites = (): void => {
  lastWriteBlock = undefined;
};

const withMinBlock = (path: string): string => {
  if (lastWriteBlock === undefined) return path;
  return `${path}${path.includes('?') ? '&' : '?'}minBlock=${lastWriteBlock}`;
};

/**
 * For `res.json().catch(...)`: an unreadable body becomes null (reported as an HTTP error), but
 * an abort mid-body must stay an AbortError, or callers would treat a cancelled read as real data.
 */
const rethrowIfAborted = (signal?: AbortSignal) => (err: unknown) => {
  if (signal?.aborted) throw err;
  return null;
};

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ONCHAIN_API}${path}`, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new OnchainReadError('Couldn’t reach the Paytag API.', 'NETWORK_ERROR');
  }
  const body = (await res.json().catch(rethrowIfAborted(signal))) as { error?: string; code?: string } | null;
  if (!res.ok) {
    throw new OnchainReadError(body?.error ?? `The API returned ${res.status}`, body?.code ?? 'HTTP_ERROR', res.status);
  }
  return body as T;
}

// cache: 'no-store' bypasses the browser's HTTP cache (the API sends max-age=5), so a refetch
// right after a write isn't served from it.
const sdk = new Paytag({
  indexerUrl: ONCHAIN_API,
  fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
});

export const onchainReads = {
  resolve: (name: string, signal?: AbortSignal): Promise<OnchainResolveResponse> =>
    sdk.resolveViaIndexer(name, { signal, minBlock: lastWriteBlock }),
  available: (name: string, signal?: AbortSignal) =>
    getJson<Availability>(`/available/${encodeURIComponent(name)}`, signal),
  names: (owner: string, signal?: AbortSignal) =>
    getJson<{ owner: string; names: OwnedName[] }>(withMinBlock(`/names?owner=${encodeURIComponent(owner)}`), signal),
  reverse: (address: string, signal?: AbortSignal) =>
    getJson<{ address: string; username: string | null }>(withMinBlock(`/reverse/${encodeURIComponent(address)}`), signal),
  /** Names whose Ethereum record is `account`, excluding names `account` owns, by name. */
  pointingAt: async (account: string, signal?: AbortSignal): Promise<PointingName[]> =>
    (await getJson<{ account: string; names: PointingName[] }>(withMinBlock(`/pointing?account=${encodeURIComponent(account)}`), signal))
      .names,
};

/** At most this many names are shown. */
export const POINTING_LIMIT = 50;

/**
 * What the section shows: the current primary name first (so it can always be cleared, even
 * past the cap), then the rest in name order, at most POINTING_LIMIT.
 */
export function visiblePointing(names: PointingName[], primaryName: string | null): PointingName[] {
  const primary = names.filter((n) => n.name === primaryName);
  return [...primary, ...names.filter((n) => n.name !== primaryName)].slice(0, POINTING_LIMIT);
}
