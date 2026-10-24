import { randomUUID } from 'node:crypto';
import { type Hex, decodeEventLog, getAbiItem } from 'viem';
import { env } from '../config/env';
import { supabase } from '../config/supabase';
import { chainClient } from '../onchain/client';
import { REGISTRY_ADDRESS, RESOLVER_ADDRESS } from '../onchain/deployment';
import { PaytagRegistryAbi } from '../onchain/generated/PaytagRegistryAbi';
import { PaytagResolverAbi } from '../onchain/generated/PaytagResolverAbi';
import { normalizeName } from '../onchain/names';
import { ChainUnavailableError, readHead } from '../onchain/state';
import { AppError } from '../utils/errors';
import { type DbErrorLike, dbError } from '../utils/dbErrors';
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

// Long enough for the slowest catch-up (Blockscout paging, or ONCHAIN_MAX_CHUNKS_PER_REQUEST
// eth_getLogs calls), so a lease isn't lost mid-sync; a machine that dies holding it delays the
// next sync by at most this long, and lists are still served meanwhile (table + tail).
const LEASE_SECONDS = 300;
/** A machine syncs on the request path at most this often; the tail covers the blocks since. */
const SYNC_EVERY_MS = 30_000;
const BLOCKSCOUT_TIMEOUT_MS = 8_000;
/** Etherscan-compatible getLogs returns at most this many logs per call. */
const BLOCKSCOUT_PAGE = 1_000;
const BLOCKSCOUT_MAX_PAGES = 20;
/** The fresh read past the cursor covers at most this many eth_getLogs calls. */
const TAIL_MAX_CHUNKS = 3;
const INSERT_BATCH = 500;

const lower = (v: string) => v.toLowerCase();

/**
 * An error's message, safe to log: viem puts the request URL in its messages, and the fallback
 * RPC's URL carries an API key. Every URL is replaced, and the text is clipped.
 */
export const safeReason = (err: unknown): string =>
  String((err as Error)?.message ?? err)
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .slice(0, 300);

/** Runs a chain call; any failure becomes ChainUnavailableError (logged without URLs). */
async function onChain<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn('onchain.rpc_failed', { what, reason: safeReason(err) });
    throw new ChainUnavailableError();
  }
}

/** Throws for a Supabase result's error: 503 if the database couldn't be reached, else a 500. */
function dbCheck(what: string, error: DbErrorLike | null, status?: number): void {
  if (error) throw dbError(what, error, status);
}

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
    case 'NameRegistered': {
      // The name text is stored for good and can't be re-checked against contract state later, so
      // a row from any source must hash to its node (as the registry computes it), or it's dropped.
      const parsed = normalizeName(decoded.args.name);
      if (!parsed.ok || parsed.name !== decoded.args.name || parsed.node !== base.node) return null;
      return {
        ...base,
        event: 'NameRegistered',
        name: decoded.args.name,
        to_address: lower(decoded.args.owner),
        block_timestamp: log.timestamp ?? null,
      };
    }
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

/**
 * The newest block Blockscout has indexed: the sync never moves the cursor past it. Only trusted
 * while Blockscout says its block indexing is finished: after a restart it indexes new blocks
 * before backfilling older ones, and a cursor moved over such a gap would skip it for good.
 */
async function blockscoutHead(): Promise<bigint> {
  const status = (await blockscoutGet('/api/v2/main-page/indexing-status')) as { finished_indexing_blocks?: unknown };
  if (status?.finished_indexing_blocks !== true) throw new Error('Blockscout: block indexing not finished');
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
    const found = await onChain('eth_getLogs', () =>
      chainClient().getLogs({ address: [REGISTRY_ADDRESS, RESOLVER_ADDRESS], fromBlock: start, toBlock: end }),
    );
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
    const b = await onChain('eth_getBlockByNumber', () => chainClient().getBlock({ blockNumber: BigInt(block) }));
    times.set(block, Number(b.timestamp));
  }
  return rows.map((r) => (r.event === 'NameRegistered' && r.block_timestamp == null ? { ...r, block_timestamp: times.get(r.block_number)! } : r));
}

// --- The table and its cursor -----------------------------------------------------------------

async function insertRows(rows: EventRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { error, status } = await supabase
      .from('onchain_events')
      .upsert(rows.slice(i, i + INSERT_BATCH), { onConflict: 'block_number,log_index', ignoreDuplicates: true });
    dbCheck('onchain_events insert', error, status);
  }
}

/** Every block up to and including this one is in the table. */
export async function syncedBlock(): Promise<bigint> {
  const { data, error, status } = await supabase.from('onchain_sync_state').select('last_synced_block').single();
  // The row is seeded by migration 0008; without it this is a deployment error, not an outage.
  // (.single() reports a missing row as PGRST116.)
  if (error?.code === 'PGRST116' || (!error && !data)) throw new Error('onchain_sync_state: missing row (run migration 0008)');
  dbCheck('onchain_sync_state', error, status);
  return BigInt((data as { last_synced_block: number | string }).last_synced_block);
}

async function rpcCall<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error, status } = await supabase.rpc(fn, args);
  dbCheck(fn, error, status);
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
      logger.warn('onchain.sync_blockscout_failed', { reason: safeReason(err) });
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
      logger.warn('onchain.sync_release_failed', { reason: safeReason(err) }),
    );
  }
}

/**
 * The events after the cursor, read fresh from the chain (not stored: they're inside the reorg
 * margin, or past a sync that didn't finish). Covers at most TAIL_MAX_CHUNKS calls; a longer gap
 * is left to the sync, and the caller just sees fewer candidates for now.
 */
export async function tail(cursor: bigint, head: bigint): Promise<{ rows: EventRow[]; reached: bigint }> {
  if (head <= cursor) return { rows: [], reached: head };
  const { logs, reached } = await rpcLogs(cursor + 1n, head, TAIL_MAX_CHUNKS);
  if (reached < head) logger.warn('onchain.tail_truncated', { cursor: cursor.toString(), head: head.toString() });
  return { rows: await toRows(logs), reached };
}

/**
 * The tail, for a request. Without `minBlock` a failed read is just fewer candidates for now. With
 * it, the caller is waiting for a write it just made, so a tail that failed or stopped short of
 * that block is a 503 (the app retries) rather than a list silently missing the write.
 */
async function tailFor(cursor: bigint, head: bigint, minBlock: bigint | undefined): Promise<EventRow[]> {
  try {
    const { rows, reached } = await tail(cursor, head);
    if (minBlock !== undefined && reached < minBlock) {
      throw new ChainUnavailableError(`Events up to block ${minBlock} aren't readable yet; retry shortly`, 'ONCHAIN_BEHIND');
    }
    return rows;
  } catch (err) {
    if (minBlock !== undefined) throw err;
    logger.warn('onchain.tail_failed', { reason: safeReason(err) });
    return [];
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The chain head, retried once if the RPC is behind `minBlock` (then ONCHAIN_BEHIND). */
async function headAtLeast(minBlock: bigint | undefined): Promise<bigint> {
  const head = await readHead();
  if (minBlock === undefined || head >= minBlock) return head;
  await sleep(1_000);
  const again = await readHead();
  if (again >= minBlock) return again;
  throw new ChainUnavailableError(`The chain hasn't reached block ${minBlock} yet; retry shortly`, 'ONCHAIN_BEHIND');
}

// Per machine: at most one request-path sync at a time (others wait for it), and none within
// SYNC_EVERY_MS of the last one. The cross-machine guard is the lease.
let syncing: Promise<void> | null = null;
let lastSyncAt = -Infinity;

/** Tests only. */
export const resetSyncThrottle = (): void => {
  syncing = null;
  lastSyncAt = -Infinity;
};

/** catchUp on the request path: throttled, coalesced, and never fatal (lists serve what's there). */
function syncIfDue(head: bigint): Promise<void> {
  if (syncing) return syncing;
  if (Date.now() - lastSyncAt < SYNC_EVERY_MS) return Promise.resolve();
  syncing = catchUp({ head })
    .then(() => undefined)
    .catch((err) => logger.warn('onchain.sync_failed', { reason: safeReason(err) }))
    .finally(() => {
      // Failed attempts count too: a broken source isn't retried on every request.
      lastSyncAt = Date.now();
      syncing = null;
    });
  return syncing;
}

/**
 * Stored rows plus the fresh tail, for a list request. Syncs first (non-blocking: a busy lease or
 * a failed sync just serves what's stored). Throws only when the chain itself can't be read, or
 * hasn't reached `minBlock`.
 */
export async function currentEvents(
  select: (cursor: bigint) => Promise<EventRow[]>,
  matches: (row: EventRow) => boolean,
  minBlock?: bigint,
): Promise<EventRow[]> {
  const head = await headAtLeast(minBlock);
  await syncIfDue(head);
  const cursor = await syncedBlock();
  const [stored, fresh] = await Promise.all([select(cursor), tailFor(cursor, head, minBlock)]);
  return [...stored, ...fresh.filter(matches)];
}

// --- Queries ----------------------------------------------------------------------------------

/** Most rows a list query reads (Supabase's max_rows); far above any real owner's count here. */
const QUERY_LIMIT = 1_000;
/** Nodes per `in` filter: each adds ~67 bytes to the GET URL, which has a length limit. */
const IN_BATCH = 100;

export async function storedTransfersTo(address: string): Promise<EventRow[]> {
  const { data, error, status } = await supabase
    .from('onchain_events')
    .select('node')
    .eq('event', 'Transfer')
    .eq('to_address', lower(address))
    .limit(QUERY_LIMIT);
  dbCheck('onchain_events', error, status);
  return (data ?? []) as EventRow[];
}

export async function storedEthRecordsFor(address: string): Promise<EventRow[]> {
  const { data, error, status } = await supabase
    .from('onchain_events')
    .select('node')
    .eq('event', 'RecordSet')
    .eq('coin_type', 60)
    .eq('value', lower(address))
    .limit(QUERY_LIMIT);
  dbCheck('onchain_events', error, status);
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
  const out: Registration[] = [];
  for (let i = 0; i < nodes.length; i += IN_BATCH) {
    const { data, error, status } = await supabase
      .from('onchain_events')
      .select('node, name, block_timestamp')
      .eq('event', 'NameRegistered')
      .in('node', nodes.slice(i, i + IN_BATCH).map(lower))
      .limit(QUERY_LIMIT);
    dbCheck('onchain_events', error, status);
    for (const r of (data ?? []) as { node: string; name: string; block_timestamp: number | string }[]) {
      out.push({ node: r.node as Hex, name: r.name, registeredAt: Number(r.block_timestamp) });
    }
  }
  return out;
}

/**
 * Name and registration time for each node (by node). A node registered after the cursor isn't in
 * the table yet: it's looked up by syncing, then in the fresh tail. A node still missing after
 * that is left out (the caller decides what that means).
 */
export async function registrationsOf(nodes: readonly Hex[], minBlock?: bigint): Promise<Map<string, Registration>> {
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

  const head = await headAtLeast(minBlock);
  await syncIfDue(head);
  take(await storedRegistrations(want()));
  if (want().length === 0) return out;

  // A chain failure here (no minBlock) leaves the node out: the caller reports it as unavailable.
  const missing = new Set(want());
  const fresh = await tailFor(await syncedBlock(), head, minBlock);
  take(
    fresh
      .filter((r) => r.event === 'NameRegistered' && missing.has(r.node))
      .map((r) => ({ node: r.node as Hex, name: r.name!, registeredAt: r.block_timestamp! })),
  );
  return out;
}
