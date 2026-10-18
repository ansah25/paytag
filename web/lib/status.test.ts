import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_LAG_BLOCKS, getStatus, indexerHealth, worst } from './status';

const synced = (block: number) => ({ block, timestamp: 0 });
const up = { responded: true } as const;

describe('indexerHealth', () => {
  it('is down when /status does not answer', () => {
    expect(indexerHealth({ responded: false, synced: null, ready: null }, 100)).toMatchObject({ health: 'down', lagBlocks: null });
  });

  it('is degraded while historical sync runs', () => {
    expect(indexerHealth({ ...up, synced: synced(90), ready: false }, 100)).toMatchObject({ health: 'degraded', lagBlocks: 10 });
  });

  it('is degraded when too far behind the head, ok within the limit', () => {
    expect(indexerHealth({ ...up, synced: synced(100), ready: true }, 100 + MAX_LAG_BLOCKS + 1).health).toBe('degraded');
    expect(indexerHealth({ ...up, synced: synced(100), ready: true }, 100 + MAX_LAG_BLOCKS)).toMatchObject({ health: 'ok' });
    expect(indexerHealth({ ...up, synced: synced(100), ready: true }, 100)).toMatchObject({ health: 'ok', reason: 'At the chain head' });
  });

  it('is degraded when it answers without a block yet, or readiness is unknown', () => {
    expect(indexerHealth({ ...up, synced: null, ready: false }, 100)).toMatchObject({ health: 'degraded', reason: 'Starting up' });
    expect(indexerHealth({ ...up, synced: synced(100), ready: null }, 100)).toMatchObject({ health: 'degraded' });
  });

  it('stays ok without a chain head, and never reports negative lag', () => {
    expect(indexerHealth({ ...up, synced: synced(100), ready: true }, null)).toMatchObject({ health: 'ok', lagBlocks: null });
    expect(indexerHealth({ ...up, synced: synced(105), ready: true }, 100)).toMatchObject({ health: 'ok', lagBlocks: 0 });
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
  afterEach(() => vi.unstubAllGlobals());

  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  const route = (handlers: Record<string, () => Promise<Response>>) =>
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const hit = Object.entries(handlers).find(([part]) => url.includes(part));
      return hit ? hit[1]() : Promise.reject(new TypeError('fetch failed'));
    });

  it('reports everything up when every probe answers', async () => {
    vi.stubGlobal(
      'fetch',
      route({
        '/ping': () => json({ status: 'ok' }),
        '/status': () => json({ baseSepolia: { id: 84532, block: { number: 100, timestamp: 1 } } }),
        '/ready': () => json({}),
        'sepolia.base.org': () => json({ jsonrpc: '2.0', id: 1, result: '0x64' }),
        'registry.npmjs.org': () => json({ version: '0.3.0' }),
      }),
    );
    const s = await getStatus();
    expect(s).toMatchObject({ overall: 'ok', api: { health: 'ok' }, sdkVersion: '0.3.0' });
    expect(s.indexer).toMatchObject({ health: 'ok', syncedBlock: 100, headBlock: 100, lagBlocks: 0 });
  });

  it('still renders when every probe fails', async () => {
    vi.stubGlobal('fetch', route({}));
    const s = await getStatus();
    expect(s).toMatchObject({ overall: 'down', api: { health: 'down', latencyMs: null }, sdkVersion: null });
    expect(s.indexer).toMatchObject({ health: 'down', syncedBlock: null, headBlock: null });
  });

  it('treats a broken API body or a failed RPC as down / unknown, not a crash', async () => {
    vi.stubGlobal(
      'fetch',
      route({
        '/health': () => Promise.resolve(new Response('<html>502</html>', { status: 502 })),
        '/status': () => json({ baseSepolia: { id: 84532, block: { number: 100, timestamp: 1 } } }),
        '/ready': () => json({}, 503),
        'sepolia.base.org': () => json({ error: { message: 'rate limited' } }),
        'registry.npmjs.org': () => json({}),
      }),
    );
    const s = await getStatus();
    expect(s.api.health).toBe('down');
    expect(s.indexer).toMatchObject({ health: 'degraded', reason: 'Catching up on history', headBlock: null });
    expect(s.overall).toBe('down');
  });
});
