import { Paytag, type OnchainResolveResponse } from '@paytagdev/sdk';

// Read client for the Paytag indexer. Resolution goes through the published SDK; the endpoints
// the SDK doesn't wrap (availability, names by owner, reverse, sync status) are plain fetches.

export const INDEXER_URL = (process.env.NEXT_PUBLIC_INDEXER_URL || 'https://indexer.paytag.dev').replace(/\/+$/, '');

export class IndexerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'IndexerError';
  }
}

export type AvailabilityReason = 'TAKEN' | 'RESERVED' | 'INVALID_FORMAT';
export interface Availability {
  available: boolean;
  reason?: AvailabilityReason;
  suggestions: string[];
}
export interface OwnedName {
  name: string;
  node: `0x${string}`;
  registeredAt: number;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${INDEXER_URL}${path}`, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new IndexerError('The indexer is unreachable.', 'NETWORK_ERROR');
  }
  const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (!res.ok) {
    throw new IndexerError(body?.error ?? `Indexer returned ${res.status}`, body?.code ?? 'HTTP_ERROR', res.status);
  }
  return body as T;
}

// cache:false disables the SDK's in-memory cache; the fetch wrapper also bypasses the browser's
// HTTP cache (the indexer sends max-age=5), so a refetch right after a write sees fresh data.
const sdk = new Paytag({
  indexerUrl: INDEXER_URL,
  cache: false,
  fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
});

export const indexer = {
  resolve: (name: string, signal?: AbortSignal): Promise<OnchainResolveResponse> =>
    sdk.resolveViaIndexer(name, { signal }),
  available: (name: string, signal?: AbortSignal) =>
    getJson<Availability>(`/available/${encodeURIComponent(name)}`, signal),
  names: (owner: string, signal?: AbortSignal) =>
    getJson<{ owner: string; names: OwnedName[] }>(`/names?owner=${encodeURIComponent(owner)}`, signal),
  reverse: (address: string, signal?: AbortSignal) =>
    getJson<{ address: string; username: string | null }>(`/reverse/${encodeURIComponent(address)}`, signal),
  /** Latest block the indexer has processed. */
  syncedBlock: async (signal?: AbortSignal): Promise<bigint> => {
    const status = await getJson<Record<string, { block: { number: number } }>>('/status', signal);
    const chain = Object.values(status)[0];
    if (!chain) throw new IndexerError('Indexer reported no chains.', 'INVALID_RESPONSE');
    return BigInt(chain.block.number);
  },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve once the indexer has processed `blockNumber`, so reads reflect a just-confirmed write.
 * Returns false (rather than throwing) on timeout or an unreachable indexer: the write is already
 * final on-chain, and callers just show "confirmed, still updating".
 */
export async function waitForIndexer(
  blockNumber: bigint,
  { timeoutMs = 60_000, intervalMs = 1_500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await indexer.syncedBlock()) >= blockNumber) return true;
    } catch {
      // keep polling until the deadline
    }
    await sleep(intervalMs);
  }
  return false;
}
