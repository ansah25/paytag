import { AppError } from './errors';
import { logger } from './logger';

// Supabase errors, split into "the database couldn't be reached" (a 503 the client can retry)
// and everything else (a 500: a bug or a data problem that retrying won't fix).

/** Postgres couldn't be reached (Supabase paused or down, the pool exhausted). */
export class DatabaseUnavailableError extends AppError {
  constructor() {
    super(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable right now; retry shortly');
    this.name = 'DatabaseUnavailableError';
  }
}

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
}

// PostgREST couldn't reach or use the database: connection failed, pool timeout, schema cache
// not loaded yet. (https://postgrest.org/en/stable/references/errors.html)
const POSTGREST_UNAVAILABLE = new Set(['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003']);
// Postgres SQLSTATEs for the same: class 08 (connection exception), 53300 (too many connections),
// 57P01-57P03 (shutting down / can't connect now) and 57P05 (idle session timeout). Not the rest of
// class 53 (a query hitting a resource limit is the query's fault) nor 57014 (statement timeout).
const PG_UNAVAILABLE = /^(08|53300|57P0[1235])/;

/**
 * Whether an error means the database couldn't be reached. Postgres errors always carry a
 * SQLSTATE and PostgREST errors a PGRST code, so an error with no code never got that far. With
 * no HTTP response (`status` 0: DNS, TLS, refused, timed out, an unparseable body) or a 5xx from
 * the gateway (a paused project, Cloudflare), that's an outage. A codeless 4xx is the gateway
 * refusing the request (Kong: invalid API key, no route): a deployment error, not retryable.
 */
export function isDatabaseUnavailable(error: DbErrorLike, status?: number): boolean {
  const code = error.code ?? '';
  if (POSTGREST_UNAVAILABLE.has(code) || PG_UNAVAILABLE.test(code)) return true;
  if (code !== '') return false;
  // 429: the gateway's rate limit, which retrying does clear.
  return status === undefined || status === 0 || status === 429 || status >= 500;
}

/**
 * Log-safe text: no URLs or hostnames (a gateway's HTML error page names the project). The input
 * is capped first: the patterns are quadratic on long unbroken runs, and an error body can be long.
 */
export const redact = (text: string): string =>
  // When capped, drop the token the cap cut through: a host split at the cut would lose the
  // suffix the pattern recognises it by.
  (text.length > 1000 ? text.slice(0, 1000).replace(/\S*$/, '') : text)
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(supabase\.co|supabase\.in|supabase\.net)\b/gi, '<host>')
    .slice(0, 200);

/**
 * The error to throw for a Supabase error that has no more specific handling (pass the
 * result's `status` as well, so a gateway 4xx isn't mistaken for an outage): a 503
 * DatabaseUnavailableError when the database couldn't be reached (logged, since the error
 * handler doesn't log client-facing errors), otherwise a plain Error (a 500).
 */
export function dbError(what: string, error: DbErrorLike, status?: number): Error {
  if (isDatabaseUnavailable(error, status)) {
    logger.warn('db.unavailable', { what, code: error.code ?? '', status, reason: redact(String(error.message ?? '')) });
    return new DatabaseUnavailableError();
  }
  return new Error(`Failed to ${what}: ${redact(String(error.message ?? ''))}`);
}
