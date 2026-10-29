import './setup';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { createDb } from '../src/config/supabase';
import { DatabaseUnavailableError, dbError } from '../src/utils/dbErrors';
import { logger } from '../src/utils/logger';

// The real supabase-js client against a local PostgREST stand-in. Each behaviour has a control
// with the stock client, so a supabase-js upgrade that changes the retry rules or the timeout
// plumbing fails here instead of quietly bringing back the ~7s backoff.

type Mode = 'ok' | 'hang' | 'hang-body' | 'schema-cache' | 'reset';

let mode: Mode = 'ok';
let attempts = 0;
let url = '';
const server = http.createServer((req, res) => {
  attempts++;
  req.resume();
  switch (mode) {
    case 'ok':
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 'u1' }]));
      return;
    case 'hang':
      return; // never answers
    case 'hang-body':
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('[{"id":'); // headers sent, body never finished
      return;
    case 'schema-cache':
      // Retry-After: 0, so the stock client's retries cost no time and the control stays fast.
      res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '0' });
      res.end(JSON.stringify({ code: 'PGRST002', message: 'Could not query the database for the schema cache' }));
      return;
    case 'reset':
      req.socket.destroy();
      return;
  }
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  mode = 'ok';
  attempts = 0;
});

const TIMEOUT_MS = 300;
const db = () => createDb(url, 'key', TIMEOUT_MS);
const stock = () => createClient(url, 'key', { auth: { autoRefreshToken: false, persistSession: false } });

const timed = async <T>(run: () => PromiseLike<T>): Promise<{ result: T; ms: number }> => {
  const start = Date.now();
  const result = await run();
  return { result, ms: Date.now() - start };
};

describe('API Supabase client', () => {
  it('returns rows normally', async () => {
    const { data, error } = await db().from('users').select('id');
    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'u1' }]);
  });

  it('aborts a request that gets no response, once, as a 503', async () => {
    mode = 'hang';
    const { result, ms } = await timed(() => db().from('users').select('id').eq('username', 'x').maybeSingle());
    expect(result.status).toBe(0);
    expect(ms).toBeGreaterThanOrEqual(TIMEOUT_MS - 50);
    expect(ms).toBeLessThan(TIMEOUT_MS + 700); // a retry would add at least 1s
    expect(attempts).toBe(1);
    expect(dbError('look up', result.error!, result.status)).toBeInstanceOf(DatabaseUnavailableError);
  });

  it('aborts a response whose body never finishes', async () => {
    mode = 'hang-body';
    const { result, ms } = await timed(() => db().from('users').select('id'));
    expect(result.status).toBe(0);
    expect(ms).toBeLessThan(TIMEOUT_MS + 700);
    expect(dbError('look up', result.error!, result.status)).toBeInstanceOf(DatabaseUnavailableError);
  });

  it('times out writes and RPCs too', async () => {
    mode = 'hang';
    const insert = await db().from('users').insert({ username: 'x' }).select().single();
    const rpc = await db().rpc('apply_events', { rows: [] });
    for (const result of [insert, rpc]) {
      expect(result.status).toBe(0);
      expect(dbError('write', result.error!, result.status)).toBeInstanceOf(DatabaseUnavailableError);
    }
  });

  it('still honours a shorter signal from the caller', async () => {
    mode = 'hang';
    const { ms } = await timed(() => db().from('users').select('id').abortSignal(AbortSignal.timeout(50)));
    expect(ms).toBeLessThan(TIMEOUT_MS);
  });

  it('does not retry a dropped connection, and keeps the cause for the logs', async () => {
    mode = 'reset';
    const { result, ms } = await timed(() => db().from('users').select('id'));
    expect(attempts).toBe(1);
    expect(ms).toBeLessThan(900);
    expect(result.status).toBe(0);
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    expect(dbError('look up', result.error!, result.status)).toBeInstanceOf(DatabaseUnavailableError);
    // The message is only "fetch failed"; the log carries the socket error as well.
    expect(warn).toHaveBeenCalledWith('db.unavailable', expect.objectContaining({
      reason: 'TypeError: fetch failed',
      cause: expect.stringMatching(/SocketError|ECONNRESET|other side closed/),
    }));
    warn.mockRestore();
  });

  it('does not retry a 503 from PostgREST, and keeps its status and code', async () => {
    mode = 'schema-cache';
    const { status, error } = await db().from('users').select('id');
    expect(attempts).toBe(1);
    expect(status).toBe(503);
    expect(error?.code).toBe('PGRST002');
    expect(dbError('look up', error!, status)).toBeInstanceOf(DatabaseUnavailableError);
  });

  it('does not retry RPCs either', async () => {
    mode = 'schema-cache';
    await db().rpc('get_thing', {}, { get: true });
    expect(attempts).toBe(1);
  });
});

describe('stock supabase-js client (controls)', () => {
  it('retries a GET on a 503', async () => {
    mode = 'schema-cache';
    await stock().from('users').select('id');
    expect(attempts).toBe(4); // 1 + DEFAULT_MAX_RETRIES
  });

  it('retries a GET on a dropped connection, with backoff', async () => {
    mode = 'reset';
    // Cut the 1s/2s/4s backoff short; the first retry comes after 1s.
    await stock().from('users').select('id').abortSignal(AbortSignal.timeout(1_500));
    expect(attempts).toBe(2);
  });

  it('has no timeout of its own', async () => {
    mode = 'hang';
    const { ms } = await timed(() => stock().from('users').select('id').retry(false).abortSignal(AbortSignal.timeout(1_000)));
    expect(ms).toBeGreaterThanOrEqual(950); // only the caller's signal ended it
  });
});
