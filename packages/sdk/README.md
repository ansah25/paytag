# @paytagdev/sdk

Resolve `@paytag` usernames to multi-chain wallet addresses (Ethereum, Solana, Bitcoin) from any JavaScript or TypeScript app.

## Install

```bash
npm install @paytagdev/sdk
```

Requires Node.js ≥ 18 (or any modern browser). Zero runtime dependencies.

## Quick start

```ts
import { resolve } from '@paytagdev/sdk';

const user = await resolve('derrick');
// {
//   username: 'derrick',
//   addresses: {
//     ethereum: '0x4f3edf83...',
//     solana:   '4Nd1mYz7K8jM...',
//     bitcoin:  'bc1qw508d6q...'
//   }
// }
```

No setup, no API key. The top-level `resolve` helper points at the public Paytag API at `https://api.paytag.dev` and caches results for 30 seconds in-process.

## Top-level helpers

```ts
import { resolve, resolveAddress, resolveViaIndexer, available } from '@paytagdev/sdk';

await resolve('derrick');                       // → ResolveResponse
await resolveAddress('derrick', 'ethereum');    // → '0x4f3edf…' | null
await resolveViaIndexer('derrick');             // → OnchainResolveResponse (Base registry)
await available('newname');                     // → AvailabilityResponse
```

All of them accept the same username forms — `'derrick'`, `'@derrick'`, `'DERRICK'` — and normalize to lowercase with the leading `@` stripped.

## Custom client

For self-hosted APIs, custom caching, or dependency-injected fetch (testing, polyfills), instantiate `Paytag` directly:

```ts
import { Paytag } from '@paytagdev/sdk';

const client = new Paytag({
  baseUrl: 'https://my-paytag.example.com', // optional
  cache: 60_000,                             // optional: TTL in ms, false to disable
  fetch: customFetch,                        // optional
});

await client.resolve('derrick');
```

| Option | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `https://api.paytag.dev` | API origin |
| `indexerUrl` | `string` | `https://indexer.paytag.dev` | On-chain indexer origin, used by `resolveViaIndexer` |
| `cache` | `boolean \| number \| Cache` | `true` (30 s TTL) | `false` disables, a `number` sets the TTL in ms, or pass a custom `Cache` |
| `fetch` | `FetchLike` | `globalThis.fetch` | Inject a custom fetch (e.g. for testing or a Node ≤17 polyfill) |

## API

### `resolve(username, opts?)` → `Promise<ResolveResponse>`

Look up a username and return its registered addresses.

```ts
type ResolveResponse = {
  username: string;
  addresses: Partial<Record<'ethereum' | 'solana' | 'bitcoin', string>>;
};

type ResolveOptions = {
  signal?: AbortSignal; // cancel the request
  fresh?: boolean;      // skip the cache for this call
};
```

### `resolveAddress(username, chain, opts?)` → `Promise<string | null>`

Convenience wrapper: returns the address for one chain, or `null` if the user has no address registered there.

```ts
const eth = await resolveAddress('derrick', 'ethereum');
if (eth) { /* … */ }
```

### `resolveViaIndexer(username, opts?)` → `Promise<OnchainResolveResponse>`

Resolve a name from **on-chain state**, the Paytag registry on Base, via the Paytag indexer. The result extends `ResolveResponse`, so code that reads `addresses` works unchanged:

```ts
type OnchainResolveResponse = ResolveResponse & {
  node: string;          // keccak256 of the normalized name
  owner: string;         // current on-chain owner (checksummed)
  registeredAt: number;  // unix seconds
  records: {
    coinType: string;    // ENSIP-9 coin type: '60' ETH, '0' BTC, '501' SOL, …
    value: string;       // raw record bytes (hex)
    address: string | null;
    stale: boolean;      // set by a previous owner; excluded from `addresses`
  }[];
  source: 'onchain';
};
```

- **Stale records:** a record written before the name's latest transfer was set by a previous owner. It appears in `records` with `stale: true` but never in `addresses`, so payment code can't pay a former owner by accident.
- **No fallback:** if the indexer is unreachable this throws `NETWORK_ERROR` rather than silently asking the API, so you always know which source answered.
- **Syncing:** while a freshly deployed indexer backfills, it answers 503 and this throws `HTTP_ERROR` with `status: 503`, never a false `USER_NOT_FOUND`.
- **Caching:** results share the client's cache but use a separate key namespace from `resolve`, and `invalidate(name)` clears both.

### `available(username, opts?)` → `Promise<AvailabilityResponse>`

Check whether a username is free to claim. Unlike `resolve`, this does **not** validate the input locally — invalid formats come back as `reason: 'INVALID_FORMAT'` so you can render targeted UI feedback.

```ts
type AvailabilityResponse = {
  available: boolean;
  reason?: 'TAKEN' | 'INVALID_FORMAT' | 'RESERVED';
  suggestions: string[];
};

const { available, reason, suggestions } = await available('derrick');
```

### `client.invalidate(username?)`

Drop a single cached entry, or — with no argument — clear the entire cache. Only available on `Paytag` instances; the top-level helpers' singleton manages its own cache.

## Errors

All thrown errors are instances of `PaytagError` with a typed `code`:

| `code` | Meaning |
|---|---|
| `USER_NOT_FOUND` | The username is not registered |
| `INVALID_USERNAME` | Argument failed format validation (3–20 chars, `[a-z0-9_]` for `resolve` and `resolveViaIndexer`; non-empty for `available`) |
| `NETWORK_ERROR` | The fetch itself failed (DNS, TLS, connection refused, …) |
| `HTTP_ERROR` | The API responded with a non-2xx status other than 404 |
| `INVALID_RESPONSE` | The API responded 2xx but the body was not in the expected shape |
| `CONFIG_ERROR` | Bad SDK configuration (no fetch impl available, …) |

```ts
import { resolve, PaytagError } from '@paytagdev/sdk';

try {
  await resolve('nobody');
} catch (err) {
  if (err instanceof PaytagError && err.code === 'USER_NOT_FOUND') {
    // show "Claim this name" UI
  } else {
    throw err;
  }
}
```

`AbortError` from a passed `AbortSignal` is rethrown unchanged so it can be detected the same way as native fetch.

## Caching

By default the SDK keeps a per-instance in-memory cache with a 30 s TTL — matching the API's `Cache-Control` header. The cache key is the normalized username, so `'derrick'`, `'@derrick'`, and `'DERRICK'` share an entry.

```ts
new Paytag({ cache: false });    // no cache
new Paytag({ cache: 60_000 });   // 60 s TTL
new Paytag({ cache: customImpl }); // bring your own
```

A custom cache must satisfy:

```ts
interface Cache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
  clear(): void;
}
```

`available()` results are not cached — availability is volatile (a name can be claimed at any moment) and consumers usually want fresh data while typing.

## License

MIT
