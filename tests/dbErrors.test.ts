import './setup';
import request from 'supertest';

// The next Supabase result every query returns (set per test).
let mockResult: { data: unknown; error: unknown } = { data: null, error: null };

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
  ])('%s → unavailable', (_label, error) => {
    expect(isDatabaseUnavailable(error)).toBe(true);
  });

  it.each([
    ['unique violation', { code: '23505', message: 'duplicate key value' }],
    ['check violation', { code: '23514', message: 'violates check constraint' }],
    ['undefined table', { code: '42P01', message: 'relation does not exist' }],
    ['PostgREST: wrong row count', { code: 'PGRST116', message: 'JSON object requested, multiple rows returned' }],
    ['PostgREST: bad request', { code: 'PGRST100', message: 'parse error' }],
  ])('%s → a real error', (_label, error) => {
    expect(isDatabaseUnavailable(error)).toBe(false);
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
    mockResult = { data: null, error: { message: 'TypeError: fetch failed', code: '' } };
    const res = await request(app).get('/resolve/derrick');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'The database is unavailable right now; retry shortly', code: 'DATABASE_UNAVAILABLE' });
  });

  it('is a 503 for PostgREST’s own connection errors', async () => {
    mockResult = { data: null, error: { code: 'PGRST001', message: 'Could not connect due to invalid secret' } };
    expect((await request(app).get('/resolve/derrick')).status).toBe(503);
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
