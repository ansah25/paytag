import './setup';
import { TtlCache } from '../src/utils/cache';

describe('TtlCache', () => {
  it('returns set values within TTL', () => {
    const c = new TtlCache<string>(1000);
    c.set('k', 'v');
    expect(c.get('k')).toBe('v');
  });

  it('expires values after TTL', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const c = new TtlCache<string>(1000);
    c.set('k', 'v');
    jest.advanceTimersByTime(1500);
    expect(c.get('k')).toBeNull();
    jest.useRealTimers();
  });

  it('invalidates a single key', () => {
    const c = new TtlCache<string>(60_000);
    c.set('a', '1');
    c.set('b', '2');
    c.invalidate('a');
    expect(c.get('a')).toBeNull();
    expect(c.get('b')).toBe('2');
  });
});
