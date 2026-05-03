# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Paytag** is a blockchain-based payment identity platform that maps human-readable usernames (e.g., `@derrick`) to multi-chain wallet addresses. It replaces long wallet addresses with usernames for seamless crypto payments.

The project is currently in the specification phase — no source code exists yet. Implementation follows `project_spec.md`.

---

## Planned Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js + Wagmi (wallet integration) |
| Backend | Node.js (Express or Fastify) + TypeScript |
| Database | Supabase (PostgreSQL) |
| Blockchain | EVM-compatible chains |
| Validation | Zod or Joi |
| Auth | Nonce-based wallet signing + JWT |

> **Model preference:** Use Claude Opus for writing code in this project.

---

## Supabase Usage

- Use the **Supabase JS client** (`@supabase/supabase-js`) for all DB access — no raw `pg` driver
- Database schema lives in Supabase migrations (`supabase/migrations/`)
- Use `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or `SUPABASE_SERVICE_ROLE_KEY` for server-side) via environment variables
- Row-Level Security (RLS) policies should be defined for the `User` and `WalletMapping` tables
- Use Supabase Auth if replacing custom JWT/nonce auth becomes preferable; otherwise keep custom wallet-signing flow

---

## Architecture

### Three-Tier Structure

```
Frontend (Next.js + Wagmi)
    ↕ HTTP / REST
Backend API (Node.js + TypeScript)
  ├── controllers/   ← route handlers only, no business logic
  ├── services/      ← all business logic here
  └── models/        ← DB schema and queries
    ↕ SQL
PostgreSQL
  ├── User           (id, username, owner_wallet, created_at)
  ├── WalletMapping  (id, user_id FK, chain, address)
  └── AuthNonce      (wallet_address, nonce, created_at)
```

### Authentication Flow
1. Client calls `GET /auth/nonce?wallet=0x...` → receives nonce
2. Client signs nonce with wallet private key
3. Client calls `POST /auth/verify` with signed nonce → receives JWT
4. JWT used as Bearer token for protected endpoints

### Resolution Flow
`GET /resolve/:username` → queries WalletMapping → returns all chain addresses

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/auth/nonce` | — | Request nonce for wallet |
| POST | `/auth/verify` | — | Verify signed nonce, get JWT |
| POST | `/register` | JWT | Register a username |
| POST | `/add-address` | JWT | Add wallet address for a chain |
| GET | `/resolve/:username` | — | Resolve username to addresses |

**Resolution response shape:**
```json
{
  "username": "derrick",
  "addresses": {
    "ethereum": "0x123...",
    "solana": "...",
    "bitcoin": "..."
  }
}
```

**Error response shape:**
```json
{ "error": "message", "code": 400 }
```

---

## Username Rules

- Lowercase only
- 3–20 characters
- Alphanumeric + underscore (`[a-z0-9_]`)
- Stored normalized (lowercase)

---

## Development Phases

- **Phase 1** — Backend setup, PostgreSQL, nonce auth, JWT, `/register`
- **Phase 2** — `/resolve/:username`, `/add-address`, multi-chain normalization
- **Phase 3** — Frontend: wallet connect UI, registration, address management
- **Phase 4** — Send-to-username payment flow, chain detection, tx initiation
- **Phase 5** — JavaScript SDK, npm package wrapping `/resolve`

Start implementation with Phase 1 targets: `/auth/nonce`, `/auth/verify`, `/register`, `/resolve/:username`.

---

## Coding Standards

- **TypeScript everywhere** — no plain JS files
- **Naming:** camelCase for variables/functions, PascalCase for classes/types, snake_case for DB fields
- **No business logic in controllers** — controllers delegate to services
- **Validate all inputs** at the controller boundary using Zod or Joi
- **Secrets via environment variables** — never hardcoded

---

## Testing Requirements

A feature is complete only when: code written + tests implemented + E2E flow validated + no regressions.

- **Unit tests:** test services in isolation; mock DB calls
- **Integration tests:** test `/register`, `/resolve`, `/add-address` endpoints
- **E2E scenarios:** register username, add multiple addresses, resolve correctly, invalid username fails, duplicate username rejected
- **Security:** nonce expiration (prevent replay attacks), strict signature verification, proper JWT validation

---

## Security Constraints

- Never store private keys
- Never custody user funds
- Nonces must expire to prevent replay attacks
- Keep system stateless where possible

---

## Performance Targets

- `GET /resolve/:username` target: <100ms
- Index DB queries on `username` and `user_id`
- Redis caching for `/resolve` responses (optional for MVP)
