import { Cache, MemoryCache } from './cache';
import { PaytagError, PaytagErrorCode } from './errors';
import {
  USERNAME_REGEX,
  isChainId,
  parseAvailabilityResponse,
  parseOnchainResolveResponse,
  parseResolveResponse,
} from './parse';
import {
  AvailabilityResponse,
  ChainId,
  DEFAULT_BASE_URL,
  DEFAULT_INDEXER_URL,
  OnchainResolveResponse,
  ResolveResponse,
} from './types';

export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string>; redirect?: 'error' },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface PaytagOptions {
  /**
   * Base URL of the Paytag API. Defaults to `https://api.paytag.dev` so the
   * SDK works zero-config; override only when self-hosting or running tests.
   * Must be https, except on localhost.
   */
  baseUrl?: string;
  /**
   * Base URL of the on-chain endpoints used by `resolveViaIndexer`. Defaults to
   * `https://api.paytag.dev/onchain`. Must be https, except on localhost.
   */
  indexerUrl?: string;
  /**
   * Cache for `resolve`. `true` (default) enables an in-memory cache with a 30s TTL.
   * Pass `false` to disable, a number to set the TTL in ms, or a custom `Cache` impl.
   */
  cache?: boolean | number | Cache<ResolveResponse>;
  /**
   * Cache for `resolveViaIndexer`. Off by default, so every call reads current on-chain
   * state; with a cache, a result can show a previous owner and records for up to the TTL
   * after a transfer. Same values as `cache`.
   */
  indexerCache?: boolean | number | Cache<OnchainResolveResponse>;
  /**
   * Abort a request that hasn't fully answered after this many ms, with code `TIMEOUT`.
   * Defaults to 10000; `0` disables it.
   */
  timeoutMs?: number;
  /** Custom fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
}

export interface ResolveOptions {
  signal?: AbortSignal;
  /** Skip the cache for this call (still writes the fresh result back). */
  fresh?: boolean;
  /**
   * `resolveViaIndexer` only: the answer must reflect at least this block, e.g. the block of a
   * write you just made. Skips the cache; the server answers 503 if its RPC is still behind.
   */
  minBlock?: bigint | number;
}

export interface AvailableOptions {
  signal?: AbortSignal;
  /**
   * The caller's EVM wallet. A name this wallet owns on-chain isn't reported as
   * `TAKEN_ONCHAIN`, since registering it would link the two.
   */
  wallet?: string;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;
/** setTimeout fires immediately for delays above this. */
const MAX_TIMEOUT_MS = 2_147_483_647;
/** Server error text is passed through to callers (and often their UI), so it is clipped. */
const MAX_ERROR_MESSAGE_LENGTH = 200;
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

export class Paytag {
  private readonly baseUrl: string;
  private readonly indexerUrl: string;
  private readonly cache: Cache<ResolveResponse> | null;
  private readonly indexerCache: Cache<OnchainResolveResponse> | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: PaytagOptions = {}) {
    this.baseUrl = serviceUrl(options.baseUrl, DEFAULT_BASE_URL, 'baseUrl');
    this.indexerUrl = serviceUrl(options.indexerUrl, DEFAULT_INDEXER_URL, 'indexerUrl');

    const fetchImpl =
      options.fetch ??
      (typeof globalThis.fetch === 'function'
        ? (globalThis.fetch.bind(globalThis) as unknown as FetchLike)
        : undefined);
    if (!fetchImpl) {
      throw new PaytagError(
        'Paytag: no fetch implementation found. Provide one via `options.fetch` or run on Node 18+.',
        'CONFIG_ERROR',
      );
    }
    this.fetchImpl = fetchImpl;

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      typeof timeoutMs !== 'number' ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs < 0 ||
      timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new PaytagError(
        `Paytag: timeoutMs must be between 0 and ${MAX_TIMEOUT_MS}`,
        'CONFIG_ERROR',
      );
    }
    this.timeoutMs = timeoutMs;

    this.cache = resolveCacheOption(options.cache, true);
    this.indexerCache = resolveCacheOption(options.indexerCache, false);
  }

  /**
   * Resolve a paytag username to its registered wallet addresses. The result is frozen.
   *
   * @throws {PaytagError} with `code = 'USER_NOT_FOUND'` if the name is unregistered, or
   * `INVALID_RESPONSE` if the API returned anything malformed (including any one address).
   */
  async resolve(username: string, opts: ResolveOptions = {}): Promise<ResolveResponse> {
    const normalized = normalizeUsername(username);

    if (this.cache && !opts.fresh) {
      const cached = this.cache.get(normalized);
      if (cached) return cached;
    }

    const url = `${this.baseUrl}/resolve/${encodeURIComponent(normalized)}`;
    const result = await this.requestJson(url, opts.signal);
    const parsed = parseResolveResponse(result, normalized);

    this.cache?.set(normalized, parsed);
    return parsed;
  }

  /**
   * Resolve a username from on-chain state (the Base registry), via the Paytag API's on-chain
   * endpoints, which read the contracts directly.
   * Returns the same `addresses` map as `resolve`, plus the on-chain owner and every raw
   * record; each address is checked against the record bytes it came from. Every record was
   * set by the owner at the time of the read: a transfer clears them on-chain (see
   * `epoch` and `recordsReset`). Not cached unless `indexerCache` is set.
   *
   * Never falls back to the off-chain `resolve`: if the on-chain endpoints are unreachable this
   * throws `NETWORK_ERROR`,
   * so callers always know which source answered.
   *
   * @throws {PaytagError} with `code = 'USER_NOT_FOUND'` if the name isn't registered on-chain.
   */
  async resolveViaIndexer(
    username: string,
    opts: ResolveOptions = {},
  ): Promise<OnchainResolveResponse> {
    const normalized = normalizeUsername(username);
    const cacheKey = onchainCacheKey(normalized);
    const minBlock = blockNumberOption(opts.minBlock);

    if (this.indexerCache && !opts.fresh && minBlock === undefined) {
      const cached = this.indexerCache.get(cacheKey);
      if (cached) return cached;
    }

    const query = minBlock === undefined ? '' : `?minBlock=${minBlock}`;
    const url = `${this.indexerUrl}/resolve/${encodeURIComponent(normalized)}${query}`;
    const result = await this.requestJson(url, opts.signal);
    const parsed = parseOnchainResolveResponse(result, normalized);

    this.indexerCache?.set(cacheKey, parsed);
    return parsed;
  }

  /**
   * Convenience: resolve a single chain. Returns `null` if the user has no
   * address registered for that chain (or `chain` isn't a supported chain).
   * Throws `USER_NOT_FOUND` if the user doesn't exist at all.
   */
  async resolveAddress(
    username: string,
    chain: ChainId,
    opts: ResolveOptions = {},
  ): Promise<string | null> {
    const result = await this.resolve(username, opts);
    return isChainId(chain) ? (result.addresses[chain] ?? null) : null;
  }

  /**
   * Check whether a username is available to claim. Unlike `resolve`, this
   * does not validate the input locally — invalid formats are surfaced via
   * `reason: 'INVALID_FORMAT'` so callers can render specific UI feedback.
   */
  async available(
    username: string,
    opts: AvailableOptions = {},
  ): Promise<AvailabilityResponse> {
    const cleaned = normalizeForAvailability(username);
    const query = opts.wallet ? `?wallet=${encodeURIComponent(opts.wallet)}` : '';
    const url = `${this.baseUrl}/available/${encodeURIComponent(cleaned)}${query}`;
    const result = await this.requestJson(url, opts.signal);
    return parseAvailabilityResponse(result);
  }

  /** Drop a single username from the caches (or pass nothing to clear all). */
  invalidate(username?: string): void {
    if (username) {
      const normalized = normalizeUsername(username);
      this.cache?.delete(normalized);
      this.indexerCache?.delete(onchainCacheKey(normalized));
    } else {
      this.cache?.clear();
      this.indexerCache?.clear();
    }
  }

  private async requestJson(url: string, signal?: AbortSignal): Promise<unknown> {
    // One controller for both the caller's signal and the timeout. AbortSignal.any would do
    // this, but it needs Node 20.3+ and the SDK supports Node 18.
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });

    // Raced as well as aborted, so a custom fetch that ignores the signal still times out.
    // Whatever error the fetch then rejects with, a request past its deadline is a TIMEOUT:
    // per the fetch spec, abort() rejects the fetch synchronously, before the race settles.
    const timeoutError = new PaytagError(`Request timed out after ${this.timeoutMs}ms`, 'TIMEOUT');
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut =
      this.timeoutMs > 0
        ? new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              expired = true;
              reject(timeoutError);
              controller.abort();
            }, this.timeoutMs);
          })
        : undefined;
    timedOut?.catch(() => {}); // rejects only while a race is pending; never unhandled
    const bounded = <T>(p: Promise<T>): Promise<T> => (timedOut ? Promise.race([p, timedOut]) : p);

    try {
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await bounded(
          this.fetchImpl(url, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
            // The https check above only holds if a redirect can't move the request elsewhere
            // (Node's fetch follows https → http).
            redirect: 'error',
          }),
        );
      } catch (err) {
        if (expired) throw timeoutError;
        if ((err as Error)?.name === 'AbortError') throw err;
        throw new PaytagError(
          clip(`Network error: ${(err as Error)?.message ?? 'unknown'}`),
          'NETWORK_ERROR',
        );
      }

      let body: unknown = null;
      try {
        body = await bounded(res.json());
      } catch (err) {
        // A timeout or abort while reading the body is not an empty body.
        if (expired) throw timeoutError;
        if (controller.signal.aborted) throw err;
        // Otherwise the body may legitimately be empty on some errors.
      }

      if (!res.ok) {
        const { code, message } = extractApiError(body, res.status);
        throw new PaytagError(message, code, res.status);
      }

      return body;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

function resolveCacheOption<V>(
  option: boolean | number | Cache<V> | undefined,
  enabledByDefault: boolean,
): Cache<V> | null {
  if (option === false || (option === undefined && !enabledByDefault)) return null;
  if (option === undefined || option === true) return new MemoryCache<V>(DEFAULT_TTL_MS);
  if (typeof option === 'number') return new MemoryCache<V>(option);
  return option;
}

/** A validated service base URL without trailing slashes. https only, except on localhost. */
function serviceUrl(raw: unknown, fallback: string, name: string): string {
  const value = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PaytagError(`Paytag: ${name} is not a valid URL`, 'CONFIG_ERROR');
  }
  const local = LOCAL_HOSTNAMES.includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new PaytagError(
      `Paytag: ${name} must use https (http is allowed only on localhost)`,
      'CONFIG_ERROR',
    );
  }
  // A loop, not /\/+$/: that regex is quadratic on long runs of slashes.
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end--;
  return value.slice(0, end);
}

function clip(message: string): string {
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : message;
}

// Only ASCII is transformed, matching the API and the on-chain registry: String#trim strips
// Unicode whitespace and String#toLowerCase folds some non-ASCII into ASCII (the Kelvin sign
// U+212A becomes "k"), which would accept input those layers reject.
function asciiClean(raw: string): string {
  return raw
    .replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '')
    .replace(/^@/, '')
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

function normalizeUsername(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new PaytagError('Username must be a string', 'INVALID_USERNAME');
  }
  const cleaned = asciiClean(raw);
  if (!USERNAME_REGEX.test(cleaned)) {
    throw new PaytagError(
      'Invalid username — must be 3–20 chars of [a-z0-9_]',
      'INVALID_USERNAME',
    );
  }
  return cleaned;
}

// `available()` intentionally accepts shapes the API will reject so the caller
// can surface targeted feedback; we still trim/lower and require a non-empty
// string that can't change the request path ("/", or a "." / ".." segment,
// which encodeURIComponent leaves as-is and URL parsing resolves).
function normalizeForAvailability(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new PaytagError('Username must be a string', 'INVALID_USERNAME');
  }
  const cleaned = asciiClean(raw);
  if (cleaned.length === 0 || cleaned.includes('/') || cleaned === '.' || cleaned === '..') {
    throw new PaytagError(
      'Invalid username — must be a non-empty string without "/", and not "." or ".."',
      'INVALID_USERNAME',
    );
  }
  return cleaned;
}

/** A block number option as a decimal string, or undefined when absent. */
function blockNumberOption(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if ((typeof value === 'bigint' && value >= 0n) || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) {
    return value.toString();
  }
  throw new PaytagError('minBlock must be a non-negative integer', 'CONFIG_ERROR');
}

// Prefixed so API and on-chain results for the same name never collide in a shared cache.
// "onchain:" can't be a username ([a-z0-9_] only), so the namespaces are disjoint.
function onchainCacheKey(normalized: string): string {
  return `onchain:${normalized}`;
}

function extractApiError(
  body: unknown,
  status: number,
): { code: PaytagErrorCode; message: string } {
  const b = (body ?? {}) as { error?: unknown; code?: unknown };
  const message = clip(
    typeof b.error === 'string' ? b.error : `Request failed with status ${status}`,
  );
  // Only a 404 that says so is "not found": a bare 404 (a wrong baseUrl, a proxy page) isn't
  // evidence the name is free. The API's off-chain and on-chain endpoints both send this code.
  if (status === 404 && b.code === 'USER_NOT_FOUND') {
    return { code: 'USER_NOT_FOUND', message };
  }
  return { code: 'HTTP_ERROR', message };
}
