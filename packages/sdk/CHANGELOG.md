# Changelog

## 0.6.0

Hardening: the SDK no longer passes a server's answer through as-is. **Breaking** (pre-1.0) where noted.

- **Addresses are checked for their chain** (Ethereum `0x`+40 hex, Solana 32-byte base58, Bitcoin mainnet bech32/bech32m with checksum or legacy P2PKH/P2SH). One bad address fails the whole response with `INVALID_RESPONSE`.
- **The answer must be for the requested username**, or it's `INVALID_RESPONSE`.
- **`resolveViaIndexer` checks each address against the bytes of its record**, and the shape of `owner`, `node`, `epoch` and every record.
- **Results are fresh, deep-frozen objects** with known fields only: unknown chains and fields are dropped. **Breaking:** code that mutates a result throws in strict mode; copy first. The response types are now `readonly`.
- `ResolveResponse` now types `verified`, `displayName`, `bio` and `avatarUrl`, which the API already returned.
- **Breaking:** `resolveViaIndexer` is **no longer cached by default**, so a transfer shows up on the next call. Opt in with the new `indexerCache` option. `OnchainResolveResponse` no longer extends all of `ResolveResponse`, only its `username` and `addresses`.
- New `timeoutMs` option (default 10 s, `0` disables) and `TIMEOUT` error code. Works with a custom `fetch` that ignores `AbortSignal`, and on Node 18.
- **Breaking:** `baseUrl` and `indexerUrl` must be https (http only on localhost), or the constructor throws `CONFIG_ERROR`.
- **Breaking:** only a 404 whose body has `code: 'USER_NOT_FOUND'` maps to `USER_NOT_FOUND`; a bare 404 (wrong URL, proxy page) is `HTTP_ERROR` with `status: 404`.
- `available()` refuses `.` and `..`, which would change the request path. Unknown `reason` values and suggestions that aren't valid usernames are dropped.
- `resolveAddress()` returns `null` for a chain that isn't supported, instead of reading inherited properties like `toString`.
- Server error messages are clipped to 200 characters.

## 0.5.0

- `ResolveResponse` gains optional `onchain: { status }` (`linked` · `not_linked` · `none` · `syncing` · `unavailable`): whether the on-chain name of the same spelling belongs to the Paytag account. Absent from `resolveViaIndexer` results.
- `available` can return `reason: 'TAKEN_ONCHAIN'` (free off-chain, registered on-chain by another wallet), and takes `{ wallet }` so a name the caller owns on-chain isn't reported as taken.
- **Type change:** `UnavailableReason` gains `'TAKEN_ONCHAIN'`. Code with an exhaustive `switch` or a `Record<UnavailableReason, …>` over it needs a case for the new value.

## 0.4.0

Matches contracts v0.2 on Base Sepolia. **Breaking** (pre-1.0).

- `OnchainRecord.stale` is removed. A transfer now starts a new epoch on-chain and every earlier record stops resolving, so a record set by a previous owner can no longer exist. Code that checked `record.stale` can drop the check.
- `OnchainResolveResponse` gains `epoch` (transfers to a different owner so far) and `recordsReset` (the name changed owner and the current owner hasn't set a record since). That distinguishes "unconfigured after a transfer" from "never had records".

## 0.3.1

- **Username normalization is ASCII-only**, matching the Paytag API and the on-chain registry. Surrounding whitespace is trimmed only if it's ASCII, and only `A–Z` are lowercased. Previously `String#trim` and `String#toLowerCase` were used, which accepted input both of those layers reject: Unicode spaces were stripped, and the Kelvin sign (U+212A) was folded into `k`. Such input now throws `INVALID_USERNAME` before any request is made. Plain names, `@name` and uppercase names behave as before.

## 0.3.0

- `resolveViaIndexer()`: resolve names from the on-chain Paytag registry on Base through the Paytag indexer.
