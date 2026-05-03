# Paytag

> Username-to-wallet identity layer for multi-chain crypto payments.

Replace `0x4f3edf83…d8a3c2` with `@derrick`. Paytag maps human-readable usernames to wallet addresses across Ethereum, Solana, and Bitcoin — and lets anyone send native ETH to a username with one click.

## Status

MVP complete (spec phases 1–4):

- ✅ Wallet-signature auth (nonce + EIP-191 + JWT)
- ✅ Username registration with uniqueness + format rules
- ✅ Multi-chain address mapping (ethereum, solana, bitcoin)
- ✅ Public resolution API
- ✅ Next.js dApp: wallet connect, sign-in, registration, address management
- ✅ Send-to-username flow on EVM chains via Wagmi

## Architecture

```
┌────────────────────────────────────┐
│  Frontend  (web/)                  │   Next.js 14 + Wagmi v2 + viem
│  ──────────────────                │   - / public resolver
│  • /                               │   - /app  state machine
│  • /app                            │   - /pay/:username  send flow
│  • /pay/:username                  │
└────────────────┬───────────────────┘
                 │  HTTP / JSON
                 ▼
┌────────────────────────────────────┐
│  Backend API  (src/)               │   Node.js + Express + TypeScript
│  ──────────────────                │   - thin controllers
│  controllers → services → models   │   - business logic in services
│  + JWT middleware, zod validation  │
└────────────────┬───────────────────┘
                 │  @supabase/supabase-js
                 ▼
┌────────────────────────────────────┐
│  Supabase / PostgreSQL             │
│  users · wallet_mappings · nonces  │
└────────────────────────────────────┘
```

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js, Express, TypeScript, Zod, jsonwebtoken, ethers |
| Database | Supabase (Postgres) with RLS policies |
| Frontend | Next.js 14 (App Router), React 18, Tailwind |
| Wallet | Wagmi v2 + viem, injected connector (MetaMask) |
| Tests | Jest + ts-jest |

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Health check |
| GET | `/auth/nonce?wallet=0x…` | — | Issue nonce for wallet signing |
| POST | `/auth/verify` | — | Verify signed nonce, return JWT |
| POST | `/register` | JWT | Register a username |
| POST | `/add-address` | JWT | Add or update an address for a chain |
| GET | `/resolve/:username` | — | Resolve username → addresses |

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

## Auth flow

1. Client calls `GET /auth/nonce?wallet=0x…` → receives `{ nonce }`
2. Client signs message: `Paytag authentication\n\nSign this message to log in.\n\nNonce: <nonce>`
3. Client POSTs `{ wallet, signature }` to `/auth/verify` → receives `{ token, wallet }`
4. Client uses `Authorization: Bearer <token>` on protected routes

The nonce is single-use (deleted after verify) and TTL-bounded (default 300s) to prevent replay.

## Username rules

Lowercase, 3–20 characters, `[a-z0-9_]`. One username per wallet.

## Supported chains

| Chain | Format | Tx support in dApp |
|---|---|---|
| `ethereum` | EVM hex (lowercased) | ✅ Native ETH via Wagmi |
| `solana` | base58 (32–44) | Receive only (copy address) |
| `bitcoin` | P2PKH, P2SH, or Bech32 | Receive only (copy address) |

## Local setup

### Prerequisites

- Node.js ≥ 20
- A Supabase project (free tier is fine)
- A browser wallet (MetaMask) for the frontend

### Backend

```bash
npm install
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET (32+ chars)
```

Apply the schema once in your Supabase SQL editor:

```bash
# paste contents of supabase/migrations/0001_init.sql into the editor
```

Run:

```bash
npm run dev   # http://localhost:3000
```

### Frontend

```bash
cd web
npm install
cp .env.local.example .env.local
npm run dev   # http://localhost:3001
```

Visit `http://localhost:3001`, connect MetaMask, register a username on `/app`, then try `/pay/<username>` (use a Sepolia testnet faucet for free test ETH).

## Scripts

**Backend (root)**

| Script | Action |
|---|---|
| `npm run dev` | API with hot-reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled build |
| `npm test` | Run Jest tests |

**Frontend (`web/`)**

| Script | Action |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run type-check` | TypeScript check only |

## Project layout

```
.
├── src/                        # Backend (Express + TS)
│   ├── config/                 # env, supabase client
│   ├── controllers/            # route handlers (thin)
│   ├── services/               # auth, user, wallet (business logic)
│   ├── middleware/             # auth, validate, errorHandler
│   ├── routes/                 # router wiring
│   ├── utils/errors.ts
│   ├── app.ts
│   └── index.ts
├── supabase/
│   └── migrations/0001_init.sql
├── tests/                      # Jest unit tests
├── web/                        # Next.js frontend
│   ├── app/                    # App Router pages
│   ├── components/
│   └── lib/                    # api client, wagmi, auth, chains
├── project_spec.md
└── CLAUDE.md
```

## Roadmap

- [x] Phase 1 — Auth + register
- [x] Phase 2 — Resolution + multi-chain
- [x] Phase 3 — Frontend MVP
- [x] Phase 4 — Payments (EVM)
- [ ] Phase 5 — JavaScript SDK + npm package
- [ ] Future — On-chain verification, ERC-20 sends, Solana/Bitcoin tx initiation, payment links with amount, social recovery

## Security

- Nonces are single-use and TTL-bounded
- JWT secret enforced ≥ 32 chars
- Service-role Supabase key isolated to backend
- RLS enabled on all tables (public read on `users` + `wallet_mappings`, no public access to `auth_nonces`)
- No private keys are ever stored or transmitted

## License

MIT
