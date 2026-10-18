import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

// Per-client token buckets, in memory. One indexer instance serves the API, so a process-local
// limiter is enough; a restart simply refills everyone. The limiter takes an injected clock, and
// the Hono middleware below takes its limiters, so both are tested without Ponder.

export interface BucketConfig {
  /** Requests allowed per minute; also the burst size. */
  perMinute: number;
}

export interface Decision {
  allowed: boolean;
  limit: number;
  /** Whole requests left after this one. */
  remaining: number;
  /** Seconds until one more request is allowed (0 when allowed). */
  retryAfter: number;
  /** Seconds until the bucket is full again. */
  reset: number;
}

interface Bucket {
  tokens: number;
  updated: number;
}

/** Above this many tracked clients, full (idle) buckets are dropped... */
const PRUNE_AT = 10_000;
/** ...at most this often, so a flood of distinct clients can't make every check an O(n) scan. */
const PRUNE_EVERY_MS = 10_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly ratePerMs: number;
  private lastPrune = -Infinity;

  constructor(
    private readonly config: BucketConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.ratePerMs = config.perMinute / 60_000;
  }

  check(key: string): Decision {
    const { perMinute } = this.config;
    const t = this.now();
    if (this.buckets.size > PRUNE_AT && t - this.lastPrune >= PRUNE_EVERY_MS) {
      this.lastPrune = t;
      this.prune(t);
    }

    const bucket = this.buckets.get(key) ?? { tokens: perMinute, updated: t };
    bucket.tokens = Math.min(perMinute, bucket.tokens + (t - bucket.updated) * this.ratePerMs);
    bucket.updated = t;

    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.buckets.set(key, bucket);

    return {
      allowed,
      limit: perMinute,
      remaining: Math.floor(bucket.tokens),
      retryAfter: allowed ? 0 : Math.ceil((1 - bucket.tokens) / this.ratePerMs / 1000),
      reset: Math.ceil((perMinute - bucket.tokens) / this.ratePerMs / 1000),
    };
  }

  /** Tracked clients, for tests. */
  get size(): number {
    return this.buckets.size;
  }

  private prune(t: number) {
    for (const [key, b] of this.buckets) {
      if (b.tokens + (t - b.updated) * this.ratePerMs >= this.config.perMinute) this.buckets.delete(key);
    }
  }
}

/**
 * The client's address as seen by our reverse proxy (Coolify's Traefik). The proxy appends the
 * peer it accepted the connection from to X-Forwarded-For, so the RIGHTMOST entry is the only
 * one a client can't forge; anything to its left is client-supplied. Falls back to the socket
 * address when there's no proxy (local dev).
 */
export function clientKey(forwardedFor: string | undefined, socketAddress: string | undefined): string {
  const hops = (forwardedFor ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return hops.at(-1) ?? socketAddress ?? "unknown";
}

/**
 * Server-to-server callers (the web app's server-rendered pages, which all share Vercel's
 * egress addresses, and the Paytag API) present a shared secret instead of being limited per
 * address. Each consumer gets its own key, so one can be rotated or revoked without touching the
 * others. Every configured key is compared, so the time taken doesn't reveal which one matched.
 * No keys configured means no bypass.
 */
export function hasServerKey(presented: string | undefined, expected: readonly string[]): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  let match = false;
  for (const key of expected) {
    const b = Buffer.from(key);
    if (b.length > 0 && a.length === b.length && timingSafeEqual(a, b)) match = true;
  }
  return match;
}

/**
 * INDEXER_SERVER_KEYS (comma-separated, one per consumer) plus the legacy single
 * INDEXER_SERVER_KEY, accepted while consumers move to their own keys. Remove the legacy
 * variable once they have: left set, it stays a valid credential.
 */
export function serverKeysFromEnv(keys: string | undefined, legacy: string | undefined): string[] {
  const all = [...(keys ?? "").split(","), legacy ?? ""].map((k) => k.trim()).filter(Boolean);
  return [...new Set(all)];
}

export function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export interface RateLimitOptions {
  rest: RateLimiter;
  graphql: RateLimiter;
  /** Accepted server keys (see serverKeysFromEnv); empty disables the bypass. */
  serverKeys: readonly string[];
}

type NodeEnv = { incoming?: { socket?: { remoteAddress?: string } } } | undefined;

/**
 * Hono middleware: OPTIONS (CORS preflight) and server-key callers pass; everyone else spends a
 * token from the GraphQL or REST bucket for their address. Every limited response carries the
 * RateLimit-* headers; a refusal is a 429 in the API's `{ error, code }` shape with Retry-After.
 */
export function rateLimit({ rest, graphql, serverKeys }: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === "OPTIONS" || hasServerKey(c.req.header("x-paytag-server-key"), serverKeys)) return next();
    const socket = (c.env as NodeEnv)?.incoming?.socket;
    const key = clientKey(c.req.header("x-forwarded-for"), socket?.remoteAddress);
    const d = (c.req.path.startsWith("/graphql") ? graphql : rest).check(key);
    c.header("RateLimit-Limit", String(d.limit));
    c.header("RateLimit-Remaining", String(d.remaining));
    c.header("RateLimit-Reset", String(d.reset));
    if (d.allowed) return next();
    c.header("Retry-After", String(d.retryAfter));
    return c.json({ error: "Too many requests; slow down and retry shortly", code: "RATE_LIMITED" }, 429);
  };
}
