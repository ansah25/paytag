import { type Hex, getAddress } from 'viem';
import { decodeAddress } from '../onchain/codec';
import { normalizeName } from '../onchain/names';
import { RESERVED_NODES } from '../onchain/generated/reservedNodes';
import { type RecordRow, type ResolveBody, buildResolveBody } from '../onchain/resolve';
import { ChainUnavailableError, readEthRecords, readNames, readReverse } from '../onchain/state';
import { TtlCache } from '../utils/cache';
import { BadRequestError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';
import {
  type EventRow,
  currentEvents,
  registrationsOf,
  storedEthRecordsFor,
  storedTransfersTo,
} from './onchainEventsService';

// On-chain names (the Base registry), read from the contracts. Lookups are direct reads of current
// state, so there's no sync lag and nothing to go stale; the two lists come from the lazily synced
// events table, with every entry re-checked against live state (onchainEventsService).
//
// Response shapes are the ones the Ponder indexer served, so the SDK (resolveViaIndexer) and the
// web app read them unchanged.

/** /resolve is the payment path; the badge isn't worth holding the addresses back for long. */
export const RESOLVE_TIMEOUT_MS = 800;
/** /register gates a decision, and the user is already waiting on a database write. */
export const REGISTER_TIMEOUT_MS = 1_000;

/**
 * Lookups are cached for 30s like the API's /resolve. A caller that just wrote passes `minBlock`
 * and skips any entry read before that block.
 */
const LOOKUP_TTL_MS = 30_000;
const MAX_CACHED = 10_000;

interface Cached<T> {
  value: T;
  block: bigint;
}

class LookupCache<T> {
  private readonly cache = new TtlCache<Cached<T>>(LOOKUP_TTL_MS);
  private size = 0;

  get(key: string, minBlock: bigint | undefined): T | undefined {
    const hit = this.cache.get(key);
    if (!hit || (minBlock !== undefined && hit.block < minBlock)) return undefined;
    return hit.value;
  }

  set(key: string, value: T, block: bigint): void {
    // A crude bound: a flood of distinct names can't grow memory without limit.
    if (++this.size > MAX_CACHED) {
      this.cache.clear();
      this.size = 0;
    }
    this.cache.set(key, { value, block });
  }

  clear(): void {
    this.cache.clear();
    this.size = 0;
  }
}

type ResolveOutcome = { kind: 'found'; body: ResolveBody } | { kind: 'missing'; name: string };
const resolveCache = new LookupCache<ResolveOutcome>();
const reverseCache = new LookupCache<{ address: string; username: string | null }>();

/** Tests only. */
export const clearOnchainCaches = (): void => {
  resolveCache.clear();
  reverseCache.clear();
};

export interface ReadOpts {
  minBlock?: bigint;
}

const parseName = (raw: string) => {
  const parsed = normalizeName(raw);
  if (!parsed.ok) throw new BadRequestError(`Invalid username: ${parsed.reason}`, 'INVALID_USERNAME');
  return parsed;
};

/** GET /onchain/resolve/:name */
export async function resolveOnchain(raw: string, opts: ReadOpts = {}): Promise<ResolveBody> {
  const { name, node } = parseName(raw);
  let outcome = resolveCache.get(node, opts.minBlock);
  if (!outcome) {
    const { value, block } = await readNames([node], opts);
    const state = value[0]!;
    if (!state.owner) {
      outcome = { kind: 'missing', name };
    } else {
      // The registration time isn't in contract state: it's the NameRegistered event's.
      const registration = (await registrationsOf([node])).get(node);
      if (!registration) throw new ChainUnavailableError(`@${name}'s registration isn't indexed yet; retry shortly`);
      const rows: RecordRow[] = state.records.map((r) => ({
        node,
        coinType: r.coinType,
        value: r.value,
        address: decodeAddress(r.coinType, r.value),
        updatedOrdinal: 0n,
      }));
      outcome = {
        kind: 'found',
        body: buildResolveBody(
          { node, name, owner: state.owner, registeredAt: BigInt(registration.registeredAt), epoch: state.epoch },
          rows,
        ),
      };
    }
    resolveCache.set(node, outcome, block);
  }
  if (outcome.kind === 'missing') throw new NotFoundError(`@${outcome.name} is not registered on-chain`, 'USER_NOT_FOUND');
  return outcome.body;
}

export type OnchainAvailability =
  | { available: true; suggestions: string[] }
  | { available: false; reason: 'INVALID_FORMAT' | 'RESERVED' | 'TAKEN'; suggestions: string[] };

/** GET /onchain/available/:name. Not cached: a name can be taken at any moment. */
export async function availableOnchain(raw: string): Promise<OnchainAvailability> {
  const parsed = normalizeName(raw);
  if (!parsed.ok) return { available: false, reason: 'INVALID_FORMAT', suggestions: [] };

  // Suggestions contain a digit or underscore, which no reserved name does, so they never need the
  // reserved check. Read with the name in the same round trip.
  const candidates = [`${parsed.name}_`, `${parsed.name}1`, `${parsed.name}_pay`, `${parsed.name}2`]
    .map((n) => normalizeName(n))
    .filter((r): r is Extract<typeof r, { ok: true }> => r.ok);
  const reserved = RESERVED_NODES.has(parsed.node);
  const { value } = await readNames([parsed.node, ...candidates.map((c) => c.node)], { ownersOnly: true });
  const taken = value[0]!.owner !== null;
  if (!reserved && !taken) return { available: true, suggestions: [] };
  const suggestions = candidates.filter((_, i) => value[i + 1]!.owner === null).map((c) => c.name).slice(0, 3);
  return { available: false, reason: reserved ? 'RESERVED' : 'TAKEN', suggestions };
}

/** GET /onchain/reverse/:address: the name `address` has claimed, if the claim is still live. */
export async function reverseOnchain(address: string, opts: ReadOpts = {}): Promise<{ address: string; username: string | null }> {
  const account = address.toLowerCase() as Hex;
  const cached = reverseCache.get(account, opts.minBlock);
  if (cached) return cached;
  const { value: node, block } = await readReverse(account, opts);
  let username: string | null = null;
  if (node) {
    const registration = (await registrationsOf([node])).get(node.toLowerCase());
    if (!registration) throw new ChainUnavailableError('The claimed name isn’t indexed yet; retry shortly');
    username = registration.name;
  }
  const result = { address: getAddress(account), username };
  reverseCache.set(account, result, block);
  return result;
}

const uniqueNodes = (rows: EventRow[]): Hex[] => [...new Set(rows.map((r) => r.node.toLowerCase()))] as Hex[];

/** GET /onchain/names?owner=: names `owner` holds now, by name. */
export async function namesByOwner(
  owner: string,
  opts: ReadOpts = {},
): Promise<{ owner: string; names: { name: string; node: Hex; registeredAt: number }[] }> {
  const me = owner.toLowerCase();
  // Candidates: every name ever transferred to `owner` (registration mints with a Transfer too).
  const rows = await currentEvents(
    () => storedTransfersTo(me),
    (r) => r.event === 'Transfer' && r.to_address === me,
  );
  const candidates = uniqueNodes(rows);
  const held = candidates.length
    ? (await readNames(candidates, { ...opts, ownersOnly: true })).value.filter((s) => s.owner === me).map((s) => s.node)
    : [];
  const names = await registrationsOf(held);
  return {
    owner: getAddress(me),
    names: held
      .flatMap((node) => {
        const r = names.get(node);
        if (!r) logger.warn('onchain.registration_missing', { node });
        return r ? [{ name: r.name, node, registeredAt: r.registeredAt }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Candidates beyond this many aren't checked (one multicall's worth). */
const POINTING_MAX_CANDIDATES = 1_000;

/**
 * GET /onchain/pointing?account=: names whose current ETH record is `account` but which `account`
 * doesn't own, so it can make one of them its primary name.
 */
export async function namesPointingAt(
  account: string,
  opts: ReadOpts = {},
): Promise<{ account: string; names: { name: string; node: Hex; owner: string }[] }> {
  const me = account.toLowerCase();
  const rows = await currentEvents(
    () => storedEthRecordsFor(me),
    (r) => r.event === 'RecordSet' && r.coin_type === '60' && r.value === me,
  );
  const candidates = uniqueNodes(rows).slice(0, POINTING_MAX_CANDIDATES);
  const live = candidates.length
    ? (await readEthRecords(candidates, opts)).value.filter((s) => s.eth === me && s.owner !== null && s.owner !== me)
    : [];
  const names = await registrationsOf(live.map((s) => s.node));
  return {
    account: getAddress(me),
    names: live
      .flatMap((s) => {
        const r = names.get(s.node);
        return r ? [{ name: r.name, node: s.node, owner: getAddress(s.owner!) }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// --- Account linking (the API's own /resolve and /register) -----------------------------------

export type OnchainLookup = { kind: 'owner'; owner: string } | { kind: 'none' } | { kind: 'unavailable' };

/**
 * Whether the on-chain name of the same spelling belongs to the account. `syncing` is gone (there
 * is no sync lag in a direct read) but stays in the published SDK's type until its next minor.
 */
export type OnchainStatus = 'linked' | 'not_linked' | 'none' | 'unavailable';

/**
 * The on-chain owner of `name` (already normalized and validated). Never throws: any failure is
 * reported as `unavailable` so callers can carry on without the on-chain answer. Not cached here:
 * /resolve keeps the result inside its own 30s cache, and /register must read fresh because the
 * answer gates the signup.
 */
export const getOnchainOwner = async (name: string, opts: { timeoutMs: number }): Promise<OnchainLookup> => {
  const parsed = normalizeName(name);
  if (!parsed.ok) return { kind: 'none' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), opts.timeoutMs);
  });
  try {
    const result = await Promise.race([readNames([parsed.node], { ownersOnly: true }), budget]);
    if (result === 'timeout') {
      logger.warn('onchain.lookup_failed', { name, reason: 'TimeoutError' });
      return { kind: 'unavailable' };
    }
    const owner = result.value[0]!.owner;
    return owner ? { kind: 'owner', owner } : { kind: 'none' };
  } catch (err) {
    logger.warn('onchain.lookup_failed', { name, reason: (err as Error).name });
    return { kind: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Linked means the on-chain owner is the account's *verified* published ETH address. Only
 * public data is compared: the wallet that registered the account can differ from the
 * published address, and comparing it would let anyone test "does wallet X own @alice?" by
 * transferring the on-chain name to X. Verification needs a signature from the address, so
 * publishing someone else's address can't make an account look linked.
 */
export const linkStatus = (lookup: OnchainLookup, verifiedEthAddress: string | undefined): OnchainStatus => {
  if (lookup.kind !== 'owner') return lookup.kind;
  return verifiedEthAddress && lookup.owner === verifiedEthAddress.toLowerCase() ? 'linked' : 'not_linked';
};
