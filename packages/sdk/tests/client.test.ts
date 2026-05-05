import {
  Paytag,
  PaytagError,
  FetchLike,
  ResolveResponse,
  AvailabilityResponse,
  DEFAULT_BASE_URL,
  resolve,
  resolveAddress,
  available,
  __resetDefaultClient,
} from '../src';

const baseUrl = 'https://api.paytag.test';

const mockResponse = (
  ok: boolean,
  status: number,
  body: unknown,
): Awaited<ReturnType<FetchLike>> => ({
  ok,
  status,
  json: async () => body,
});

const okPayload = (overrides?: Partial<ResolveResponse>): ResolveResponse => ({
  username: 'derrick',
  addresses: { ethereum: '0xabc', solana: '4Nd1', bitcoin: 'bc1q' },
  ...overrides,
});

const okAvailability = (
  overrides?: Partial<AvailabilityResponse>,
): AvailabilityResponse => ({
  available: true,
  suggestions: [],
  ...overrides,
});

describe('Paytag — construction', () => {
  it('uses the default base URL when none is provided', async () => {
    const fetchMock = jest.fn(async () => mockResponse(true, 200, okPayload()));
    const client = new Paytag({ fetch: fetchMock });
    await client.resolve('derrick');
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_BASE_URL}/resolve/derrick`,
      expect.any(Object),
    );
  });

  it('accepts an empty options object', async () => {
    expect(() => new Paytag()).not.toThrow();
    expect(() => new Paytag({})).not.toThrow();
  });

  it('strips trailing slashes from baseUrl', async () => {
    const fetchMock = jest.fn(async () => mockResponse(true, 200, okPayload()));
    const client = new Paytag({ baseUrl: `${baseUrl}///`, fetch: fetchMock });
    await client.resolve('derrick');
    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/resolve/derrick`,
      expect.any(Object),
    );
  });

  it('throws CONFIG_ERROR if no fetch is available and globalThis.fetch is missing', () => {
    const g = globalThis as { fetch?: unknown };
    const original = g.fetch;
    delete g.fetch;
    try {
      expect(() => new Paytag({ baseUrl })).toThrow(PaytagError);
    } finally {
      g.fetch = original;
    }
  });
});

describe('Paytag.resolve — happy path', () => {
  it('resolves a username and returns the parsed body', async () => {
    const fetchMock = jest.fn(async () => mockResponse(true, 200, okPayload()));
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    const result = await client.resolve('derrick');

    expect(result.username).toBe('derrick');
    expect(result.addresses.ethereum).toBe('0xabc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/resolve/derrick`,
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/json' }),
      }),
    );
  });

  it('strips a leading @ and lowercases the username', async () => {
    const fetchMock = jest.fn(async () => mockResponse(true, 200, okPayload()));
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await client.resolve('@DerRick');

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/resolve/derrick`,
      expect.any(Object),
    );
  });
});

describe('Paytag.resolve — caching', () => {
  it('caches resolved values within TTL', async () => {
    const fetchMock = jest.fn(async () => mockResponse(true, 200, okPayload()));
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await client.resolve('derrick');
    await client.resolve('derrick');
    await client.resolve('@DERRICK'); // normalizes to same key

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips the cache when { fresh: true }', async () => {
    const fetchMock = jest.fn(async () => mockResponse(true, 200, okPayload()));
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await client.resolve('derrick');
    await client.resolve('derrick', { fresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache when constructed with cache: false', async () => {
    const fetchMock = jest.fn(async () => mockResponse(true, 200, okPayload()));
    const client = new Paytag({ baseUrl, fetch: fetchMock, cache: false });

    await client.resolve('derrick');
    await client.resolve('derrick');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('respects a numeric TTL passed via cache option', async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest.fn(async () => mockResponse(true, 200, okPayload()));
      const client = new Paytag({ baseUrl, fetch: fetchMock, cache: 1_000 });

      await client.resolve('derrick');
      jest.advanceTimersByTime(500);
      await client.resolve('derrick');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1_000);
      await client.resolve('derrick');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('invalidate() drops a cached entry', async () => {
    const fetchMock = jest.fn(async () => mockResponse(true, 200, okPayload()));
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await client.resolve('derrick');
    client.invalidate('derrick');
    await client.resolve('derrick');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidate() with no argument clears all', async () => {
    const fetchMock = jest.fn(async () => mockResponse(true, 200, okPayload()));
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await client.resolve('derrick');
    await client.resolve('alice');
    client.invalidate();
    await client.resolve('derrick');
    await client.resolve('alice');

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('Paytag.resolve — errors', () => {
  it('throws PaytagError USER_NOT_FOUND on 404', async () => {
    const fetchMock = jest.fn(async () =>
      mockResponse(false, 404, { error: 'Username not found', code: 'USER_NOT_FOUND' }),
    );
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await expect(client.resolve('nobody')).rejects.toMatchObject({
      name: 'PaytagError',
      code: 'USER_NOT_FOUND',
      status: 404,
    });
  });

  it('throws HTTP_ERROR on 500', async () => {
    const fetchMock = jest.fn(async () =>
      mockResponse(false, 500, { error: 'boom', code: 'INTERNAL_ERROR' }),
    );
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await expect(client.resolve('derrick')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 500,
    });
  });

  it('throws NETWORK_ERROR if fetch rejects', async () => {
    const fetchMock = jest.fn(async () => {
      throw new Error('connection refused');
    });
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await expect(client.resolve('derrick')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('rethrows AbortError without wrapping', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const fetchMock = jest.fn(async () => {
      throw abortErr;
    });
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await expect(client.resolve('derrick')).rejects.toBe(abortErr);
  });

  it('throws INVALID_USERNAME on bad input', async () => {
    const fetchMock = jest.fn();
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await expect(client.resolve('a')).rejects.toMatchObject({
      code: 'INVALID_USERNAME',
    });
    await expect(client.resolve('Bad-Name!')).rejects.toMatchObject({
      code: 'INVALID_USERNAME',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws INVALID_RESPONSE on malformed body', async () => {
    const fetchMock = jest.fn(async () => mockResponse(true, 200, { foo: 'bar' }));
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await expect(client.resolve('derrick')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});

describe('Paytag.resolveAddress', () => {
  it('returns the address for a chain', async () => {
    const fetchMock = jest.fn(async () => mockResponse(true, 200, okPayload()));
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await expect(client.resolveAddress('derrick', 'ethereum')).resolves.toBe('0xabc');
  });

  it('returns null when the chain is missing', async () => {
    const fetchMock = jest.fn(async () =>
      mockResponse(true, 200, okPayload({ addresses: { ethereum: '0xabc' } })),
    );
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await expect(client.resolveAddress('derrick', 'solana')).resolves.toBeNull();
  });

  it('propagates USER_NOT_FOUND', async () => {
    const fetchMock = jest.fn(async () =>
      mockResponse(false, 404, { error: 'no', code: 'USER_NOT_FOUND' }),
    );
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await expect(client.resolveAddress('nobody', 'ethereum')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });
});

describe('Paytag.available', () => {
  it('returns the parsed availability response', async () => {
    const fetchMock = jest.fn(async () =>
      mockResponse(true, 200, okAvailability({ available: true })),
    );
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    const result = await client.available('newname');

    expect(result.available).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/available/newname`,
      expect.any(Object),
    );
  });

  it('does not validate locally — short usernames hit the API', async () => {
    const fetchMock = jest.fn(async () =>
      mockResponse(true, 200, {
        available: false,
        reason: 'INVALID_FORMAT',
        suggestions: [],
      }),
    );
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    const result = await client.available('a');

    expect(fetchMock).toHaveBeenCalled();
    expect(result.available).toBe(false);
    expect(result.reason).toBe('INVALID_FORMAT');
  });

  it('strips leading @ and lowercases', async () => {
    const fetchMock = jest.fn(async () =>
      mockResponse(true, 200, okAvailability()),
    );
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await client.available('@DerRick');

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/available/derrick`,
      expect.any(Object),
    );
  });

  it('throws INVALID_USERNAME on empty input', async () => {
    const fetchMock = jest.fn();
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await expect(client.available('   ')).rejects.toMatchObject({
      code: 'INVALID_USERNAME',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws INVALID_RESPONSE on malformed body', async () => {
    const fetchMock = jest.fn(async () => mockResponse(true, 200, { foo: 'bar' }));
    const client = new Paytag({ baseUrl, fetch: fetchMock });

    await expect(client.available('derrick')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});

describe('top-level helpers', () => {
  beforeEach(() => {
    __resetDefaultClient();
  });

  it('resolve() uses the default singleton client + base URL', async () => {
    const fetchMock = jest.fn(async () => mockResponse(true, 200, okPayload()));
    const g = globalThis as { fetch?: unknown };
    const original = g.fetch;
    g.fetch = fetchMock;
    try {
      const result = await resolve('derrick');
      expect(result.username).toBe('derrick');
      expect(fetchMock).toHaveBeenCalledWith(
        `${DEFAULT_BASE_URL}/resolve/derrick`,
        expect.any(Object),
      );
    } finally {
      g.fetch = original;
    }
  });

  it('resolveAddress() and available() reuse the same singleton', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(mockResponse(true, 200, okPayload()))
      .mockResolvedValueOnce(mockResponse(true, 200, okAvailability()));
    const g = globalThis as { fetch?: unknown };
    const original = g.fetch;
    g.fetch = fetchMock;
    try {
      await expect(resolveAddress('derrick', 'ethereum')).resolves.toBe('0xabc');
      await expect(available('derrick')).resolves.toMatchObject({ available: true });
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        `${DEFAULT_BASE_URL}/resolve/derrick`,
        expect.any(Object),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${DEFAULT_BASE_URL}/available/derrick`,
        expect.any(Object),
      );
    } finally {
      g.fetch = original;
    }
  });
});
