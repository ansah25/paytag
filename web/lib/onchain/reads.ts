import { Paytag, PaytagError, type OnchainResolveResponse } from '@paytagdev/sdk';
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
// instead of a copy cached from before it. Per tab: this module runs in the browser. After
// WRITE_FRESH_MS every API cache entry from before the write has expired, so it's dropped (and
// reads use the API's cache again).
const WRITE_FRESH_MS = 60_000;
let lastWrite: { block: bigint; at: number } | undefined;

/** Call when a write's receipt arrives. */
export function noteWrite(blockNumber: bigint): void {
  if (!lastWrite || blockNumber > lastWrite.block) lastWrite = { block: blockNumber, at: Date.now() };
  else lastWrite.at = Date.now();
}

/** Tests only. */
export const resetWrites = (): void => {
  lastWrite = undefined;
};

const minBlock = (): bigint | undefined => {
  if (lastWrite && Date.now() - lastWrite.at > WRITE_FRESH_MS) lastWrite = undefined;
  return lastWrite?.block;
};

const withMinBlock = (path: string): string => {
  const min = minBlock();
  if (min === undefined) return path;
  return `${path}${path.includes('?') ? '&' : '?'}minBlock=${min}`;
};

// Right after a write the API's RPC can be a block or two behind the wallet's (Base makes one every
// 2s): it answers 503 and the read is retried a few times before the error is shown.
const BEHIND_RETRIES = 3;
const BEHIND_RETRY_MS = 1_500;
const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
  });

const is503 = (err: unknown) =>
  (err instanceof OnchainReadError || err instanceof PaytagError) && err.status === 503;

/** Runs `read`; while a recent write is pending, retries a 503 (the API behind that block). */
async function afterWrite<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (err) {
      if (attempt >= BEHIND_RETRIES || minBlock() === undefined || !is503(err)) throw err;
      await pause(BEHIND_RETRY_MS, signal);
    }
  }
}

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
    afterWrite(() => sdk.resolveViaIndexer(name, { signal, minBlock: minBlock() }), signal),
  available: (name: string, signal?: AbortSignal) =>
    getJson<Availability>(`/available/${encodeURIComponent(name)}`, signal),
  names: (owner: string, signal?: AbortSignal) =>
    afterWrite(
      () => getJson<{ owner: string; names: OwnedName[] }>(withMinBlock(`/names?owner=${encodeURIComponent(owner)}`), signal),
      signal,
    ),
  reverse: (address: string, signal?: AbortSignal) =>
    afterWrite(
      () => getJson<{ address: string; username: string | null }>(withMinBlock(`/reverse/${encodeURIComponent(address)}`), signal),
      signal,
    ),
  /** Names whose Ethereum record is `account`, excluding names `account` owns, by name. */
  pointingAt: async (account: string, signal?: AbortSignal): Promise<PointingName[]> =>
    (
      await afterWrite(
        () =>
          getJson<{ account: string; names: PointingName[] }>(withMinBlock(`/pointing?account=${encodeURIComponent(account)}`), signal),
        signal,
      )
    ).names,
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
