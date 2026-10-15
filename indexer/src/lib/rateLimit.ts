import { timingSafeEqual } from "node:crypto";

// Per-client token buckets, in memory. One indexer instance serves the API, so a process-local
// limiter is enough; a restart simply refills everyone. Kept free of Hono so it can be tested
// with a fake clock.

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

/** Above this many tracked clients, full (idle) buckets are dropped on the next check. */
const PRUNE_AT = 10_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly ratePerMs: number;

  constructor(
    private readonly config: BucketConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.ratePerMs = config.perMinute / 60_000;
  }

  check(key: string): Decision {
    const { perMinute } = this.config;
    const t = this.now();
    if (this.buckets.size > PRUNE_AT) this.prune(t);

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
 * egress addresses) present a shared secret instead of being limited per address. No key
 * configured means no bypass.
 */
export function hasServerKey(presented: string | undefined, expected: string | undefined): boolean {
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
