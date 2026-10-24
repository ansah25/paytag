import { randomUUID } from 'node:crypto';
import { type Hex, decodeEventLog, getAbiItem } from 'viem';
import { env } from '../config/env';
import { supabase } from '../config/supabase';
import { chainClient } from '../onchain/client';
import { REGISTRY_ADDRESS, RESOLVER_ADDRESS } from '../onchain/deployment';
import { PaytagRegistryAbi } from '../onchain/generated/PaytagRegistryAbi';
import { PaytagResolverAbi } from '../onchain/generated/PaytagResolverAbi';
import { readHead } from '../onchain/state';
import { logger } from '../utils/logger';

// The events behind the list endpoints, kept in onchain_events and caught up lazily: when a list
// is asked for, not on a timer. Cost scales with use, not with wall-clock time.
//
// Rows only ever nominate candidates. Callers re-check every candidate against live contract
// state, so a missed, stale or reorged row can make a list miss a name for a while, but never
// show a wrong one. That is why the table can stop ONCHAIN_CONFIRMATIONS blocks short of the head
// (no reorg handling), and why the few blocks after it are read fresh on each request (`tail`).

export type OnchainEvent = 'NameRegistered' | 'Transfer' | 'RecordSet';

/** One row of onchain_events. Hex values are lowercase (the table's CHECKs require it). */
export interface EventRow {
  block_number: number;
  log_index: number;
  tx_hash: string;
  event: OnchainEvent;
  node: string;
  name?: string | null;
  block_timestamp?: number | null;
  from_address?: string | null;
  to_address?: string | null;
  coin_type?: string | null;
  value?: string | null;
}

/** A raw log from either source, before decoding. */
interface RawLog {
  address: string;
  topics: readonly (string | null)[];
  data: string;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
  /** Unix seconds, when the source includes it (Blockscout does, eth_getLogs doesn't). */
  timestamp?: number;
}

const EVENTS_ABI = [
  getAbiItem({ abi: PaytagRegistryAbi, name: 'NameRegistered' }),
  getAbiItem({ abi: PaytagRegistryAbi, name: 'Transfer' }),
  getAbiItem({ abi: PaytagResolverAbi, name: 'RecordSet' }),
] as const;

const REGISTRY = REGISTRY_ADDRESS.toLowerCase();
const RESOLVER = RESOLVER_ADDRESS.toLowerCase();
/** Which contract may emit which event: a log from anywhere else is ignored. */
const EMITTER: Record<OnchainEvent, string> = { NameRegistered: REGISTRY, Transfer: REGISTRY, RecordSet: RESOLVER };

const LEASE_SECONDS = 60;
const BLOCKSCOUT_TIMEOUT_MS = 8_000;
/** Etherscan-compatible getLogs returns at most this many logs per call. */
const BLOCKSCOUT_PAGE = 1_000;
const BLOCKSCOUT_MAX_PAGES = 20;
/** The fresh read past the cursor covers at most this many eth_getLogs calls. */
const TAIL_MAX_CHUNKS = 3;
const INSERT_BATCH = 500;

const lower = (v: string) => v.toLowerCase();

/** Decodes a log into a row, or null if it isn't one of the three events from its contract. */
export function decodeRow(log: RawLog): EventRow | null {
  const topics = log.topics.filter((t): t is string => typeof t === 'string');
  if (topics.length === 0) return null;
  let decoded: ReturnType<typeof decodeEventLog<typeof EVENTS_ABI>>;
  try {
    decoded = decodeEventLog({
      abi: EVENTS_ABI,
      topics: topics as [Hex, ...Hex[]],
      data: log.data as Hex,
      strict: true,
    });
  } catch {
    return null;
  }
  if (EMITTER[decoded.eventName] !== lower(log.address)) return null;

  const base = {
    block_number: Number(log.blockNumber),
    log_index: log.logIndex,
    tx_hash: lower(log.transactionHash),
    node: lower(decoded.args.node),
  };
  switch (decoded.eventName) {
    case 'NameRegistered':
      return {
        ...base,
        event: 'NameRegistered',
        name: decoded.args.name,
        to_address: lower(decoded.args.owner),
        block_timestamp: log.timestamp ?? null,
      };
    case 'Transfer':
      return {
        ...base,
        event: 'Transfer',
        from_address: lower(decoded.args.from),
        to_address: lower(decoded.args.to),
      };
    case 'RecordSet':
      return { ...base, event: 'RecordSet', coin_type: decoded.args.coinType.toString(), value: lower(decoded.args.addr) };
  }
}

// --- Sources ----------------------------------------------------------------------------------

const hexToNumber = (v: unknown): number => {
  if (typeof v !== 'string' || !/^0x[0-9a-f]+$/i.test(v)) throw new Error(`not a hex quantity: ${String(v)}`);
  return Number.parseInt(v, 16);
};

async function blockscoutGet(path: string): Promise<unknown> {
  const res = await fetch(`${env.BLOCKSCOUT_API_URL.replace(/\/+$/, '')}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(BLOCKSCOUT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Blockscout answered ${res.status}`);
  return res.json();
}

/** The newest block Blockscout has indexed: the sync never moves the cursor past it. */
async function blockscoutHead(): Promise<bigint> {
  const body = (await blockscoutGet('/api/v2/blocks?type=block')) as { items?: { height?: unknown }[] };
  const height = body?.items?.[0]?.height;
  if (typeof height !== 'number' || !Number.isSafeInteger(height)) throw new Error('Blockscout: no block height');
  return BigInt(height);
}

/** Every log `address` emitted in [from, to], paging past Blockscout's 1,000-log limit. */
async function blockscoutLogs(address: string, from: bigint, to: bigint): Promise<RawLog[]> {
  const out: RawLog[] = [];
  let start = from;
  for (let page = 0; page < BLOCKSCOUT_MAX_PAGES; page++) {
    const body = (await blockscoutGet(
      `/api?module=logs&action=getLogs&fromBlock=${start}&toBlock=${to}&address=${address}`,
    )) as { status?: unknown; message?: unknown; result?: unknown };
    if (body?.status === '0' && body.message === 'No logs found') return out;
    if (body?.status !== '1' || !Array.isArray(body.result)) {
      throw new Error(`Blockscout getLogs: ${String(body?.message ?? 'unexpected response')}`);
    }
    const logs = (body.result as Record<string, unknown>[]).map(
      (l): RawLog => ({
        address: String(l.address),
        topics: Array.isArray(l.topics) ? (l.topics as (string | null)[]) : [],
        data: String(l.data),
        blockNumber: BigInt(hexToNumber(l.blockNumber)),
        logIndex: hexToNumber(l.logIndex),
        transactionHash: String(l.transactionHash),
        timestamp: hexToNumber(l.timeStamp),
      }),
    );
    if (logs.length < BLOCKSCOUT_PAGE) return out.concat(logs);
    // A full page: keep the blocks before the last one and re-read from it (duplicates are
    // dropped by the primary key), so a block split across pages is never cut.
    const last = logs[logs.length - 1].blockNumber;
    if (last <= start) throw new Error('Blockscout: more than one page of logs in a single block');
    out.push(...logs.filter((l) => l.blockNumber < last));
    start = last;
  }
  throw new Error('Blockscout: too many pages');
}

/** eth_getLogs over [from, to] in ONCHAIN_LOG_CHUNK_BLOCKS chunks, at most `maxChunks` of them. */
async function rpcLogs(from: bigint, to: bigint, maxChunks: number): Promise<{ logs: RawLog[]; reached: bigint }> {
  const chunk = BigInt(env.ONCHAIN_LOG_CHUNK_BLOCKS);
  const logs: RawLog[] = [];
  let reached = from - 1n;
  for (let i = 0; i < maxChunks && reached < to; i++) {
    const start = reached + 1n;
    const end = start + chunk - 1n < to ? start + chunk - 1n : to;
    const found = await chainClient().getLogs({
      address: [REGISTRY_ADDRESS, RESOLVER_ADDRESS],
      fromBlock: start,
      toBlock: end,
    });
    for (const l of found) {
      if (l.blockNumber === null || l.logIndex === null || l.transactionHash === null) continue; // pending
      logs.push({
        address: l.address,
        topics: l.topics,
        data: l.data,
        blockNumber: l.blockNumber,
        logIndex: l.logIndex,
        transactionHash: l.transactionHash,
      });
    }
    reached = end;
  }
  return { logs, reached };
}

/** Rows for logs, filling in registration timestamps that the source didn't include. */
async function toRows(logs: RawLog[]): Promise<EventRow[]> {
  const rows = logs.map(decodeRow).filter((r): r is EventRow => r !== null);
  const missing = [...new Set(rows.filter((r) => r.event === 'NameRegistered' && r.block_timestamp == null).map((r) => r.block_number))];
  const times = new Map<number, number>();
  // Registrations are rare: one block read each.
  for (const block of missing) {
    const b = await chainClient().getBlock({ blockNumber: BigInt(block) });
    times.set(block, Number(b.timestamp));
  }
  return rows.map((r) => (r.event === 'NameRegistered' && r.block_timestamp == null ? { ...r, block_timestamp: times.get(r.block_number)! } : r));
}

// --- The table and its cursor -----------------------------------------------------------------

async function insertRows(rows: EventRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { error } = await supabase
      .from('onchain_events')
      .upsert(rows.slice(i, i + INSERT_BATCH), { onConflict: 'block_number,log_index', ignoreDuplicates: true });
    if (error) throw new Error(`onchain_events insert: ${error.message}`);
  }
}

/** Every block up to and including this one is in the table. */
export async function syncedBlock(): Promise<bigint> {
  const { data, error } = await supabase.from('onchain_sync_state').select('last_synced_block').single();
  if (error || !data) throw new Error(`onchain_sync_state: ${error?.message ?? 'missing row'}`);
  return BigInt((data as { last_synced_block: number | string }).last_synced_block);
}

async function rpcCall<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export type CatchUpResult =
  | { status: 'current'; cursor: bigint }
  | { status: 'busy' }
  | { status: 'advanced'; cursor: bigint; via: 'blockscout' | 'rpc' };

/**
 * Brings the table up to `head - ONCHAIN_CONFIRMATIONS`, under the shared lease: if another
 * request (on any machine) holds it, this returns `busy` immediately and the caller serves what
 * is already there. Blockscout covers any gap in a call or two; if it fails, eth_getLogs covers
 * at most ONCHAIN_MAX_CHUNKS_PER_REQUEST chunks and the next request continues.
 */
export async function catchUp(opts: { maxChunks?: number; head?: bigint } = {}): Promise<CatchUpResult> {
  const head = opts.head ?? (await readHead());
  const target = head - BigInt(env.ONCHAIN_CONFIRMATIONS);

  const token = randomUUID();
  const leased = await rpcCall<number | string | null>('onchain_sync_try_lease', { p_token: token, p_seconds: LEASE_SECONDS });
  if (leased === null || leased === undefined) return { status: 'busy' };
  let cursor = BigInt(leased);

  try {
    if (cursor >= target) return { status: 'current', cursor };
    const advance = async (to: bigint): Promise<boolean> => {
      const ok = await rpcCall<boolean | null>('onchain_sync_advance', { p_token: token, p_block: Number(to), p_seconds: LEASE_SECONDS });
      if (ok) cursor = to;
      return ok === true;
    };

    try {
      const indexed = await blockscoutHead();
      const to = indexed < target ? indexed : target;
      if (to > cursor) {
        const [registry, resolver] = await Promise.all([
          blockscoutLogs(REGISTRY, cursor + 1n, to),
          blockscoutLogs(RESOLVER, cursor + 1n, to),
        ]);
        await insertRows(await toRows([...registry, ...resolver]));
        if (!(await advance(to))) return { status: 'busy' }; // lease lost: another machine carries on
        if (cursor >= target) return { status: 'advanced', cursor, via: 'blockscout' };
      }
      // Blockscout is behind the target: the RPC path covers the rest, within its cap.
    } catch (err) {
      logger.warn('onchain.sync_blockscout_failed', { reason: (err as Error).message });
    }

    const maxChunks = opts.maxChunks ?? env.ONCHAIN_MAX_CHUNKS_PER_REQUEST;
    const chunk = BigInt(env.ONCHAIN_LOG_CHUNK_BLOCKS);
    for (let i = 0; i < maxChunks && cursor < target; i++) {
      const end = cursor + chunk < target ? cursor + chunk : target;
      const { logs } = await rpcLogs(cursor + 1n, end, 1);
      await insertRows(await toRows(logs));
      if (!(await advance(end))) return { status: 'busy' };
    }
    return { status: 'advanced', cursor, via: 'rpc' };
  } finally {
    await rpcCall('onchain_sync_release', { p_token: token }).catch((err: Error) =>
      logger.warn('onchain.sync_release_failed', { reason: err.message }),
    );
  }
}

/**
 * The events after the cursor, read fresh from the chain (not stored: they're inside the reorg
 * margin, or past a sync that didn't finish). Covers at most TAIL_MAX_CHUNKS calls; a longer gap
 * is left to the sync, and the caller just sees fewer candidates for now.
 */
export async function tail(cursor: bigint, head: bigint): Promise<EventRow[]> {
  if (head <= cursor) return [];
  const { logs, reached } = await rpcLogs(cursor + 1n, head, TAIL_MAX_CHUNKS);
  if (reached < head) logger.warn('onchain.tail_truncated', { cursor: cursor.toString(), head: head.toString() });
  return toRows(logs);
}

/**
 * Stored rows plus the fresh tail, for a list request. Syncs first (non-blocking: a busy lease or
 * a failed sync just serves what's stored). Throws only when the chain itself can't be read.
 */
export async function currentEvents(
  select: (cursor: bigint) => Promise<EventRow[]>,
  matches: (row: EventRow) => boolean,
): Promise<EventRow[]> {
  const head = await readHead();
  try {
    await catchUp({ head });
  } catch (err) {
    logger.warn('onchain.sync_failed', { reason: (err as Error).message });
  }
  const cursor = await syncedBlock();
  const [stored, fresh] = await Promise.all([
    select(cursor),
    tail(cursor, head).catch((err: Error) => {
      logger.warn('onchain.tail_failed', { reason: err.message });
      return [] as EventRow[];
    }),
  ]);
  return [...stored, ...fresh.filter(matches)];
}

// --- Queries ----------------------------------------------------------------------------------

/** Most rows a list query reads; far above any real owner's count at this scale. */
const QUERY_LIMIT = 5_000;

export async function storedTransfersTo(address: string): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('onchain_events')
    .select('node')
    .eq('event', 'Transfer')
    .eq('to_address', lower(address))
    .limit(QUERY_LIMIT);
  if (error) throw new Error(`onchain_events: ${error.message}`);
  return (data ?? []) as EventRow[];
}

export async function storedEthRecordsFor(address: string): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('onchain_events')
    .select('node')
    .eq('event', 'RecordSet')
    .eq('coin_type', 60)
    .eq('value', lower(address))
    .limit(QUERY_LIMIT);
  if (error) throw new Error(`onchain_events: ${error.message}`);
  return (data ?? []) as EventRow[];
}

export interface Registration {
  node: Hex;
  name: string;
  /** Unix seconds. */
  registeredAt: number;
}

/** Registrations never change (a node's name and mint time are fixed), so they're kept for good. */
const registrations = new Map<string, Registration>();
const MAX_REMEMBERED = 10_000;
const remember = (r: Registration) => {
  if (registrations.size >= MAX_REMEMBERED) registrations.clear();
  registrations.set(r.node, r);
};

/** Tests only. */
export const forgetRegistrations = (): void => registrations.clear();

async function storedRegistrations(nodes: readonly string[]): Promise<Registration[]> {
  if (nodes.length === 0) return [];
  const { data, error } = await supabase
    .from('onchain_events')
    .select('node, name, block_timestamp')
    .eq('event', 'NameRegistered')
    .in('node', nodes.map(lower))
    .limit(QUERY_LIMIT);
  if (error) throw new Error(`onchain_events: ${error.message}`);
  return ((data ?? []) as { node: string; name: string; block_timestamp: number | string }[]).map((r) => ({
    node: r.node as Hex,
    name: r.name,
    registeredAt: Number(r.block_timestamp),
  }));
}

/**
 * Name and registration time for each node (by node). A node registered after the cursor isn't in
 * the table yet: it's looked up by syncing, then in the fresh tail. A node still missing after
 * that is left out (the caller decides what that means).
 */
export async function registrationsOf(nodes: readonly Hex[]): Promise<Map<string, Registration>> {
  const out = new Map<string, Registration>();
  const want = () => nodes.map(lower).filter((n) => !out.has(n));
  for (const n of nodes) {
    const known = registrations.get(lower(n));
    if (known) out.set(known.node, known);
  }
  const take = (rs: Registration[]) => {
    for (const r of rs) {
      remember(r);
      out.set(r.node, r);
    }
  };

  if (want().length === 0) return out;
  take(await storedRegistrations(want()));
  if (want().length === 0) return out;

  const head = await readHead();
  try {
    await catchUp({ head });
    take(await storedRegistrations(want()));
    if (want().length === 0) return out;
  } catch (err) {
    logger.warn('onchain.sync_failed', { reason: (err as Error).message });
  }
  const missing = new Set(want());
  const fresh = await tail(await syncedBlock(), head);
  take(
    fresh
      .filter((r) => r.event === 'NameRegistered' && missing.has(r.node))
      .map((r) => ({ node: r.node as Hex, name: r.name!, registeredAt: r.block_timestamp! })),
  );
  return out;
}
