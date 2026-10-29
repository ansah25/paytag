import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

// Database policy for the whole API, applied here so every query inherits it:
//  - each request is aborted after SUPABASE_TIMEOUT_MS, so a database that accepts connections and
//    never answers fails fast (status 0, no code: dbError() makes that a 503) instead of hanging;
//  - no automatic retries. postgrest-js retries GETs on network errors and 503/520 with 1s/2s/4s
//    backoff, which held a request ~7s before it failed. Clients retry a 503 themselves.
// Only this client gets the timeout: other outbound requests (the on-chain RPC reads) keep their own.

/** `fetchImpl` with every request aborted after `ms`, on top of any signal the caller passes. */
export const withTimeout =
  (fetchImpl: typeof fetch, ms: number): typeof fetch =>
  (input, init) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetchImpl(input, { ...init, signal });
  };

/** The subset of the Supabase client the API uses, with the retry policy applied. */
export type Db = Pick<SupabaseClient, 'from' | 'rpc'>;

/** Wraps `client` so its queries never retry. Every builder a query builder makes inherits `retry`. */
export const withoutRetries = (client: SupabaseClient): Db => ({
  from: ((relation: string) => {
    const query = client.from(relation);
    query.retry = false;
    return query;
  }) as SupabaseClient['from'],
  rpc: ((fn: string, args?: Record<string, unknown>, options?: Parameters<SupabaseClient['rpc']>[2]) =>
    client.rpc(fn, args, options).retry(false)) as SupabaseClient['rpc'],
});

export const createDb = (url: string, key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Db =>
  withoutRetries(
    createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: { fetch: withTimeout(fetchImpl, timeoutMs) },
    }),
  );

export const supabase: Db = createDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_TIMEOUT_MS);
