import { isIPv4, isIPv6 } from 'node:net';
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
 * The bucket key for a client address. IPv6 clients are keyed on their /64: one subscriber or
 * cloud host usually holds a whole /64 and can rotate through it, so a per-address key would
 * give them an endless supply of fresh buckets. IPv4-mapped IPv6 counts as the IPv4 address.
 */
export function clientKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  if (!isIPv6(ip)) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('%')[0].split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * Express middleware limiting each client IP. Fly's proxy sets Fly-Client-IP to the connecting
 * client; the API is only reachable through it, which must replace any value a client sends
 * (checked after deploy with a spoofed header). Without it (local dev) the socket address is
 * used. A refusal is a 429 in the API's `{ error, code }` shape with Retry-After.
 */
export const rateLimit = (limiter: RateLimiter): RequestHandler => (req, res, next) => {
  const key = clientKey(req.header('fly-client-ip') ?? req.socket.remoteAddress ?? 'unknown');
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
