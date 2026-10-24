import './setup';
import request from 'supertest';

// The next Supabase result every query returns (set per test).
let mockResult: { data: unknown; error: unknown; status?: number } = { data: null, error: null };

jest.mock('../src/config/supabase', () => {
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'in', 'limit', 'order', 'update', 'upsert', 'insert', 'delete']) {
    builder[m] = () => builder;
  }
  builder.maybeSingle = () => Promise.resolve(mockResult);
  builder.single = () => Promise.resolve(mockResult);
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(mockResult).then(resolve);
  return { supabase: { from: () => builder, rpc: () => Promise.resolve(mockResult) } };
});

import { createApp } from '../src/app';
import { DatabaseUnavailableError, dbError, isDatabaseUnavailable } from '../src/utils/dbErrors';

describe('isDatabaseUnavailable', () => {
  it.each([
    ['a failed fetch (no code)', { message: 'TypeError: fetch failed', code: '' }],
    ['no code at all', { message: 'Service Unavailable' }],
    ['PostgREST: cannot connect', { code: 'PGRST000', message: 'Could not connect with the database' }],
    ['PostgREST: pool timeout', { code: 'PGRST003', message: 'Timed out acquiring connection' }],
    ['Postgres: connection failure', { code: '08006', message: 'connection failure' }],
    ['Postgres: too many connections', { code: '53300', message: 'too many connections' }],
    ['Postgres: shutting down', { code: '57P01', message: 'terminating connection due to administrator command' }],
    ['Postgres: idle session timeout', { code: '57P05', message: 'terminating connection due to idle-session timeout' }],
  ])('%s → unavailable', (_label, error) => {
    expect(isDatabaseUnavailable(error)).toBe(true);
  });

  it.each([
    ['no response (fetch failed)', 0, true],
    ['gateway 503 HTML page', 503, true],
    ['Cloudflare 520', 520, true],
    ['paused project 540', 540, true],
    ['Kong: invalid API key', 401, false],
    ['Kong: no route matched', 404, false],
  ])('codeless error, %s (HTTP %i) → unavailable: %s', (_label, status, expected) => {
    expect(isDatabaseUnavailable({ message: 'gateway said no' }, status)).toBe(expected);
  });

  it.each([
    ['unique violation', { code: '23505', message: 'duplicate key value' }],
    ['check violation', { code: '23514', message: 'violates check constraint' }],
    ['undefined table', { code: '42P01', message: 'relation does not exist' }],
    ['PostgREST: wrong row count', { code: 'PGRST116', message: 'JSON object requested, multiple rows returned' }],
    ['PostgREST: bad request', { code: 'PGRST100', message: 'parse error' }],
    ['Postgres: a query hit a resource limit', { code: '53400', message: 'temporary file size exceeds temp_file_limit' }],
    ['Postgres: statement timeout', { code: '57014', message: 'canceling statement due to statement timeout' }],
  ])('%s → a real error', (_label, error) => {
    expect(isDatabaseUnavailable(error)).toBe(false);
  });

  it('redacts a long unbroken body quickly (the patterns are quadratic on such runs)', () => {
    const blob = 'a.'.repeat(50_000) + 'host.supabase.co';
    const started = Date.now();
    dbError('read', { code: '42P01', message: blob });
    dbError('read', { message: blob }, 503);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('a gateway rate limit (429) is retryable', () => {
    expect(isDatabaseUnavailable({ message: 'API rate limit exceeded' }, 429)).toBe(true);
  });

  it('never puts a URL or the project host in a message', () => {
    const html = 'host abcd1234.supabase.co is paused; see https://supabase.com/dashboard/project/abcd1234';
    expect(dbError('read', { code: '42P01', message: html }).message).not.toMatch(/supabase\.co|https:/);
  });

  it('dbError returns a 503 for unavailable and a plain Error otherwise', () => {
    expect(dbError('read', { message: 'fetch failed' })).toBeInstanceOf(DatabaseUnavailableError);
    const real = dbError('read', { code: '23505', message: 'duplicate key value' });
    expect(real).not.toBeInstanceOf(DatabaseUnavailableError);
    expect(real.message).toBe('Failed to read: duplicate key value');
  });
});

describe('GET /resolve/:username when the database fails', () => {
  const app = createApp();

  it('is a 503 DATABASE_UNAVAILABLE when the database can’t be reached', async () => {
    mockResult = { data: null, error: { message: 'TypeError: fetch failed', code: '' }, status: 0 };
    const res = await request(app).get('/resolve/derrick');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'The database is unavailable right now; retry shortly', code: 'DATABASE_UNAVAILABLE' });
  });

  it('is a 503 for PostgREST’s own connection errors', async () => {
    mockResult = { data: null, error: { code: 'PGRST001', message: 'Could not connect due to invalid secret' } };
    expect((await request(app).get('/resolve/derrick')).status).toBe(503);
  });

  it('stays a 500 when the gateway refuses the key (a deployment error, not an outage)', async () => {
    mockResult = { data: null, error: { message: 'Invalid API key' }, status: 401 };
    expect((await request(app).get('/resolve/derrick')).status).toBe(500);
  });

  it('stays a 500 for an error the database itself returned', async () => {
    mockResult = { data: null, error: { code: '42P01', message: 'relation "users" does not exist' } };
    const res = await request(app).get('/resolve/derrick');
    expect(res.status).toBe(500);
    expect(res.body.code).not.toBe('DATABASE_UNAVAILABLE');
  });

  it('/available is a 503 too', async () => {
    mockResult = { data: null, error: { message: 'TypeError: fetch failed' } };
    expect((await request(app).get('/available/derrick')).status).toBe(503);
  });
});

describe('the on-chain sync cursor', () => {
  it('a missing sync-state row names the migration (not an outage)', async () => {
    const { syncedBlock } = await import('../src/services/onchainEventsService');
    mockResult = { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, status: 406 };
    await expect(syncedBlock()).rejects.toThrow('run migration 0008');
  });
});
