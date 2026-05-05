# Paytag

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
- [ ] Future — On-chain verification, ERC-20 sends, Solana/Bitcoin tx initiation, payment links with amount, social recovery

## Security

- Nonces are single-use and TTL-bounded
- JWT secret enforced ≥ 32 chars
- Service-role Supabase key isolated to backend
- RLS enabled on all tables (public read on `users` + `wallet_mappings`, no public access to `auth_nonces`)
- No private keys are ever stored or transmitted

## License

MIT
