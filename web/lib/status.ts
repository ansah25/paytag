// Health checks for the /status page. Runs on the server only: every probe has a short timeout
// so one slow dependency can't hold the page, and the verdicts are pure functions (tested).

import { INDEXER_URL } from './onchain/indexer';

export type Health = 'ok' | 'degraded' | 'down';

/** Base produces a block every 2s; more than this many behind the head reads as degraded. */
export const MAX_LAG_BLOCKS = 30;
export const BASE_BLOCK_SECONDS = 2;

const TIMEOUT_MS = 5_000;
// Same fallback as lib/api.ts, so /status probes the API the app actually uses.
const API_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const RPC_URL = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC || 'https://sepolia.base.org';

export interface IndexerProbe {
  /** /status answered at all (an indexer that's starting up answers with no block yet). */
  responded: boolean;
  /** The block the indexer has processed, and its timestamp (unix s). */
  synced: { block: number; timestamp: number } | null;
  /** /ready: true once historical sync is done. null when unreachable. */
  ready: boolean | null;
}

export interface StatusReport {
  checkedAt: number;
  overall: Health;
  api: { health: Health; latencyMs: number | null };
  indexer: { health: Health; reason: string; syncedBlock: number | null; headBlock: number | null; lagBlocks: number | null };
  sdkVersion: string | null;
}

export function indexerHealth(probe: IndexerProbe, headBlock: number | null): Pick<StatusReport['indexer'], 'health' | 'reason' | 'lagBlocks'> {
  if (!probe.responded) return { health: 'down', reason: 'Not responding', lagBlocks: null };
  if (!probe.synced) return { health: 'degraded', reason: 'Starting up', lagBlocks: null };
  const lagBlocks = headBlock === null ? null : Math.max(0, headBlock - probe.synced.block);
  if (probe.ready === false) return { health: 'degraded', reason: 'Catching up on history', lagBlocks };
  if (probe.ready === null) return { health: 'degraded', reason: 'Readiness check failed', lagBlocks };
  if (lagBlocks !== null && lagBlocks > MAX_LAG_BLOCKS) {
    return { health: 'degraded', reason: `${lagBlocks} blocks behind`, lagBlocks };
  }
  return { health: 'ok', reason: lagBlocks === null ? 'Synced' : lagBlocks === 0 ? 'At the chain head' : `${lagBlocks} blocks behind`, lagBlocks };
}

const RANK: Record<Health, number> = { ok: 0, degraded: 1, down: 2 };
export const worst = (...h: Health[]): Health => h.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok');

async function timed<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<{ value: T | null; ms: number }> {
  const start = Date.now();
  try {
    return { value: await fn(AbortSignal.timeout(TIMEOUT_MS)), ms: Date.now() - start };
  } catch {
    return { value: null, ms: Date.now() - start };
  }
}

async function probeApi(): Promise<StatusReport['api']> {
  const { value, ms } = await timed(async (signal) => {
    const res = await fetch(`${API_URL}/health`, { signal, cache: 'no-store' });
    const body = (await res.json()) as { status?: string };
    return res.ok && body.status === 'ok';
  });
  return { health: value ? 'ok' : 'down', latencyMs: value ? ms : null };
}

async function probeIndexer(): Promise<IndexerProbe> {
  // Ponder's own /status and /ready: never rate-limited, so no server key needed.
  const [status, ready] = await Promise.all([
    timed(async (signal) => {
      const res = await fetch(`${INDEXER_URL}/status`, { signal, cache: 'no-store' });
      if (!res.ok) return null;
      const body = (await res.json()) as Record<string, { block?: { number?: number; timestamp?: number } }>;
      const block = Object.values(body ?? {})[0]?.block;
      return { synced: typeof block?.number === 'number' ? { block: block.number, timestamp: block.timestamp ?? 0 } : null };
    }),
    timed(async (signal) => (await fetch(`${INDEXER_URL}/ready`, { signal, cache: 'no-store' })).status === 200),
  ]);
  return { responded: status.value !== null, synced: status.value?.synced ?? null, ready: ready.value };
}

async function probeHead(): Promise<number | null> {
  const { value } = await timed(async (signal) => {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    });
    const body = (await res.json()) as { result?: string };
    const n = body.result ? Number.parseInt(body.result, 16) : NaN;
    return Number.isFinite(n) ? n : null;
  });
  return value;
}

async function probeSdkVersion(): Promise<string | null> {
  const { value } = await timed(async (signal) => {
    // Changes only on publish: cache for an hour rather than asking npm on every view.
    const res = await fetch('https://registry.npmjs.org/@paytagdev/sdk/latest', { signal, next: { revalidate: 3600 } });
    const body = (await res.json()) as { version?: string };
    return typeof body.version === 'string' ? body.version : null;
  });
  return value;
}

export async function getStatus(): Promise<StatusReport> {
  const [api, probe, headBlock, sdkVersion] = await Promise.all([probeApi(), probeIndexer(), probeHead(), probeSdkVersion()]);
  const verdict = indexerHealth(probe, headBlock);
  return {
    checkedAt: Date.now(),
    overall: worst(api.health, verdict.health),
    api,
    indexer: { ...verdict, syncedBlock: probe.synced?.block ?? null, headBlock },
    sdkVersion,
  };
}
