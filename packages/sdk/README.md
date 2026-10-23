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

All of them accept the same username forms — `'derrick'`, `'@derrick'`, `'DERRICK'` — and normalize them the way the API and the on-chain registry do: surrounding ASCII whitespace trimmed, the leading `@` stripped, ASCII `A–Z` lowercased. Anything non-ASCII (including look-alikes such as the Kelvin sign U+212A, and Unicode spaces) is rejected with `INVALID_USERNAME` rather than folded into a different name.

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
| `cache` | `boolean \| number \| Cache` | `true` (30 s TTL) | Cache for `resolve`: `false` disables, a `number` sets the TTL in ms, or pass a custom `Cache` |
| `indexerCache` | `boolean \| number \| Cache` | `false` | Cache for `resolveViaIndexer`, same values as `cache`. Off so each call sees current on-chain state |
| `timeoutMs` | `number` | `10000` | A request that hasn't fully answered by then fails with `TIMEOUT`; `0` disables |
| `fetch` | `FetchLike` | `globalThis.fetch` | Inject a custom fetch (e.g. for testing or a Node ≤17 polyfill) |

`baseUrl` and `indexerUrl` must be `https`; plain `http` is accepted only for `localhost`, `127.0.0.1` and `[::1]`. Anything else throws `CONFIG_ERROR`.

## What the SDK checks

People pay whatever `resolve` returns, so the SDK doesn't pass a server's answer through as-is:

- **The answer is for the name you asked for.** A response for a different username is refused.
- **Every address is well-formed for its chain.** Ethereum: `0x` + 40 hex. Solana: base58 decoding to a 32-byte key. Bitcoin: a mainnet `bc1…` address with a valid bech32/bech32m checksum, or a legacy `1…`/`3…` address of the right length and version (its SHA-256 checksum is left to the API, as browsers can't compute it synchronously). One bad address fails the whole response with `INVALID_RESPONSE`, since nothing else from that server can be trusted either.
- **On-chain answers match their records.** For `resolveViaIndexer`, each address must be what its record's bytes encode.
- **Only known fields come back**, in a fresh object: unknown chains and fields are dropped, as is a malformed optional field (a bad `verified` map hides badges, never adds one).
- **Results are deep-frozen**, including cached ones, so one caller can't change what another sees. Copy before editing: `{ ...res, addresses: { ...res.addresses } }`.

## API

### `resolve(username, opts?)` → `Promise<ResolveResponse>`

Look up a username and return its registered addresses.

`onchain.status` is `linked` when the on-chain name of the same spelling is owned by the account's verified Ethereum address. The two keep separate records: `addresses` are always the Paytag account's; use `resolveViaIndexer` for the on-chain ones. `syncing` and `unavailable` mean the API couldn't check just then.

```ts
type ResolveResponse = {
  username: string;
  addresses: Partial<Record<'ethereum' | 'solana' | 'bitcoin', string>>;
  verified?: Partial<Record<'ethereum' | 'solana' | 'bitcoin', boolean>>; // proven with a signature
  displayName?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  // Whether the on-chain name of the same spelling belongs to this account.
  onchain?: { status: 'linked' | 'not_linked' | 'none' | 'syncing' | 'unavailable' };
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

Resolve a name from **on-chain state**, the Paytag registry on Base, via the Paytag indexer. The result has the same `username` and `addresses` as `ResolveResponse`, so code that reads `addresses` works unchanged:

```ts
type OnchainResolveResponse = Pick<ResolveResponse, 'username' | 'addresses'> & {
  node: string;          // keccak256 of the normalized name
  owner: string;         // current on-chain owner (checksummed)
  registeredAt: number;  // unix seconds
  epoch: number;         // transfers to a different owner so far
  recordsReset: boolean; // changed owner, and no record set since
  records: {
    coinType: string;    // ENSIP-9 coin type: '60' ETH, '0' BTC, '501' SOL, …
    value: string;       // raw record bytes (hex)
    address: string | null;
  }[];
  source: 'onchain';
};
```

- **Transfers clear records:** a transfer to a different owner starts a new epoch on-chain, and every earlier record stops resolving. So every record here was set by the owner at the time the indexer answered, and payment code can't pay a former owner. After a transfer, `recordsReset` is `true` until the new owner sets a record, so you can tell "unconfigured after a transfer" from "never configured".
- **No fallback:** if the indexer is unreachable this throws `NETWORK_ERROR` rather than silently asking the API, so you always know which source answered.
- **Syncing:** while a freshly deployed indexer backfills, it answers 503 and this throws `HTTP_ERROR` with `status: 503`, never a false `USER_NOT_FOUND`.
- **Not cached by default:** a cached result could show a previous owner and their records for up to the TTL after a transfer. Opt in with `indexerCache`; `invalidate(name)` clears both caches.

### `available(username, opts?)` → `Promise<AvailabilityResponse>`

Check whether a username is free to claim. Unlike `resolve`, this does **not** validate the input locally — invalid formats come back as `reason: 'INVALID_FORMAT'` so you can render targeted UI feedback.

```ts
type AvailabilityResponse = {
  available: boolean;
  reason?: 'TAKEN' | 'INVALID_FORMAT' | 'RESERVED' | 'TAKEN_ONCHAIN';
  suggestions: string[];
};

type AvailableOptions = {
  signal?: AbortSignal;
  wallet?: string; // the caller's EVM wallet: a name it owns on-chain isn't TAKEN_ONCHAIN
};

const { available, reason, suggestions } = await available('derrick');
```

### `client.invalidate(username?)`

Drop a single username from both caches, or — with no argument — clear them. Only available on `Paytag` instances; the top-level helpers' singleton manages its own cache.

## Errors

All thrown errors are instances of `PaytagError` with a typed `code`:

| `code` | Meaning |
|---|---|
| `USER_NOT_FOUND` | The username is not registered (a 404 whose body says so; a bare 404 is `HTTP_ERROR`) |
| `INVALID_USERNAME` | Argument failed format validation (3–20 chars, `[a-z0-9_]` for `resolve` and `resolveViaIndexer`; non-empty for `available`) |
| `NETWORK_ERROR` | The fetch itself failed (DNS, TLS, connection refused, …) |
| `HTTP_ERROR` | Any other non-2xx response; `status` holds the HTTP status |
| `TIMEOUT` | No full answer within `timeoutMs` |
| `INVALID_RESPONSE` | A 2xx response failed the checks above (shape, username, an address) |
| `CONFIG_ERROR` | Bad SDK configuration (non-https URL, bad `timeoutMs`, no fetch impl, …) |

Error messages from the server are clipped to 200 characters.

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
