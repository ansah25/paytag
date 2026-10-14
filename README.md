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
| [`PaytagRegistry`](contracts/src/PaytagRegistry.sol) | Normalization, registration, ownership, transfer |
| [`PaytagResolver`](contracts/src/PaytagResolver.sol) | Per-chain address records, forward-verified reverse resolution |

### Deployed addresses

Base Sepolia (chain 84532), verified on Basescan and Sourcify. Deployed at block 48117093 from the [`Deploy`](contracts/script/Deploy.s.sol) script; the full record is in [`contracts/broadcast/`](contracts/broadcast/Deploy.s.sol/84532/run-latest.json).

| Contract | Address |
|---|---|
| `PaytagRegistry` | [`0xf082914be358F3c3D9371C035f41D2BE6c408721`](https://sepolia.basescan.org/address/0xf082914be358f3c3d9371c035f41d2be6c408721#code) |
| `PaytagResolver` | [`0xa403F7B40B8634db46919ec2f1A642D629e2e828`](https://sepolia.basescan.org/address/0xa403f7b40b8634db46919ec2f1a642d629e2e828#code) |

The ABI is frozen at tag `v0.1.0-contracts`.

### Tests, coverage, gas

77 tests across unit, fuzz and invariant suites ([`contracts/test/`](contracts/test)):

- **Unit** — every external function, including each revert path (length bounds, charset, non-ASCII/homoglyph bytes, taken names and case variants, non-owner writes, ETH record length, reverse mismatch).
- **Fuzz** — `testFuzz_normalizeIsIdempotent`, `testFuzz_normalizeMatchesReference` (contract vs. an independent reference model over arbitrary bytes), `testFuzz_registerThenResolve`, ownership and reverse authorization.
- **Invariants** — a stateful handler drives random register / transfer / setRecord / setReverse sequences across five actors and checks after every call that:
  - every registered node has exactly one owner, matching a ghost model
  - reverse resolution round-trips: `addr(reverse(a), 60) == a` wherever `reverse(a) != 0`
  - no two distinct normalized names collide to the same node, and no name or case variant registers twice

| File | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| `PaytagRegistry.sol` | 100% (31/31) | 100% (42/42) | 100% (8/8) | 100% (5/5) |
| `PaytagResolver.sol` | 100% (23/23) | 100% (33/33) | 100% (4/4) | 100% (6/6) |

#### Gas

Per-call gas from fixed scenarios in [`contracts/test/Gas.t.sol`](contracts/test/Gas.t.sol) (written to [`contracts/snapshots/GasTest.json`](contracts/snapshots/GasTest.json); excludes the 21k base transaction cost). The full per-test snapshot is [`contracts/.gas-snapshot`](contracts/.gas-snapshot).

One optimization pass, before → after:

| Call | Before | After | Δ |
|---|---|---|---|
| `register` (20 chars) | 57,433 | 53,988 | −6.0% |
| `register` (3 chars) | 50,497 | 49,840 | −1.3% |
| `transfer` | 29,537 | 29,537 | — |
| `setRecord` ETH (new) | 53,396 | 53,083 | −0.6% |
| `setRecord` ETH (overwrite) | 36,296 | 35,983 | −0.9% |
| `setRecord` SOL 32 B (new) | 75,764 | 75,725 | −0.1% |
| `setRecord` BTC 22 B (new) | 53,371 | 53,332 | −0.1% |
| `setReverse` | 48,670 | 47,772 | −1.8% |
| `addr` ETH | 3,372 | 2,824 | −16.3% |
| `reverse` | 5,649 | 4,763 | −15.7% |

What changed:

1. **In-place normalization.** `register` used to allocate a second buffer and copy byte by byte. It now lowercases the calldata copy in place inside an `unchecked` loop, with single-comparison range checks (`uint8(c - 0x61) < 26`). The saving scales with name length. Registry runtime bytecode also dropped from 2,793 to 1,964 bytes.
2. **Packed ETH records.** Coin type 60 moved out of `mapping(… => bytes)` into a dedicated `mapping(bytes32 => address)`. Reverse checks are now one `SLOAD` with no memory decode. Trade-off: an all-zero ETH record reads back as unset.

What I didn't change, and why: writes are dominated by the 22.1k cold `SSTORE`, which no layout trick avoids. A 32-byte Solana key costs two slots (length + data) because Solidity only inlines `bytes` of up to 31 bytes. Packing it into one `bytes32` would need a coin-type-specific layout, adding complexity for about 20k gas once per record. I wasn't willing to make that trade.

### Indexer

_TBD — Ponder._

### Known trade-offs

_TBD — free first-come registration (front-running / squatting), ASCII-only name policy._

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
