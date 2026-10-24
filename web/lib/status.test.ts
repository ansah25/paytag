import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiHealth, getStatus, onchainHealth, worst } from './status';

describe('apiHealth', () => {
  it('is ok only when /ping answers and the database is up', () => {
    expect(apiHealth({ status: 200, database: true, syncedBlock: 1 })).toMatchObject({ health: 'ok' });
    expect(apiHealth({ status: 503, database: false, syncedBlock: null })).toMatchObject({ health: 'degraded', reason: 'Database unavailable' });
    expect(apiHealth({ status: null, database: null, syncedBlock: null })).toMatchObject({ health: 'down' });
    expect(apiHealth({ status: 403, database: null, syncedBlock: null })).toMatchObject({ health: 'down', reason: 'Answering 403' });
  });
});

describe('onchainHealth', () => {
  it('maps the lookup status', () => {
    expect(onchainHealth(200)).toMatchObject({ health: 'ok' });
    expect(onchainHealth(503)).toMatchObject({ health: 'degraded', reason: 'Base RPC unavailable' });
    expect(onchainHealth(429)).toMatchObject({ health: 'degraded' });
    expect(onchainHealth(null)).toMatchObject({ health: 'down' });
  });
});

describe('worst', () => {
  it('picks the most severe', () => {
    expect(worst()).toBe('ok');
    expect(worst('ok', 'degraded')).toBe('degraded');
    expect(worst('degraded', 'down', 'ok')).toBe('down');
  });
});

describe('getStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  const route = (handlers: Record<string, () => Promise<Response>>) =>
    vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      const hit = Object.entries(handlers).find(([part]) => url.includes(part));
      return hit ? hit[1]() : Promise.reject(new TypeError('fetch failed'));
    });

  it('reports everything up when every probe answers', async () => {
    vi.stubGlobal(
      'fetch',
      route({
        '/ping': () => json({ status: 'ok', database: 'ok', onchainSyncedBlock: 90 }),
        '/onchain/resolve/': () => json({ username: 'derrick' }),
        'sepolia.base.org': () => json({ jsonrpc: '2.0', id: 1, result: '0x64' }),
        'registry.npmjs.org': () => json({ version: '0.7.0' }),
      }),
    );
    const s = await getStatus();
    expect(s).toMatchObject({ overall: 'ok', api: { health: 'ok' }, sdkVersion: '0.7.0' });
    expect(s.onchain).toMatchObject({ health: 'ok', syncedBlock: 90, headBlock: 100 });
  });

  it('presents the server key on the lookup', async () => {
    vi.stubEnv('API_SERVER_KEY', 'k'.repeat(32));
    const fetchMock = route({ '/onchain/resolve/': () => json({}) });
    vi.stubGlobal('fetch', fetchMock);
    await getStatus();
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/onchain/resolve/'));
    expect((call?.[1] as RequestInit).headers).toEqual({ 'x-paytag-server-key': 'k'.repeat(32) });
  });

  it('still renders when every probe fails', async () => {
    vi.stubGlobal('fetch', route({}));
    const s = await getStatus();
    expect(s).toMatchObject({ overall: 'down', api: { health: 'down', latencyMs: null }, sdkVersion: null });
    expect(s.onchain).toMatchObject({ health: 'down', syncedBlock: null, headBlock: null });
  });

  it('a database outage or RPC outage degrades, not crashes', async () => {
    vi.stubGlobal(
      'fetch',
      route({
        '/ping': () => json({ status: 'degraded', database: 'unavailable', onchainSyncedBlock: null }, 503),
        '/onchain/resolve/': () => json({ code: 'ONCHAIN_UNAVAILABLE' }, 503),
        'sepolia.base.org': () => json({ error: { message: 'rate limited' } }),
        'registry.npmjs.org': () => json({}),
      }),
    );
    const s = await getStatus();
    expect(s.api).toMatchObject({ health: 'degraded', reason: 'Database unavailable' });
    expect(s.onchain).toMatchObject({ health: 'degraded', headBlock: null });
    expect(s.overall).toBe('degraded');
  });
});
