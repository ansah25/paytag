# Paytag

[![CI](https://github.com/ansah25/paytag/actions/workflows/ci.yml/badge.svg)](https://github.com/ansah25/paytag/actions/workflows/ci.yml)

> Username-to-wallet identity layer for multi-chain crypto payments.

Replace `0x4f3edf83…d8a3c2` with `@derrick`. Paytag maps human-readable usernames to wallet addresses across Ethereum, Solana, and Bitcoin.

## Live

- **API:** <https://api.paytag.dev>
- **dApp:** <https://www.paytag.dev>. On-chain names at [`/on-chain`](https://www.paytag.dev/on-chain); live health at [`/status`](https://www.paytag.dev/status)
- **SDK:** [`@paytagdev/sdk`](https://www.npmjs.com/package/@paytagdev/sdk) on npm
- **On-chain indexer:** <https://indexer.paytag.dev>. Try [`/resolve/derrick`](https://indexer.paytag.dev/resolve/derrick) or [`/status`](https://indexer.paytag.dev/status)
- **Contracts (Base Sepolia):** [`PaytagRegistry`](https://sepolia.basescan.org/address/0xc465e47338d38bfe176c185b590ff0b064d15012#code) · [`PaytagResolver`](https://sepolia.basescan.org/address/0xdd088c3885ee68a9e1cdb16610c1689f21d29142#code)

## SDK

```bash
npm install @paytagdev/sdk
```

```ts
import { resolve } from '@paytagdev/sdk';

const user = await resolve('derrick');
// { username: 'derrick', addresses: { ethereum: '0x4f3edf83…', … } }
```

Zero config — the SDK ships with `https://api.paytag.dev` as the default base URL. To read on-chain state instead, use `resolveViaIndexer('derrick')`; it has the same shape plus `owner`, raw `records` and `source: 'onchain'`. See [`packages/sdk/README.md`](packages/sdk/README.md) for `resolveAddress`, `available`, custom clients, and error codes.

## On-chain protocol (Base)

> In progress. The contracts and indexer are live on Base Sepolia; the app integration is next.

```
PaytagRegistry + PaytagResolver (Base) ──events──▶ Ponder indexer ──HTTP──▶ @paytagdev/sdk ──▶ app
```

**Design:** Base is the canonical registry. Solana and Bitcoin addresses live as *records* on the EVM name (keyed by ENSIP-9 / SLIP-44 coin type), not as parallel deployments. One source of truth for ownership; every other chain is resolved through records. Both contracts are immutable and admin-free.

### Contracts

| Contract | Role |
|---|---|
| [`PaytagRegistry`](contracts/src/PaytagRegistry.sol) | Normalization, reserved-name blocklist, registration, ownership, transfer |
| [`PaytagResolver`](contracts/src/PaytagResolver.sol) | Per-chain address records, forward-verified reverse resolution |

Name rules match the API exactly: 3–20 characters, `[a-z0-9_]`, ASCII `A–Z` lowercased, everything else rejected, and the API's reserved usernames (`paytag`, `admin`, `support`, …) blocked forever. A backend test ([`tests/reservedOnChain.test.ts`](tests/reservedOnChain.test.ts)) fails if the two reserved lists drift apart.

### Deployed addresses

Base Sepolia (chain 84532), verified on Basescan and Sourcify. Deployed at block 48118052 from the [`Deploy`](contracts/script/Deploy.s.sol) script; the full record is in [`contracts/broadcast/`](contracts/broadcast/Deploy.s.sol/84532/run-latest.json).

| Contract | Address |
|---|---|
| `PaytagRegistry` | [`0xC465e47338d38bfe176c185b590fF0B064D15012`](https://sepolia.basescan.org/address/0xc465e47338d38bfe176c185b590ff0b064d15012#code) |
| `PaytagResolver` | [`0xdd088C3885EE68A9E1cdb16610C1689f21D29142`](https://sepolia.basescan.org/address/0xdd088c3885ee68a9e1cdb16610c1689f21d29142#code) |

The ABI is frozen at tag `v0.1.0-contracts`. An earlier deployment (`0xf082…8721` / `0xa403…e828`) is superseded: a pre-merge review found that it emitted misleading events for zero-address ETH records and lacked the reserved-name blocklist. Nothing was built on it.

### Tests, coverage, gas

85 unit and fuzz tests, 4 invariants and 11 gas benchmarks ([`contracts/test/`](contracts/test)):

- **Unit:** every external function, including each revert path (length bounds, charset, non-ASCII/homoglyph bytes, reserved names and their case variants, taken names and case variants, non-owner writes, ETH record length and zero address, reverse mismatch).
- **Fuzz:** `testFuzz_normalizeIsIdempotent`, `testFuzz_normalizeMatchesReference` (contract vs. an independent reference model over arbitrary bytes, including the exact revert reason), `testFuzz_registerThenResolve`, the reserved list, ownership and reverse authorization.
- **Invariants:** a stateful handler drives random register / transfer / setRecord / setReverse sequences across five actors against a full ghost model of owners, records and reverse claims. After every call it checks that:
  - every registered node has exactly one owner, writes succeed exactly when the caller owns the node, and owner writes with valid input never revert
  - every record the resolver serves equals the last value its owner wrote
  - `reverse(a)` is exactly the model's answer, and round-trips (`addr(reverse(a), 60) == a`) wherever it is set
  - no two distinct names collide to the same node, no name or case variant registers twice, and no reserved name registers at all
- **Mutation-checked:** the invariant suite fails on each of seven deliberate contract bugs: `reverse` always returning zero, owner ETH writes reverting, non-ETH records dropped, `transfer` always reverting, the reverse re-check removed, the reserved check removed, and the transfer auth check removed.

| File | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| `PaytagRegistry.sol` | 100% (37/37) | 100% (43/43) | 100% (9/9) | 100% (7/7) |
| `PaytagResolver.sol` | 100% (26/26) | 100% (37/37) | 100% (10/10) | 100% (5/5) |

#### Gas

Per-call gas from fixed scenarios in [`contracts/test/Gas.t.sol`](contracts/test/Gas.t.sol), written to [`contracts/snapshots/GasTest.json`](contracts/snapshots/GasTest.json). Figures exclude the 21k base transaction cost. The full per-test snapshot is [`contracts/.gas-snapshot`](contracts/.gas-snapshot); CI fails if either drifts.

| Call | Baseline | Optimized | Deployed | Δ vs. baseline |
|---|---|---|---|---|
| `register` (20 chars) | 57,433 | 53,988 | 54,791 | −4.6% |
| `register` (3 chars) | 50,497 | 49,840 | 50,643 | +0.3% |
| `transfer` | 29,537 | 29,537 | 29,537 | — |
| `setRecord` ETH (new) | 53,396 | 53,083 | 53,156 | −0.4% |
| `setRecord` ETH (overwrite) | 36,296 | 35,983 | 36,056 | −0.7% |
| `setRecord` SOL 32 B (new) | 75,764 | 75,725 | 75,725 | −0.1% |
| `setRecord` BTC 22 B (new) | 53,371 | 53,332 | 53,332 | −0.1% |
| `setReverse` | 48,670 | 47,772 | 47,772 | −1.8% |
| `addr` ETH | 3,372 | 2,824 | 2,824 | −16.3% |
| `reverse` | 5,649 | 4,763 | 4,763 | −15.7% |

The optimization pass made two changes:

1. **In-place normalization.** `register` used to allocate a second buffer and copy byte by byte. It now lowercases the calldata copy in place inside an `unchecked` loop, with single-comparison range checks (`uint8(c - 0x61) < 26`). The saving scales with name length.
2. **Packed ETH records.** Coin type 60 moved out of `mapping(… => bytes)` into a dedicated `mapping(bytes32 => address)`. Reverse checks are now one `SLOAD` with no memory decode.

The "Deployed" column adds the review fixes. The reserved-name check costs about 800 gas per `register` (28 hash comparisons; it also adds about 1.3 KB of bytecode). The zero-address check costs 73 gas per ETH write.

What I didn't change, and why: writes are dominated by the 22.1k cold `SSTORE`, which no layout trick avoids. A 32-byte Solana key costs two slots (length + data) because Solidity only inlines `bytes` of up to 31 bytes. Packing it into one `bytes32` would need a coin-type-specific layout, adding complexity for about 20k gas once per record. I wasn't willing to make that trade.

### Indexer

Live at **<https://indexer.paytag.dev>**, self-hosted on Coolify with Postgres. [`indexer/`](indexer) is a [Ponder](https://ponder.sh) 0.18 app that indexes `NameRegistered`, `Transfer`, `RecordSet` and `ReverseSet` from block 48118052 into Postgres, and serves a public read API. New on-chain writes show up within about 3 seconds.

| Endpoint | Returns |
|---|---|
| `GET /resolve/:name` | `{ username, node, owner, registeredAt, addresses, records, source: "onchain" }`. Same base shape as the API's `/resolve`; `records` holds every raw record with its decoded address and a `stale` flag |
| `GET /reverse/:address` | `{ address, username }`. `username` is null unless the claim is still forward-verified and current |
| `GET /available/:name` | `{ available, reason?, suggestions }`. Format, the registry's reserved list, then taken |
| `GET /names?owner=0x…` | Names currently owned by an address |
| `POST /graphql` | Ponder's generated GraphQL over the raw tables. It has no `stale` field: compare `records.updatedOrdinal < names.lastTransferOrdinal` yourself |
| `GET /status`, `/ready` | Synced block per chain; 200 once backfill is complete |

**Rate limits**: each client address gets 120 requests a minute on the REST routes and 30 on `/graphql` (a burst up to the limit, then a steady refill). Over the limit, the answer is `429 { code: "RATE_LIMITED" }` with `Retry-After`; every limited response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`. `/status`, `/ready` and `/health` aren't limited. The client address is the rightmost `X-Forwarded-For` entry, the one the reverse proxy appends, so the indexer must only be reachable through that proxy. Server-to-server callers can send `x-paytag-server-key: <INDEXER_SERVER_KEY>` to skip the limit; the web app's server-rendered pages do, because they all share Vercel's addresses. Limits are in memory, per process.

Until backfill completes, every route above answers `503 { code: "NOT_READY" }` rather than serving partial data (which would claim registered names are free). Readiness is read from the deployment's own database, the same flag as `/ready`. Route errors return a generic `{ code: "INTERNAL_ERROR" }`, and GraphQL masks error details when `NODE_ENV=production` (the Docker image sets it).

Read-model rules the indexer enforces:

- Every `RecordSet` payload equals what `addr` returns afterwards. An empty value deletes the record; the zero ETH address can't be written.
- **Stale records**: a record written before the name's latest change of owner was set by a previous owner. It's listed in `records` with `stale: true` but left out of `addresses`, so payment flows never pay a former owner. Self-transfers don't count; a transfer away and back (A → B → A) does, so A rewrites their records after reclaiming the name. This is stricter than the contract, which keeps serving such records.
- **Reverse validity**: not derivable from `ReverseSet` alone (a coin-60 `RecordSet` silently invalidates claims on the old address). `/reverse` serves `claim[a]` only while `eth[claim[a]] == a` (mirroring `PaytagResolver.reverse()`) and that ETH record isn't stale, so a former owner's address stops resolving to the name at transfer time. That second condition is stricter than the contract.
- **Reserved names** are answered locally from the registry's hard-coded hashes (generated into `indexer/abis/reservedNodes.ts` and drift-checked in CI), with no RPC call per request.
- Records use ENSIP-9 encodings: SOL is the raw 32-byte key, BTC is the `scriptPubKey`, EVM chains are 20 address bytes. Test vectors are in [`indexer/test/vectors.json`](indexer/test/vectors.json).

Run it locally (Node ≥ 22.12; uses embedded PGlite, no Postgres needed):

```bash
cd indexer && npm install
PONDER_RPC_URL_84532=<base-sepolia-rpc> npm run dev
```

Production runs the [`Dockerfile`](indexer/Dockerfile) with `DATABASE_URL`, `DATABASE_SCHEMA` and `PONDER_RPC_URL_84532` set; it uses about 200 MB of RAM. Optional: `INDEXER_SERVER_KEY` (a long random secret, also set in the web app's environment), and `RATE_LIMIT_PER_MIN` / `RATE_LIMIT_GRAPHQL_PER_MIN` to change the defaults (120 / 30).

Operational note: Ponder's own logs print the full RPC URL when an RPC request fails, and with Alchemy that includes the API key. The key never reaches HTTP clients, but treat the indexer's logs as secret, or use a key restricted to this app.

### Known trade-offs

- **Free, first-come, permanent registration.** No fees, expiry or commit-reveal, so names can be front-run from the mempool and squatted. That's acceptable for a testnet demo; mainnet would need commit-reveal at minimum.
- **Records survive a transfer.** Ownership moves, but the previous owner's records stay until the new owner overwrites them, so a payment to a just-transferred name goes to the old address. The same goes for the previous owner's reverse claim: `reverse(oldOwner)` keeps returning the name until the new owner changes the ETH record, at which point it goes dark automatically. The app and indexer should flag records and reverse claims that predate the latest `Transfer`. Before mainnet, the resolver could record each node's writer and stop serving records once the writer is no longer the owner, at the cost of one extra registry call per read.
- **ASCII-only names.** This removes Unicode homoglyphs entirely. ASCII lookalikes (`0`/`o`, `1`/`l`) remain, so names are displayed in a monospace font.
- **Fixed reserved list.** The contract has no admin, so the blocklist can't change after deployment. Adding a reserved name means a redeploy, and the drift test enforces that.

### Local setup

```bash
git submodule update --init --recursive
cd contracts && forge test
```

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Health check |
| GET | `/auth/nonce?wallet=0x…` | — | Issue nonce for wallet signing |
| POST | `/auth/verify` | — | Verify signed nonce, return JWT |
| POST | `/register` | JWT | Register a username |
| POST | `/add-address` | JWT | Add or update an address for a chain |
| GET | `/resolve/:username` | — | Resolve username → addresses |
| GET | `/available/:username` | — | Check whether a username is free |

Public read endpoints (`/resolve`, `/available`, `/health`) are CORS-open. `/resolve` responses carry `Cache-Control: public, max-age=30, stale-while-revalidate=60`.

**Resolution response**

```json
{
  "username": "derrick",
  "addresses": {
    "ethereum": "0x4f3edf83…d8a3c2",
    "solana": "4Nd1mYz7K8jM…",
    "bitcoin": "bc1qw508d6q…"
  }
}
```

**Error response**

```json
{ "error": "Username not found", "code": "USER_NOT_FOUND" }
```

## Auth flow

1. Client calls `GET /auth/nonce?wallet=0x…` → receives `{ nonce }`
2. Client signs message: `Paytag authentication\n\nSign this message to log in.\n\nNonce: <nonce>`
3. Client POSTs `{ wallet, signature }` to `/auth/verify` → receives `{ token, wallet }`
4. Client uses `Authorization: Bearer <token>` on protected routes

Nonces are single-use (deleted on verify) and TTL-bounded (default 300 s) to prevent replay.

## Username rules

Lowercase, 3–20 characters, `[a-z0-9_]`. One username per wallet.

## Architecture

```
┌──────────────────────────────────────┐
│  Backend API  (src/)                 │   Node.js + Express + TypeScript
│  controllers → services → models     │   - thin controllers
│  + JWT middleware, zod validation    │   - business logic in services
└────────────────┬─────────────────────┘
                 │  @supabase/supabase-js
                 ▼
┌──────────────────────────────────────┐
│  Supabase / PostgreSQL               │
│  users · wallet_mappings · nonces    │
└──────────────────────────────────────┘
```

| Layer | Choice |
|---|---|
| Backend | Node.js, Express, TypeScript, Zod, jsonwebtoken, ethers |
| Database | Supabase (Postgres) with RLS policies |
| Tests | Jest + ts-jest |

## Local setup

### Prerequisites

- Node.js ≥ 20
- A Supabase project (free tier is fine)

### Run the API

```bash
npm install
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET (32+ chars)
```

Apply the schema once in your Supabase SQL editor by pasting the contents of `supabase/migrations/0001_init.sql`.

```bash
npm run dev   # http://localhost:3000
```

## Repo layout

```
.
├── src/                  # Backend (Express + TS)
│   ├── config/           # env, supabase client
│   ├── controllers/      # route handlers (thin)
│   ├── services/         # auth, user, wallet (business logic)
│   ├── middleware/       # auth, validate, errorHandler
│   ├── routes/           # router wiring
│   ├── utils/
│   ├── app.ts
│   └── index.ts
├── contracts/            # Solidity registry + resolver (Foundry)
├── indexer/              # Ponder indexer + read API for the on-chain registry
├── packages/sdk/         # @paytagdev/sdk (npm package)
├── web/                  # Next.js dApp (deployed at paytag.dev)
├── supabase/migrations/  # SQL schema
└── tests/                # Backend Jest tests
```

The repo is an npm workspace; `npm install` at the root installs everything.

## Scripts

| Script | Action |
|---|---|
| `npm run dev` | API with hot-reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled build |
| `npm test` | Backend tests |
| `npm run sdk:build` | Build the SDK |
| `npm run sdk:test` | Run SDK tests |

## Roadmap

- [x] Phase 1 — Auth + register
- [x] Phase 2 — Resolution + multi-chain
- [x] Phase 3 — Frontend MVP
- [x] Phase 4 — Payments (EVM)
- [x] Phase 5 — JavaScript SDK + npm package
- [x] Multi-chain tx initiation — Phantom (Solana) + Sats Connect (Bitcoin)
- [ ] Future — On-chain verification, ERC-20 / SPL-token sends, payment links with amount, social recovery

## Security

- Nonces are single-use and TTL-bounded
- JWT secret enforced ≥ 32 chars
- Service-role Supabase key isolated to backend
- RLS enabled on all tables (public read on `users` + `wallet_mappings`, no public access to `auth_nonces`)
- No private keys are ever stored or transmitted

## License

MIT
