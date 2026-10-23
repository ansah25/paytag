import { Paytag, PaytagError, ChainId, FetchLike } from '../src';
import { isValidAddress, recordValueFor } from '../src/addresses';
import { BTC, ETH, SOL, mockResponse } from './fixtures';

// What the SDK refuses to pass on from a server, and how it bounds a request.

const baseUrl = 'https://api.paytag.test';
const indexerUrl = 'https://indexer.paytag.test';

const respondWith = (body: unknown, status = 200) =>
  jest.fn(async () => mockResponse(status >= 200 && status < 300, status, body));

const resolveBody = (overrides: Record<string, unknown> = {}) => ({
  username: 'derrick',
  addresses: { ethereum: ETH, solana: SOL, bitcoin: BTC },
  ...overrides,
});

const SOL_VALUE = '0x321cfa5add185e8893a5fd88013ec4d7e122ded46354cadff50d956395e75b60';
const BTC_VALUE = '0x0014e8df018c7e326cc253faac7e46cdc51e68542c42';
const ETH_CHECKSUMMED = '0x6aD631F215393f9635231de985081B1ccDDC7C11';

const onchainBody = (overrides: Record<string, unknown> = {}) => ({
  username: 'derrick',
  node: '0x2209a34bc4a111dcc71330ec4d9d1b6e134efb0c184da8e95f7da20375fa46ae',
  owner: ETH_CHECKSUMMED,
  registeredAt: 1792007394,
  epoch: 1,
  recordsReset: false,
  addresses: { ethereum: ETH_CHECKSUMMED, solana: SOL, bitcoin: BTC },
  records: [
    { coinType: '0', value: BTC_VALUE, address: BTC },
    { coinType: '60', value: ETH, address: ETH_CHECKSUMMED },
    { coinType: '501', value: SOL_VALUE, address: SOL },
    // ENSIP-11 Base Sepolia: kept, but not one of the `addresses` chains.
    { coinType: '2147568180', value: ETH, address: ETH_CHECKSUMMED },
  ],
  source: 'onchain',
  ...overrides,
});

const rejectsWith = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(PaytagError);
  await expect(p).rejects.toMatchObject({ code });
};

describe('service URLs', () => {
  const fetch = respondWith(resolveBody());

  it.each([
    'http://api.paytag.dev',
    'http://localhost.evil.com',
    'ftp://api.paytag.dev',
    'not a url',
    'javascript:alert(1)',
  ])('refuses %s with CONFIG_ERROR', (url) => {
    expect(() => new Paytag({ baseUrl: url, fetch })).toThrow(
      expect.objectContaining({ code: 'CONFIG_ERROR' }),
    );
    expect(() => new Paytag({ indexerUrl: url, fetch })).toThrow(
      expect.objectContaining({ code: 'CONFIG_ERROR' }),
    );
  });

  it.each(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'https://x.test'])(
    'accepts %s',
    (url) => {
      expect(() => new Paytag({ baseUrl: url, indexerUrl: url, fetch })).not.toThrow();
    },
  );

  it('strips a long run of trailing slashes quickly', async () => {
    const fetchMock = respondWith(resolveBody());
    const started = Date.now();
    const client = new Paytag({ baseUrl: `${baseUrl}${'/'.repeat(100_000)}`, fetch: fetchMock });
    expect(Date.now() - started).toBeLessThan(500);
    await client.resolve('derrick');
    expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/resolve/derrick`, expect.any(Object));
  });
});

describe('resolve: response checks', () => {
  it('refuses an answer for a different username', async () => {
    const client = new Paytag({ baseUrl, fetch: respondWith(resolveBody({ username: 'mallory' })) });
    await rejectsWith(client.resolve('derrick'), 'INVALID_RESPONSE');
  });

  it.each<[ChainId, unknown]>([
    ['ethereum', '0xabc'],
    ['ethereum', `${ETH}00`],
    ['ethereum', ETH.slice(2)],
    ['ethereum', 42],
    ['solana', '0OIl111111111111111111111111111111'],
    ['solana', 'So1111111111111111111111111111111111111111'], // 31 bytes
    ['bitcoin', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdr'], // bad checksum
    ['bitcoin', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'], // testnet
    ['bitcoin', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd'], // v1 in bech32
    ['bitcoin', '2A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'], // not version 0x00/0x05
    ['bitcoin', 'x'.repeat(1_000_000)],
  ])('fails the whole response on a bad %s address (%p)', async (chain, address) => {
    const body = resolveBody();
    (body.addresses as Record<string, unknown>)[chain] = address;
    const client = new Paytag({ baseUrl, fetch: respondWith(body) });
    await rejectsWith(client.resolve('derrick'), 'INVALID_RESPONSE');
  });

  it('accepts every supported Bitcoin address type', () => {
    for (const address of [
      BTC,
      'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
      'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
      'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297',
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
    ]) {
      expect(isValidAddress('bitcoin', address)).toBe(true);
    }
  });

  it('keeps only known chains and fields, in a fresh object', async () => {
    const body = JSON.parse(
      JSON.stringify({
        ...resolveBody({
          verified: { ethereum: true, solana: 'yes', dogecoin: true },
          displayName: 'Derrick',
          bio: null,
          avatarUrl: 42,
          onchain: { status: 'linked', extra: 1 },
          injected: '<script>',
        }),
      }).replace('"addresses":{', '"addresses":{"dogecoin":"D123","__proto__":{"x":1},'),
    );
    const client = new Paytag({ baseUrl, fetch: respondWith(body) });
    const result = await client.resolve('derrick');

    expect(result).toEqual({
      username: 'derrick',
      addresses: { ethereum: ETH, solana: SOL, bitcoin: BTC },
      verified: { ethereum: true },
      displayName: 'Derrick',
      bio: null,
      onchain: { status: 'linked' },
    });
    expect(result).not.toBe(body);
    expect(Object.getPrototypeOf(result.addresses)).toBe(Object.prototype);
  });

  it.each<[unknown, unknown]>([
    ['https://cdn.paytag.dev/a.png', 'https://cdn.paytag.dev/a.png'],
    [null, null],
    ['javascript:alert(1)', undefined],
    ['http://cdn.paytag.dev/a.png', undefined],
    ['data:image/png;base64,AAAA', undefined],
    ['not a url', undefined],
  ])('keeps avatarUrl %p as %p', async (avatarUrl, expected) => {
    const result = await new Paytag({ baseUrl, fetch: respondWith(resolveBody({ avatarUrl })) }).resolve(
      'derrick',
    );
    expect(result.avatarUrl).toBe(expected);
    expect('avatarUrl' in result).toBe(expected !== undefined);
  });

  it('drops verified for a chain with no address, and an unknown on-chain status', async () => {
    const body = resolveBody({
      addresses: { ethereum: ETH },
      verified: { ethereum: true, solana: true },
      onchain: { status: 'definitely_linked' },
    });
    const result = await new Paytag({ baseUrl, fetch: respondWith(body) }).resolve('derrick');
    expect(result.verified).toEqual({ ethereum: true });
    expect(result.onchain).toBeUndefined();
  });

  it('returns a deep-frozen result, also from the cache', async () => {
    const client = new Paytag({ baseUrl, fetch: respondWith(resolveBody({ verified: {} })) });
    const first = await client.resolve('derrick');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.addresses)).toBe(true);
    expect(Object.isFrozen(first.verified)).toBe(true);
    expect(() => {
      (first.addresses as Record<string, string>).ethereum = '0xattacker';
    }).toThrow(TypeError);
    await expect(client.resolve('derrick')).resolves.toBe(first);
  });

  it('resolveAddress looks up own chains only', async () => {
    const client = new Paytag({ baseUrl, fetch: respondWith(resolveBody()) });
    for (const chain of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) {
      await expect(client.resolveAddress('derrick', chain as ChainId)).resolves.toBeNull();
    }
  });
});

describe('errors', () => {
  it('a bare 404 is HTTP_ERROR, not USER_NOT_FOUND', async () => {
    const client = new Paytag({ baseUrl, fetch: respondWith('<html>Not Found</html>', 404) });
    await expect(client.resolve('derrick')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 404,
    });
  });

  it('USER_NOT_FOUND on another status is HTTP_ERROR', async () => {
    const client = new Paytag({
      baseUrl,
      fetch: respondWith({ error: 'x', code: 'USER_NOT_FOUND' }, 500),
    });
    await rejectsWith(client.resolve('derrick'), 'HTTP_ERROR');
  });

  it('clips server error text', async () => {
    const client = new Paytag({ baseUrl, fetch: respondWith({ error: 'A'.repeat(10_000) }, 500) });
    const err = await client.resolve('derrick').catch((e: PaytagError) => e);
    expect((err as PaytagError).message.length).toBeLessThanOrEqual(201);
  });
});

describe('timeouts and aborts', () => {
  const hang = () => new Promise<never>(() => {});

  it.each([-1, Number.NaN, Infinity, 2 ** 31, '100'])('refuses timeoutMs %p', (timeoutMs) => {
    expect(
      () => new Paytag({ timeoutMs: timeoutMs as number, fetch: respondWith(resolveBody()) }),
    ).toThrow(expect.objectContaining({ code: 'CONFIG_ERROR' }));
  });

  it('times out a fetch that never answers, even one ignoring the signal', async () => {
    const fetchMock: FetchLike = jest.fn(hang);
    const client = new Paytag({ baseUrl, timeoutMs: 20, fetch: fetchMock });
    await rejectsWith(client.resolve('derrick'), 'TIMEOUT');
  });

  it('aborts the fetch signal on timeout', async () => {
    let seen: AbortSignal | undefined;
    const client = new Paytag({
      baseUrl,
      timeoutMs: 20,
      fetch: async (_url, init) => {
        seen = init?.signal;
        return hang();
      },
    });
    await rejectsWith(client.resolve('derrick'), 'TIMEOUT');
    expect(seen?.aborted).toBe(true);
  });

  it('times out a body that never finishes', async () => {
    const client = new Paytag({
      baseUrl,
      timeoutMs: 20,
      fetch: async () => ({ ok: true, status: 200, json: hang }),
    });
    await rejectsWith(client.resolve('derrick'), 'TIMEOUT');
  });

  // Browsers (WHATWG fetch) reject inside abort(), before the timeout's own rejection.
  const abortError = () => Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
  const specFetch =
    (stage: 'headers' | 'body'): FetchLike =>
    (_url, init) =>
      new Promise((resolve, reject) => {
        const fail = () => reject(abortError());
        if (stage === 'headers') {
          init?.signal?.addEventListener('abort', fail);
          return;
        }
        resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_, rejectBody) =>
              init?.signal?.addEventListener('abort', () => rejectBody(abortError())),
            ),
        });
      });

  it.each(['headers', 'body'] as const)(
    'reports TIMEOUT when a spec fetch rejects on abort (waiting for %s)',
    async (stage) => {
      const client = new Paytag({ baseUrl, timeoutMs: 20, fetch: specFetch(stage) });
      await rejectsWith(client.resolve('derrick'), 'TIMEOUT');
    },
  );

  it('refuses redirects', async () => {
    const fetchMock = respondWith(resolveBody());
    await new Paytag({ baseUrl, fetch: fetchMock }).resolve('derrick');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('timeoutMs: 0 disables the timeout', async () => {
    jest.useFakeTimers();
    try {
      const client = new Paytag({ baseUrl, timeoutMs: 0, fetch: respondWith(resolveBody()) });
      await expect(client.resolve('derrick')).resolves.toMatchObject({ username: 'derrick' });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears its timer after a response', async () => {
    jest.useFakeTimers();
    try {
      const client = new Paytag({ baseUrl, fetch: respondWith(resolveBody()) });
      await client.resolve('derrick');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("passes the caller's abort through to fetch", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const client = new Paytag({
      baseUrl,
      fetch: (_url, init) =>
        new Promise((_, reject) => {
          seen = init?.signal;
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    });
    const pending = client.resolve('derrick', { signal: controller.signal });
    await Promise.resolve();
    expect(seen?.aborted).toBe(false);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen?.aborted).toBe(true);
  });

  it('an already-aborted signal aborts the fetch', async () => {
    const controller = new AbortController();
    controller.abort();
    let seen: AbortSignal | undefined;
    const client = new Paytag({
      baseUrl,
      fetch: async (_url, init) => {
        seen = init?.signal;
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      },
    });
    await expect(client.resolve('derrick', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(seen?.aborted).toBe(true);
  });
});

describe('resolveViaIndexer: response checks', () => {
  const resolveWith = (body: unknown) =>
    new Paytag({ indexerUrl, fetch: respondWith(body) }).resolveViaIndexer('derrick');

  it('accepts a consistent response with every chain and keeps other coin types', async () => {
    const result = await resolveWith(onchainBody());
    expect(result.addresses).toEqual({ ethereum: ETH_CHECKSUMMED, solana: SOL, bitcoin: BTC });
    expect(result.records).toHaveLength(4);
    expect(Object.isFrozen(result.records)).toBe(true);
    expect(Object.isFrozen(result.records[0])).toBe(true);
  });

  it('the record bytes it checks against match the indexer encoding', () => {
    expect(recordValueFor('solana', SOL)).toBe(SOL_VALUE);
    expect(recordValueFor('bitcoin', BTC)).toBe(BTC_VALUE);
    expect(recordValueFor('ethereum', ETH_CHECKSUMMED)).toBe(ETH);
    expect(recordValueFor('bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(
      '0x76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac',
    );
    expect(recordValueFor('bitcoin', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(
      '0xa914b472a266d0bd89c13706a4132ccfb16f7c3b9fcb87',
    );
    expect(
      recordValueFor('bitcoin', 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'),
    ).toBe('0x5120a37c3903c8d0db6512e2b40b0dffa05e5a3ab73603ce8c9c4b7771e5412328f9');
  });

  it('accepts a name with no records', async () => {
    const result = await resolveWith(
      onchainBody({ addresses: {}, records: [], recordsReset: true }),
    );
    expect(result.addresses).toEqual({});
  });

  it('accepts an undecodable record with no address', async () => {
    const result = await resolveWith(
      onchainBody({
        addresses: {},
        records: [{ coinType: '0', value: '0xdeadbeef', address: null }],
      }),
    );
    expect(result.records[0]?.address).toBeNull();
  });

  const tampered: [string, Record<string, unknown>][] = [
    ['an address differing from its record', { addresses: { ethereum: ETH_CHECKSUMMED, solana: SOL, bitcoin: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' } }],
    ['an address with no record', { records: [] }],
    ['a decodable record missing from addresses', { addresses: { ethereum: ETH_CHECKSUMMED } }],
    [
      'record bytes that are not the address',
      {
        records: [
          { coinType: '0', value: BTC_VALUE, address: BTC },
          { coinType: '60', value: `0x${'11'.repeat(20)}`, address: ETH_CHECKSUMMED },
          { coinType: '501', value: SOL_VALUE, address: SOL },
        ],
      },
    ],
    [
      'duplicate records for a chain',
      {
        addresses: { ethereum: ETH_CHECKSUMMED },
        records: [
          { coinType: '60', value: ETH, address: ETH_CHECKSUMMED },
          { coinType: '60', value: ETH, address: ETH_CHECKSUMMED },
        ],
      },
    ],
    ['an address for a record with null address', { addresses: { ethereum: ETH_CHECKSUMMED }, records: [{ coinType: '60', value: '0x12', address: null }] }],
    ['a malformed owner', { owner: '0x123' }],
    ['a malformed node', { node: '0x2209' }],
    ['a negative epoch', { epoch: -1 }],
    ['a fractional registeredAt', { registeredAt: 1.5 }],
    ['a non-boolean recordsReset', { recordsReset: 'false' }],
    ['a record with a non-hex value', { records: [{ coinType: '5', value: 'zz', address: null }], addresses: {} }],
    ['a record with a non-decimal coin type', { records: [{ coinType: '0x3c', value: '0x', address: null }], addresses: {} }],
    ['a different username', { username: 'mallory' }],
    ['source other than onchain', { source: 'api' }],
  ];
  it.each(tampered)('fails on %s', async (_label, overrides) => {
    await rejectsWith(resolveWith(onchainBody(overrides)), 'INVALID_RESPONSE');
  });
});

describe('available: input and response checks', () => {
  it.each(['.', '..', ' . ', '', '@'])('refuses %p without a request', async (name) => {
    const fetchMock = jest.fn();
    const client = new Paytag({ baseUrl, fetch: fetchMock });
    await rejectsWith(client.available(name), 'INVALID_USERNAME');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops an unknown reason and suggestions that are not usernames', async () => {
    const client = new Paytag({
      baseUrl,
      fetch: respondWith({
        available: false,
        reason: 'BANNED',
        suggestions: ['derrick_1', '<img src=x>', 42, 'ab', 'derrick_pay'],
        extra: true,
      }),
    });
    const result = await client.available('derrick');
    expect(result).toEqual({ available: false, suggestions: ['derrick_1', 'derrick_pay'] });
    expect(Object.isFrozen(result.suggestions)).toBe(true);
  });
});
