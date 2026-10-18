import { RequestHandler } from 'express';

// Per-client token buckets, in memory (the same scheme as the indexer's limiter). The counter is
// per machine: the real ceiling is the configured rate × however many Fly machines are running.
// Accurate today with one; with more, divide the setting or move the counter to a shared store.

export interface Decision {
  allowed: boolean;
  limit: number;
  /** Whole requests left after this one. */
  remaining: number;
  /** Seconds until one more request is allowed (0 when allowed). */
  retryAfter: number;
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
    /** Requests allowed per minute; also the burst size. */
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {
    this.ratePerMs = perMinute / 60_000;
  }

  check(key: string): Decision {
    const t = this.now();
    if (this.buckets.size > PRUNE_AT && t - this.lastPrune >= PRUNE_EVERY_MS) {
      this.lastPrune = t;
      for (const [k, b] of this.buckets) {
        if (b.tokens + (t - b.updated) * this.ratePerMs >= this.perMinute) this.buckets.delete(k);
      }
    }

    const bucket = this.buckets.get(key) ?? { tokens: this.perMinute, updated: t };
    bucket.tokens = Math.min(this.perMinute, bucket.tokens + (t - bucket.updated) * this.ratePerMs);
    bucket.updated = t;

    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.buckets.set(key, bucket);

    return {
      allowed,
      limit: this.perMinute,
      remaining: Math.floor(bucket.tokens),
      retryAfter: allowed ? 0 : Math.ceil((1 - bucket.tokens) / this.ratePerMs / 1000),
    };
  }
}

/**
 * Express middleware limiting each client IP. Fly's proxy sets Fly-Client-IP to the connecting
 * client, replacing any value the client sent; without it (local dev) the socket address is
 * used. A refusal is a 429 in the API's `{ error, code }` shape with Retry-After.
 */
export const rateLimit = (limiter: RateLimiter): RequestHandler => (req, res, next) => {
  const key = req.header('fly-client-ip') ?? req.socket.remoteAddress ?? 'unknown';
  const d = limiter.check(key);
  res.setHeader('RateLimit-Limit', String(d.limit));
  res.setHeader('RateLimit-Remaining', String(d.remaining));
  if (d.allowed) {
    next();
    return;
  }
  res.setHeader('Retry-After', String(d.retryAfter));
  res.status(429).json({ error: 'Too many requests; slow down and retry shortly', code: 'RATE_LIMITED' });
};
