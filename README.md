# Paytag

[![CI](https://github.com/ansah25/paytag/actions/workflows/ci.yml/badge.svg)](https://github.com/ansah25/paytag/actions/workflows/ci.yml)

> Username-to-wallet identity layer for multi-chain crypto payments.

Replace `0x4f3edf83…d8a3c2` with `@derrick`. Paytag maps human-readable usernames to wallet addresses across Ethereum, Solana, and Bitcoin.

## Live

- **API:** <https://api.paytag.dev>
- **dApp:** <https://www.paytag.dev>
- **SDK:** [`@paytagdev/sdk`](https://www.npmjs.com/package/@paytagdev/sdk) on npm

## SDK

```bash
npm install @paytagdev/sdk
```

```ts
import { resolve } from '@paytagdev/sdk';

const user = await resolve('derrick');
// { username: 'derrick', addresses: { ethereum: '0x4f3edf83…', … } }
```

Zero config — the SDK ships with `https://api.paytag.dev` as the default base URL. See [`packages/sdk/README.md`](packages/sdk/README.md) for `resolveAddress`, `available`, custom clients, and error codes.

## On-chain protocol (Base)

> In progress — see [`docs/paytag-onchain-build-plan.md`](docs/paytag-onchain-build-plan.md).

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

_TBD — Ponder._ Design constraints already fixed by the contracts:

- Every `RecordSet` payload equals what `addr` returns afterwards. An empty value means cleared; the zero ETH address can't be written.
- Reverse validity is not derivable from `ReverseSet` alone. A coin-60 `RecordSet` silently invalidates any reverse claim pointing at the old address, so the indexer stores claims and serves `reverse(a) = claim[a]` only while `eth[claim[a]] == a`, which mirrors the contract.

### Known trade-offs

- **Free, first-come, permanent registration.** No fees, expiry or commit-reveal, so names can be front-run from the mempool and squatted. That's acceptable for a testnet demo; mainnet would need commit-reveal at minimum.
- **Records survive a transfer.** Ownership moves, but the previous owner's records stay until the new owner overwrites them, so a payment to a just-transferred name goes to the old address. The app and indexer should flag records written before the latest `Transfer`. Reverse claims go dark automatically once the ETH record changes.
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
