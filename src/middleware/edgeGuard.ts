import { timingSafeEqual } from 'node:crypto';
import { RequestHandler } from 'express';

// api.paytag.dev is proxied by Cloudflare, but the Fly origin (paytag-api.fly.dev) is reachable
// directly too. A Cloudflare Transform Rule adds `x-paytag-edge: <EDGE_SECRET>` to every request
// it forwards, so the origin can tell the two apart without tracking Cloudflare's IP ranges:
// - with the header, the request came through Cloudflare, and CF-Connecting-IP (set by
//   Cloudflare, not the client) is the visitor;
// - without it, the request bypassed Cloudflare and is refused.
// /health stays open: Fly's health checks reach the machine directly, without the header.

export const EDGE_HEADER = 'x-paytag-edge';
const OPEN_PATHS = new Set(['/health']);

export function hasEdgeSecret(presented: string | undefined, secret: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** No secret configured (local dev, tests): every request passes. */
export const edgeGuard = (secret: string | undefined): RequestHandler => (req, res, next) => {
  if (!secret || OPEN_PATHS.has(req.path) || hasEdgeSecret(req.header(EDGE_HEADER), secret)) {
    next();
    return;
  }
  res.status(403).json({ error: 'Use https://api.paytag.dev', code: 'DIRECT_ACCESS' });
};
