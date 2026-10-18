import { env } from '../config/env';
import { logger } from '../utils/logger';

// Lookups of on-chain names (the Base registry) through the indexer, used to say whether a
// Paytag account and the on-chain name of the same spelling belong together.
//
// No cache here, deliberately. /resolve keeps the result inside its own 30s resolve cache (the
// single staleness window for the status, failures included), and /register must read the
// indexer fresh because the answer gates the signup.

/** /resolve is the payment path; the badge isn't worth holding the addresses back for. */
export const RESOLVE_TIMEOUT_MS = 300;
/** /register gates a decision, and the user is already waiting on a database write. */
export const REGISTER_TIMEOUT_MS = 1_000;

export type OnchainLookup =
  | { kind: 'owner'; owner: string }
  | { kind: 'none' }
  | { kind: 'syncing' }
  | { kind: 'unavailable' };

export type OnchainStatus = 'linked' | 'not_linked' | 'none' | 'syncing' | 'unavailable';

/**
 * Stops calling an indexer that keeps failing: after `threshold` consecutive failures it
 * reports `unavailable` for `openMs` without a request, then lets one probe through, which
 * closes it on success or reopens it on failure. The API calls the indexer with a server key
 * that skips the indexer's own rate limit, so this is what protects a struggling indexer.
 */
export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;
  private probing = false;

  constructor(
    private readonly threshold = 5,
    private readonly openMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether a request may go out now. A `true` while open claims the single probe. */
  allow(): boolean {
    if (this.failures < this.threshold) return true;
    if (this.probing || this.now() < this.openUntil) return false;
    this.probing = true;
    return true;
  }

  success(): void {
    this.failures = 0;
    this.probing = false;
  }

  failure(): void {
    this.failures += 1;
    this.probing = false;
    if (this.failures >= this.threshold) this.openUntil = this.now() + this.openMs;
  }

  /** The outcome said nothing about the indexer's health; free a claimed probe slot. */
  release(): void {
    this.probing = false;
  }
}

const breaker = new CircuitBreaker();

/** Tests only. */
export const resetOnchainBreaker = (): void => breaker.success();

/** Outcome reporting for one lookup: the shared breaker, or nothing (see `useBreaker`). */
const NO_BREAKER = { success: () => {}, failure: () => {}, release: () => {} };

/**
 * The on-chain owner of `name` (already normalized and validated). Never throws: any failure
 * is reported as `unavailable` so callers can carry on without the on-chain answer.
 *
 * `useBreaker: false` (for /register) neither consults the breaker nor counts toward it. The
 * reads run on a shorter budget, so an indexer answering in 300ms–1s would open the breaker
 * from public reads alone, and /register would then skip a check it had time for. Signups are
 * rare and per-wallet, so they can always afford the call.
 */
export const getOnchainOwner = async (
  name: string,
  opts: { timeoutMs: number; useBreaker?: boolean },
): Promise<OnchainLookup> => {
  if (!env.INDEXER_URL) return { kind: 'unavailable' };
  const useBreaker = opts.useBreaker ?? true;
  if (useBreaker && !breaker.allow()) return { kind: 'unavailable' };
  const outcome = useBreaker ? breaker : NO_BREAKER;

  let res: Response;
  try {
    res = await fetch(`${env.INDEXER_URL.replace(/\/+$/, '')}/resolve/${encodeURIComponent(name)}`, {
      headers: env.INDEXER_SERVER_KEY ? { 'x-paytag-server-key': env.INDEXER_SERVER_KEY } : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    outcome.failure();
    logger.warn('onchain.lookup_failed', { name, reason: (err as Error).name });
    return { kind: 'unavailable' };
  }

  // 404 and 503 are only trusted with the indexer's own error code: a reverse proxy answers 404
  // when no route matches and 503 while a container is swapped, and a wrong INDEXER_URL path
  // 404s too. Read as "not registered", those would let a held name through.
  const body = (await res.json().catch(() => null)) as { owner?: unknown; code?: unknown } | null;
  if (res.status === 404 && body?.code === 'USER_NOT_FOUND') {
    outcome.success();
    return { kind: 'none' };
  }
  // The indexer's 503 NOT_READY is a quick answer that it's still syncing, not a sign of trouble,
  // so it doesn't count toward the breaker. Known choice: an indexer stuck syncing for a long time
  // keeps taking one call per lookup. Fine at the current volume.
  if (res.status === 503 && body?.code === 'NOT_READY') {
    outcome.release();
    return { kind: 'syncing' };
  }
  if (res.ok && typeof body?.owner === 'string') {
    outcome.success();
    return { kind: 'owner', owner: body.owner.toLowerCase() };
  }
  // Other 5xx, 429 (our key missing or wrong), foreign 404/503s and malformed bodies all count
  // as failures.
  outcome.failure();
  logger.warn('onchain.lookup_failed', { name, status: res.status });
  return { kind: 'unavailable' };
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
