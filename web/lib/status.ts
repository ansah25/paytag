// Health checks for the /status page. Runs on the server only: every probe has a short timeout
// so one slow dependency can't hold the page, and the verdicts are pure functions (tested).

import { API_URL, EVM_RPC } from './endpoints';

export type Health = 'ok' | 'degraded' | 'down';

export const BASE_BLOCK_SECONDS = 2;

const TIMEOUT_MS = 5_000;
const RPC_URL = EVM_RPC.baseSepolia;
/** A name that always exists on-chain, so the probe exercises a real lookup. */
const PROBE_NAME = 'derrick';

export interface PingProbe {
  /** HTTP status of /ping, or null when it didn't answer. */
  status: number | null;
  /** /ping reads Postgres; false when it said the database was unavailable. */
  database: boolean | null;
  /** How far the lazily synced events table has caught up (null when unknown). */
  syncedBlock: number | null;
}

export interface StatusReport {
  checkedAt: number;
  overall: Health;
  api: { health: Health; reason: string; latencyMs: number | null };
  onchain: { health: Health; reason: string; latencyMs: number | null; syncedBlock: number | null; headBlock: number | null };
  sdkVersion: string | null;
}

export function apiHealth(ping: PingProbe): Pick<StatusReport['api'], 'health' | 'reason'> {
  if (ping.status === null) return { health: 'down', reason: 'Not responding' };
  // database null: an API from before /ping reported it (rollout) still counts as serving.
  if (ping.status === 200 && ping.database !== false) return { health: 'ok', reason: 'Serving' };
  if (ping.database === false) return { health: 'degraded', reason: 'Database unavailable' };
  return { health: 'down', reason: `Answering ${ping.status}` };
}

/** `lookupStatus`: HTTP status of an on-chain lookup through the API, or null without an answer. */
export function onchainHealth(lookupStatus: number | null): Pick<StatusReport['onchain'], 'health' | 'reason'> {
  if (lookupStatus === 200) return { health: 'ok', reason: 'Reading the contracts' };
  if (lookupStatus === null) return { health: 'down', reason: 'Not responding' };
  if (lookupStatus === 503) return { health: 'degraded', reason: 'Base RPC unavailable' };
  return { health: 'degraded', reason: `Lookup answered ${lookupStatus}` };
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

// Server-rendered from Vercel's shared addresses: present the server key so the probes don't share
// those addresses' rate-limit bucket. Never bundled for the browser (no NEXT_PUBLIC_ prefix).
const serverHeaders = (): Record<string, string> | undefined => {
  const key = process.env.API_SERVER_KEY;
  return key ? { 'x-paytag-server-key': key } : undefined;
};

async function probePing(): Promise<{ ping: PingProbe; ms: number }> {
  const { value, ms } = await timed(async (signal) => {
    // /ping, not /health: it's behind the API's Cloudflare edge check, so a misconfigured edge
    // (every real request refused) shows here as down. It also reads Postgres.
    const res = await fetch(`${API_URL}/ping`, { signal, cache: 'no-store' });
    const body = (await res.json().catch(() => null)) as { database?: unknown; onchainSyncedBlock?: unknown } | null;
    return {
      status: res.status,
      database: body?.database === 'ok' ? true : body?.database === 'unavailable' ? false : null,
      syncedBlock: typeof body?.onchainSyncedBlock === 'number' ? body.onchainSyncedBlock : null,
    };
  });
  return { ping: value ?? { status: null, database: null, syncedBlock: null }, ms };
}

async function probeOnchain(): Promise<{ status: number | null; ms: number }> {
  const { value, ms } = await timed(async (signal) => {
    const res = await fetch(`${API_URL}/onchain/resolve/${PROBE_NAME}`, { signal, cache: 'no-store', headers: serverHeaders() });
    return res.status;
  });
  return { status: value, ms };
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
  const [{ ping, ms: pingMs }, lookup, headBlock, sdkVersion] = await Promise.all([
    probePing(),
    probeOnchain(),
    probeHead(),
    probeSdkVersion(),
  ]);
  const api = apiHealth(ping);
  const onchain = onchainHealth(lookup.status);
  return {
    checkedAt: Date.now(),
    overall: worst(api.health, onchain.health),
    api: { ...api, latencyMs: ping.status === null ? null : pingMs },
    onchain: {
      ...onchain,
      latencyMs: lookup.status === null ? null : lookup.ms,
      syncedBlock: ping.syncedBlock,
      headBlock,
    },
    sdkVersion,
  };
}
