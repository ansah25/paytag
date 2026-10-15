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

/** A name you don't own whose Ethereum record points at your wallet, so it can be your primary name. */
export interface PointingName {
  name: string;
  node: `0x${string}`;
  owner: string;
}

/** At most this many names are listed; the GraphQL queries ask for exactly this page size. */
export const POINTING_LIMIT = 50;

type GqlRecord = { node: string; updatedOrdinal: string };
type GqlName = { node: string; name: string; owner: string; lastTransferOrdinal: string };

const RECORDS_POINTING_AT = `query RecordsPointingAt($value: String!) {
  recordss(where: { coinType: "60", value: $value }, limit: ${POINTING_LIMIT}) { items { node updatedOrdinal } }
}`;
const NAMES_BY_NODE = `query NamesByNode($nodes: [String!]!) {
  namess(where: { node_in: $nodes }, limit: ${POINTING_LIMIT}) { items { node name owner lastTransferOrdinal } }
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
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: unknown[] } | null;
  if (!res.ok || !body?.data || body.errors?.length) {
    throw new IndexerError(`Indexer GraphQL query failed (${res.status})`, 'GRAPHQL_ERROR', res.status);
  }
  return body.data;
}

/**
 * Joins the two GraphQL results into the names `account` can claim but doesn't own. A record
 * written before the name's latest transfer is stale: the indexer's /reverse ignores it (stricter
 * than the contract), so offering it would set a primary name that never shows up.
 */
export function pointingNames(records: GqlRecord[], names: GqlName[], account: string): PointingName[] {
  const me = account.toLowerCase();
  const byNode = new Map(names.map((n) => [n.node.toLowerCase(), n]));
  const out: PointingName[] = [];
  for (const r of records) {
    const n = byNode.get(r.node.toLowerCase());
    if (!n || n.owner.toLowerCase() === me) continue;
    try {
      if (BigInt(r.updatedOrdinal) < BigInt(n.lastTransferOrdinal)) continue;
    } catch {
      continue; // malformed ordinal: don't offer it
    }
    out.push({ name: n.name, node: n.node.toLowerCase() as `0x${string}`, owner: n.owner });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Names whose (non-stale) Ethereum record is `account`, excluding names `account` owns. */
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
