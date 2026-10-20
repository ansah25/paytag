import { Paytag, type OnchainResolveResponse } from '@paytagdev/sdk';

// Read client for the Paytag indexer. Resolution goes through the published SDK; the endpoints
// the SDK doesn't wrap (availability, names by owner, reverse, sync status) are plain fetches.

import { INDEXER_URL } from '../endpoints';

export { INDEXER_URL };

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
    res = await fetch(`${INDEXER_URL}${path}`, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new IndexerError('The indexer is unreachable.', 'NETWORK_ERROR');
  }
  const body = (await res.json().catch(rethrowIfAborted(signal))) as { error?: string; code?: string } | null;
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

/** A name you don't own whose Ethereum record points at your wallet, so it can be your primary name. */
export interface PointingName {
  name: string;
  node: `0x${string}`;
  owner: string;
}

/** At most this many names are shown. */
export const POINTING_LIMIT = 50;
/**
 * Rows fetched per query (Ponder's maximum page size). Far above POINTING_LIMIT because names the
 * wallet owns are filtered out after the query.
 */
const FETCH_LIMIT = 1000;

type GqlRecord = { node: string };
type GqlName = { node: string; name: string; owner: string };

const RECORDS_POINTING_AT = `query RecordsPointingAt($value: String!) {
  recordss(where: { coinType: "60", value: $value }, limit: ${FETCH_LIMIT}) { items { node } }
}`;
const NAMES_BY_NODE = `query NamesByNode($nodes: [String!]!) {
  namess(where: { node_in: $nodes }, limit: ${FETCH_LIMIT}) { items { node name owner } }
}`;

async function gql<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${INDEXER_URL}/graphql`, {
      method: 'POST',
      signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new IndexerError('The indexer is unreachable.', 'NETWORK_ERROR');
  }
  const body = (await res.json().catch(rethrowIfAborted(signal))) as { data?: T; errors?: unknown[] } | null;
  if (!res.ok || !body?.data || body.errors?.length) {
    throw new IndexerError(`Indexer GraphQL query failed (${res.status})`, 'GRAPHQL_ERROR', res.status);
  }
  return body.data;
}

/**
 * Joins the two GraphQL results into the names `account` can claim but doesn't own. Every
 * indexed record is current (a transfer clears a name's records on-chain and in the indexer),
 * so a name whose ETH record is `account` is one `account` can make its primary name.
 */
export function pointingNames(records: GqlRecord[], names: GqlName[], account: string): PointingName[] {
  const me = account.toLowerCase();
  const byNode = new Map(names.map((n) => [n.node.toLowerCase(), n]));
  const out: PointingName[] = [];
  for (const r of records) {
    const n = byNode.get(r.node.toLowerCase());
    if (!n || n.owner.toLowerCase() === me) continue;
    out.push({ name: n.name, node: n.node.toLowerCase() as `0x${string}`, owner: n.owner });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Names whose Ethereum record is `account`, excluding names `account` owns. */
export async function namesPointingAt(account: string, signal?: AbortSignal): Promise<PointingName[]> {
  const { recordss } = await gql<{ recordss: { items: GqlRecord[] } }>(
    RECORDS_POINTING_AT,
    { value: account.toLowerCase() },
    signal,
  );
  const records = recordss?.items ?? [];
  if (records.length === 0) return [];
  const { namess } = await gql<{ namess: { items: GqlName[] } }>(
    NAMES_BY_NODE,
    { nodes: records.map((r) => r.node.toLowerCase()) },
    signal,
  );
  return pointingNames(records, namess?.items ?? [], account);
}

/**
 * What the section shows: the current primary name first (so it can always be cleared, even
 * past the cap), then the rest in name order, at most POINTING_LIMIT.
 */
export function visiblePointing(names: PointingName[], primaryName: string | null): PointingName[] {
  const primary = names.filter((n) => n.name === primaryName);
  return [...primary, ...names.filter((n) => n.name !== primaryName)].slice(0, POINTING_LIMIT);
}

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
