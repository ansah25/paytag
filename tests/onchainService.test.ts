import './setup';

process.env.INDEXER_URL = 'https://indexer.test/';
process.env.INDEXER_SERVER_KEY = 'fly-key';

import {
  CircuitBreaker,
  REGISTER_TIMEOUT_MS,
  getOnchainOwner,
  linkStatus,
  resetOnchainBreaker,
} from '../src/services/onchainService';

const OWNER = '0x6aD631F215393f9635231de985081B1ccDDC7C11';
// The service fetches through undici (for its keep-alive agent); mock that fetch.
const mockFetch = jest.fn();
jest.mock('undici', () => ({
  ...jest.requireActual('undici'),
  fetch: (...args: unknown[]) => mockFetch(...args),
}));
const fetchMock = mockFetch;

const reply = (status: number, body: unknown = {}) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const lookup = () => getOnchainOwner('alice', { timeoutMs: REGISTER_TIMEOUT_MS });

beforeEach(() => {
  fetchMock.mockReset();
  resetOnchainBreaker();
});

describe('getOnchainOwner', () => {
  it('returns the lowercased owner and sends this API its own key', async () => {
    reply(200, { username: 'alice', owner: OWNER });
    expect(await lookup()).toEqual({ kind: 'owner', owner: OWNER.toLowerCase() });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://indexer.test/resolve/alice');
    expect(init.headers).toEqual({ 'x-paytag-server-key': 'fly-key' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.dispatcher).toBeDefined(); // the keep-alive agent
  });

  it("maps the indexer's own 404 to none and 503 to syncing", async () => {
    reply(404, { error: 'not registered', code: 'USER_NOT_FOUND' });
    expect(await lookup()).toEqual({ kind: 'none' });
    reply(503, { error: 'syncing', code: 'NOT_READY' });
    expect(await lookup()).toEqual({ kind: 'syncing' });
  });

  it("doesn't trust a 404 or 503 from something else (proxy, wrong path)", async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>404 page not found</html>', { status: 404 }));
    expect(await lookup()).toEqual({ kind: 'unavailable' });
    fetchMock.mockResolvedValueOnce(new Response('no available server', { status: 503 }));
    expect(await lookup()).toEqual({ kind: 'unavailable' });
    reply(404, { code: 'NOT_FOUND' });
    expect(await lookup()).toEqual({ kind: 'unavailable' });
  });

  it('reports unavailable, never throws, on errors, timeouts, 5xx, 429 and bad bodies', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await lookup()).toEqual({ kind: 'unavailable' });
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    expect(await lookup()).toEqual({ kind: 'unavailable' });
    reply(500);
    expect(await lookup()).toEqual({ kind: 'unavailable' });
    reply(429, { code: 'RATE_LIMITED' });
    expect(await lookup()).toEqual({ kind: 'unavailable' });
    reply(200, { owner: 42 });
    expect(await lookup()).toEqual({ kind: 'unavailable' });
  });

  it('stops calling a failing indexer once the breaker opens', async () => {
    for (let i = 0; i < 5; i++) {
      reply(500);
      await lookup();
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(await lookup()).toEqual({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(5); // open: no request
  });

  it('lets a lookup without the breaker through while it is open, and never trips it', async () => {
    const read = () => getOnchainOwner('alice', { timeoutMs: 300 });
    const register = () => getOnchainOwner('alice', { timeoutMs: REGISTER_TIMEOUT_MS, useBreaker: false });
    // Timeouts count double: three open a breaker with a threshold of five.
    for (let i = 0; i < 3; i++) {
      fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
      await read();
    }
    expect(await read()).toEqual({ kind: 'unavailable' }); // open
    expect(fetchMock).toHaveBeenCalledTimes(3);

    reply(200, { owner: OWNER });
    expect(await register()).toEqual({ kind: 'owner', owner: OWNER.toLowerCase() });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // ...and its failures don't count either.
    resetOnchainBreaker();
    for (let i = 0; i < 6; i++) {
      reply(500);
      await register();
    }
    reply(200, { owner: OWNER });
    expect(await read()).toEqual({ kind: 'owner', owner: OWNER.toLowerCase() });
  });

  it("doesn't count syncing toward the breaker", async () => {
    for (let i = 0; i < 8; i++) {
      reply(503, { code: 'NOT_READY' });
      expect(await lookup()).toEqual({ kind: 'syncing' });
    }
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });
});

describe('CircuitBreaker', () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it('opens after the threshold, lets one probe through after the cool-off, closes on success', () => {
    const c = clock();
    const b = new CircuitBreaker(3, 1_000, c.now);
    for (let i = 0; i < 3; i++) {
      expect(b.allow()).toBe(true);
      b.failure();
    }
    expect(b.allow()).toBe(false);
    c.advance(1_000);
    expect(b.allow()).toBe(true); // the probe
    expect(b.allow()).toBe(false); // only one at a time
    b.success();
    expect(b.allow()).toBe(true);
    expect(b.allow()).toBe(true);
  });

  it('reopens when the probe fails', () => {
    const c = clock();
    const b = new CircuitBreaker(1, 1_000, c.now);
    b.failure();
    c.advance(1_000);
    expect(b.allow()).toBe(true);
    b.failure();
    expect(b.allow()).toBe(false);
    c.advance(999);
    expect(b.allow()).toBe(false);
    c.advance(1);
    expect(b.allow()).toBe(true);
  });

  it('frees the probe slot when the outcome says nothing about health', () => {
    const c = clock();
    const b = new CircuitBreaker(1, 1_000, c.now);
    b.failure();
    c.advance(1_000);
    expect(b.allow()).toBe(true);
    b.release();
    expect(b.allow()).toBe(true);
  });

  it('resets the failure count on success', () => {
    const b = new CircuitBreaker(2, 1_000, () => 0);
    b.failure();
    b.success();
    b.failure();
    expect(b.allow()).toBe(true);
  });
});

describe('linkStatus', () => {
  const owner = { kind: 'owner' as const, owner: OWNER.toLowerCase() };

  it('is linked only when the on-chain owner is the verified ETH address', () => {
    expect(linkStatus(owner, OWNER)).toBe('linked');
    expect(linkStatus(owner, '0x0000000000000000000000000000000000000001')).toBe('not_linked');
    expect(linkStatus(owner, undefined)).toBe('not_linked');
  });

  it('passes the other lookups through', () => {
    expect(linkStatus({ kind: 'none' }, OWNER)).toBe('none');
    expect(linkStatus({ kind: 'syncing' }, OWNER)).toBe('syncing');
    expect(linkStatus({ kind: 'unavailable' }, OWNER)).toBe('unavailable');
  });
});

describe('without INDEXER_URL', () => {
  it('reports unavailable without a request', async () => {
    let fresh!: typeof import('../src/services/onchainService');
    const saved = process.env.INDEXER_URL;
    delete process.env.INDEXER_URL;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      fresh = require('../src/services/onchainService');
    });
    process.env.INDEXER_URL = saved;
    expect(await fresh.getOnchainOwner('alice', { timeoutMs: 300 })).toEqual({ kind: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getOnchainOwner — connection resets', () => {
  const reset = (code = 'ECONNRESET') => Object.assign(new TypeError('fetch failed'), { cause: { code } });

  it('retries once on a reset and reports only the final outcome', async () => {
    fetchMock.mockRejectedValueOnce(reset());
    reply(200, { owner: OWNER });
    expect(await lookup()).toEqual({ kind: 'owner', owner: OWNER.toLowerCase() });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The reset didn't count: four more failures still leave the breaker closed.
    for (let i = 0; i < 4; i++) {
      reply(500);
      await lookup();
    }
    reply(200, { owner: OWNER });
    expect(await lookup()).toEqual({ kind: 'owner', owner: OWNER.toLowerCase() });
  });

  it('retries only once', async () => {
    fetchMock.mockRejectedValueOnce(reset('UND_ERR_SOCKET'));
    fetchMock.mockRejectedValueOnce(reset());
    expect(await lookup()).toEqual({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("doesn't retry other errors", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
    expect(await lookup()).toEqual({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('CircuitBreaker — weighted failures', () => {
  it('opens sooner on timeouts, which count double', () => {
    const b = new CircuitBreaker(5, 1_000, () => 0);
    b.failure(2);
    b.failure(2);
    expect(b.allow()).toBe(true);
    b.failure(2);
    expect(b.allow()).toBe(false);
  });
});

describe('getOnchainOwner — the budget', () => {
  type Init = { signal: AbortSignal };
  const afterAbort = (init: Init, err: () => unknown) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(err())));
  const timeoutErr = () => new DOMException('timed out', 'TimeoutError');
  const resetErr = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  const quick = () => getOnchainOwner('alice', { timeoutMs: 20 });

  it('counts a body that stalls after the headers as a timeout (weight 2)', async () => {
    for (let i = 0; i < 3; i++) {
      fetchMock.mockImplementationOnce(async (_url: string, init: Init) => ({
        status: 200,
        ok: true,
        json: () => afterAbort(init, timeoutErr),
      }));
      expect(await quick()).toEqual({ kind: 'unavailable' });
    }
    expect(await quick()).toEqual({ kind: 'unavailable' }); // open after three
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("doesn't retry a reset that arrives after the budget ran out", async () => {
    fetchMock.mockImplementationOnce((_url: string, init: Init) => afterAbort(init, resetErr));
    expect(await quick()).toEqual({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('counts a reset followed by a timed-out retry as a timeout', async () => {
    for (let i = 0; i < 3; i++) {
      fetchMock.mockRejectedValueOnce(resetErr());
      fetchMock.mockImplementationOnce((_url: string, init: Init) => afterAbort(init, timeoutErr));
      expect(await quick()).toEqual({ kind: 'unavailable' });
    }
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(await quick()).toEqual({ kind: 'unavailable' }); // open after three
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
