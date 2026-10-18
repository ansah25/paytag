import { isIPv4, isIPv6 } from 'node:net';
import { RequestHandler } from 'express';
import { logger } from '../utils/logger';

// Per-client token buckets, in memory (the same scheme as the indexer's limiter). The counter is
// per machine: the real ceiling is the configured rate × however many Fly machines are running.
// Fly runs two, one auto-stopped, so up to 2× while both are up; and a machine that auto-starts
// begins with empty buckets, so a burst that wakes it gets a fresh allowance rather than sharing
// the first machine's count. With more machines, divide the setting or use a shared store.

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
  const addr = ip.split('%')[0]; // drop an IPv6 zone id
  if (isIPv4(addr) || !isIPv6(addr)) return ip;
  const groups = expandIPv6(addr);
  // IPv4-mapped (::ffff:a.b.c.d, in either notation) counts as the IPv4 address.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 address, with `::` and a dotted IPv4 tail expanded. */
function expandIPv6(addr: string): number[] {
  const toGroups = (part: string): number[] =>
    part
      ? part.split(':').flatMap((g) => {
          if (!g.includes('.')) return [parseInt(g, 16)];
          const [a, b, c, d] = g.split('.').map(Number);
          return [(a << 8) | b, (c << 8) | d];
        })
      : [];
  const [head, tail] = addr.split('::');
  const left = toGroups(head);
  if (tail === undefined) return left;
  const right = toGroups(tail);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
}

/**
 * Express middleware limiting each client IP. Behind Cloudflare (`viaEdge`: edgeGuard has
 * already refused anything without the edge secret), the visitor is CF-Connecting-IP, which
 * Cloudflare sets; Fly-Client-IP there is a Cloudflare edge server shared by many visitors.
 * Otherwise Fly's proxy sets Fly-Client-IP to the connecting client, and without it (local dev)
 * the socket address is used. A refusal is a 429 in the API's `{ error, code }` shape with
 * Retry-After.
 */
export const rateLimit =
  (limiter: RateLimiter, opts: { viaEdge?: boolean } = {}): RequestHandler =>
  (req, res, next) => {
    const visitor = opts.viaEdge ? req.header('cf-connecting-ip') : undefined;
    // Cloudflare always sets it on proxied requests; if it's ever missing, everyone on that edge
    // server shares one bucket, so say so.
    if (opts.viaEdge && !visitor) logger.warn('ratelimit.no_cf_connecting_ip', { path: req.path });
    const ip = visitor ?? req.header('fly-client-ip') ?? req.socket.remoteAddress ?? 'unknown';
    const d = limiter.check(clientKey(ip));
    res.setHeader('RateLimit-Limit', String(d.limit));
    res.setHeader('RateLimit-Remaining', String(d.remaining));
    if (d.allowed) {
      next();
      return;
    }
    res.setHeader('Retry-After', String(d.retryAfter));
    res.status(429).json({ error: 'Too many requests; slow down and retry shortly', code: 'RATE_LIMITED' });
  };
