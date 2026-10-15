# Changelog

## 0.3.1

- **Username normalization is ASCII-only**, matching the Paytag API and the on-chain registry. Surrounding whitespace is trimmed only if it's ASCII, and only `A–Z` are lowercased. Previously `String#trim` and `String#toLowerCase` were used, which accepted input both of those layers reject: Unicode spaces were stripped, and the Kelvin sign (U+212A) was folded into `k`. Such input now throws `INVALID_USERNAME` before any request is made. Plain names, `@name` and uppercase names behave as before.

## 0.3.0

- `resolveViaIndexer()`: resolve names from the on-chain Paytag registry on Base through the Paytag indexer.
