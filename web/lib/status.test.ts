import { describe, expect, it } from 'vitest';
import { MAX_LAG_BLOCKS, indexerHealth, worst } from './status';

const synced = (block: number) => ({ block, timestamp: 0 });

describe('indexerHealth', () => {
  it('is down when /status does not answer', () => {
    expect(indexerHealth({ synced: null, ready: null }, 100)).toMatchObject({ health: 'down', lagBlocks: null });
  });

  it('is degraded while historical sync runs', () => {
    expect(indexerHealth({ synced: synced(90), ready: false }, 100)).toMatchObject({ health: 'degraded', lagBlocks: 10 });
  });

  it('is degraded when too far behind the head, ok within the limit', () => {
    expect(indexerHealth({ synced: synced(100), ready: true }, 100 + MAX_LAG_BLOCKS + 1).health).toBe('degraded');
    expect(indexerHealth({ synced: synced(100), ready: true }, 100 + MAX_LAG_BLOCKS)).toMatchObject({ health: 'ok' });
    expect(indexerHealth({ synced: synced(100), ready: true }, 100)).toMatchObject({ health: 'ok', reason: 'At the chain head' });
  });

  it('stays ok without a chain head, and never reports negative lag', () => {
    expect(indexerHealth({ synced: synced(100), ready: true }, null)).toMatchObject({ health: 'ok', lagBlocks: null });
    expect(indexerHealth({ synced: synced(105), ready: true }, 100)).toMatchObject({ health: 'ok', lagBlocks: 0 });
  });
});

describe('worst', () => {
  it('picks the most severe', () => {
    expect(worst()).toBe('ok');
    expect(worst('ok', 'degraded')).toBe('degraded');
    expect(worst('degraded', 'down', 'ok')).toBe('down');
  });
});
