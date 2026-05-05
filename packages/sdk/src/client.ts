import { Cache, MemoryCache } from './cache';
import { PaytagError, PaytagErrorCode } from './errors';
import {
  AvailabilityResponse,
  ChainId,
  DEFAULT_BASE_URL,
  ResolveResponse,
} from './types';

export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface PaytagOptions {
  /**
   * Base URL of the Paytag API. Defaults to `https://api.paytag.dev` so the
   * SDK works zero-config; override only when self-hosting or running tests.
   */
  baseUrl?: string;
  /**
   * Cache configuration. `true` (default) enables an in-memory cache with a 30s TTL.
   * Pass `false` to disable, a number to set the TTL in ms, or a custom `Cache` impl.
   */
  cache?: boolean | number | Cache<ResolveResponse>;
  /** Custom fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
}

export interface ResolveOptions {
  signal?: AbortSignal;
  /** Skip the cache for this call (still writes the fresh result back). */
  fresh?: boolean;
}

export interface AvailableOptions {
  signal?: AbortSignal;
}

const DEFAULT_TTL_MS = 30_000;
const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

export class Paytag {
  private readonly baseUrl: string;
  private readonly cache: Cache<ResolveResponse> | null;
  private readonly fetchImpl: FetchLike;

  constructor(options: PaytagOptions = {}) {
    const rawBaseUrl =
      typeof options.baseUrl === 'string' && options.baseUrl.trim() !== ''
        ? options.baseUrl
        : DEFAULT_BASE_URL;
    this.baseUrl = rawBaseUrl.replace(/\/+$/, '');

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

    this.cache = resolveCacheOption(options.cache);
  }

  /**
   * Resolve a paytag username to its registered wallet addresses.
   *
   * @throws {PaytagError} with `code = 'USER_NOT_FOUND'` if the name is unregistered.
   */
  async resolve(username: string, opts: ResolveOptions = {}): Promise<ResolveResponse> {
    const normalized = normalizeUsername(username);
    const cacheKey = normalized;

    if (this.cache && !opts.fresh) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }

    const url = `${this.baseUrl}/resolve/${encodeURIComponent(normalized)}`;
    const result = await this.requestJson(url, opts.signal);
    const parsed = parseResolveResponse(result);

    this.cache?.set(cacheKey, parsed);
    return parsed;
  }

  /**
   * Convenience: resolve a single chain. Returns `null` if the user has no
   * address registered for that chain. Throws `USER_NOT_FOUND` if the user
   * doesn't exist at all.
   */
  async resolveAddress(
    username: string,
    chain: ChainId,
    opts: ResolveOptions = {},
  ): Promise<string | null> {
    const result = await this.resolve(username, opts);
    return result.addresses[chain] ?? null;
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
    const url = `${this.baseUrl}/available/${encodeURIComponent(cleaned)}`;
    const result = await this.requestJson(url, opts.signal);
    return parseAvailabilityResponse(result);
  }

  /** Drop a single username from the cache (or pass nothing to clear all). */
  invalidate(username?: string): void {
    if (!this.cache) return;
    if (username) {
      this.cache.delete(normalizeUsername(username));
    } else {
      this.cache.clear();
    }
  }

  private async requestJson(url: string, signal?: AbortSignal): Promise<unknown> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(url, {
        signal,
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      throw new PaytagError(
        `Network error: ${(err as Error)?.message ?? 'unknown'}`,
        'NETWORK_ERROR',
      );
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // body may legitimately be empty on some errors
    }

    if (!res.ok) {
      const { code, message } = extractApiError(body, res.status);
      throw new PaytagError(message, code, res.status);
    }

    return body;
  }
}

function resolveCacheOption(
  option: PaytagOptions['cache'],
): Cache<ResolveResponse> | null {
  if (option === false) return null;
  if (option === undefined || option === true) {
    return new MemoryCache<ResolveResponse>(DEFAULT_TTL_MS);
  }
  if (typeof option === 'number') {
    return new MemoryCache<ResolveResponse>(option);
  }
  return option;
}

function normalizeUsername(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new PaytagError('Username must be a string', 'INVALID_USERNAME');
  }
  const cleaned = raw.trim().replace(/^@/, '').toLowerCase();
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
// string with no path-breaking characters.
function normalizeForAvailability(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new PaytagError('Username must be a string', 'INVALID_USERNAME');
  }
  const cleaned = raw.trim().replace(/^@/, '').toLowerCase();
  if (cleaned.length === 0 || cleaned.includes('/')) {
    throw new PaytagError(
      'Invalid username — must be a non-empty string without "/"',
      'INVALID_USERNAME',
    );
  }
  return cleaned;
}

function parseResolveResponse(body: unknown): ResolveResponse {
  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as { username?: unknown }).username !== 'string' ||
    typeof (body as { addresses?: unknown }).addresses !== 'object' ||
    (body as { addresses: unknown }).addresses === null
  ) {
    throw new PaytagError('Unexpected response shape from /resolve', 'INVALID_RESPONSE');
  }
  return body as ResolveResponse;
}

function parseAvailabilityResponse(body: unknown): AvailabilityResponse {
  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as { available?: unknown }).available !== 'boolean' ||
    !Array.isArray((body as { suggestions?: unknown }).suggestions)
  ) {
    throw new PaytagError(
      'Unexpected response shape from /available',
      'INVALID_RESPONSE',
    );
  }
  return body as AvailabilityResponse;
}

function extractApiError(
  body: unknown,
  status: number,
): { code: PaytagErrorCode; message: string } {
  const b = (body ?? {}) as { error?: unknown; code?: unknown };
  const message =
    typeof b.error === 'string' ? b.error : `Request failed with status ${status}`;
  const code = typeof b.code === 'string' ? b.code : undefined;

  if (code === 'USER_NOT_FOUND' || status === 404) {
    return { code: 'USER_NOT_FOUND', message };
  }
  return { code: 'HTTP_ERROR', message };
}
