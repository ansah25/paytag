# Changelog

## 0.4.0

Matches contracts v0.2 on Base Sepolia. **Breaking** (pre-1.0).

- `OnchainRecord.stale` is removed. A transfer now starts a new epoch on-chain and every earlier record stops resolving, so a record set by a previous owner can no longer exist. Code that checked `record.stale` can drop the check.
- `OnchainResolveResponse` gains `epoch` (transfers to a different owner so far) and `recordsReset` (the name changed owner and the current owner hasn't set a record since). That distinguishes "unconfigured after a transfer" from "never had records".

## 0.3.1

- **Username normalization is ASCII-only**, matching the Paytag API and the on-chain registry. Surrounding whitespace is trimmed only if it's ASCII, and only `A–Z` are lowercased. Previously `String#trim` and `String#toLowerCase` were used, which accepted input both of those layers reject: Unicode spaces were stripped, and the Kelvin sign (U+212A) was folded into `k`. Such input now throws `INVALID_USERNAME` before any request is made. Plain names, `@name` and uppercase names behave as before.

## 0.3.0

- `resolveViaIndexer()`: resolve names from the on-chain Paytag registry on Base through the Paytag indexer.
