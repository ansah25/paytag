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
// Postgres SQLSTATEs for the same: class 08 (connection exception), 53 (insufficient resources,
// e.g. too many connections), and 57P01-57P03 (shutting down / can't connect now).
const PG_UNAVAILABLE = /^(08|53|57P0[1-3])/;

/**
 * Whether an error means the database couldn't be reached. Postgres errors always carry a
 * SQLSTATE and PostgREST errors a PGRST code, so an error with no code never got that far: a
 * failed fetch (DNS, TLS, refused, timed out) or a gateway in front of a paused project.
 */
export function isDatabaseUnavailable(error: DbErrorLike): boolean {
  const code = error.code ?? '';
  return code === '' || POSTGREST_UNAVAILABLE.has(code) || PG_UNAVAILABLE.test(code);
}

/**
 * The error to throw for a Supabase error that has no more specific handling: a 503
 * DatabaseUnavailableError when the database couldn't be reached (logged, since the error
 * handler doesn't log client-facing errors), otherwise a plain Error (a 500).
 */
export function dbError(what: string, error: DbErrorLike): Error {
  if (isDatabaseUnavailable(error)) {
    logger.warn('db.unavailable', { what, code: error.code ?? '', reason: String(error.message ?? '').slice(0, 200) });
    return new DatabaseUnavailableError();
  }
  return new Error(`Failed to ${what}: ${error.message}`);
}
