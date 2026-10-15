// Fails the build if a client component ever imports this (it reads a server secret).
import 'server-only';
import { INDEXER_URL } from './indexer';

/**
 * Indexer fetch for server components only. Server-rendered pages all reach the indexer from
 * Vercel's shared addresses, so they present INDEXER_SERVER_KEY (no NEXT_PUBLIC_ prefix: never
 * bundled for the browser) to skip the per-address rate limit. Without the key it's a plain fetch.
 */
export function indexerServerFetch(path: string): Promise<Response> {
  const key = process.env.INDEXER_SERVER_KEY;
  return fetch(`${INDEXER_URL}${path}`, {
    cache: 'no-store',
    headers: key ? { 'x-paytag-server-key': key } : undefined,
    signal: AbortSignal.timeout(8_000),
  });
}
