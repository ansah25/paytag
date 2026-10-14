# Paytag indexer (Ponder). Build context: the indexer/ directory.
#   docker build -t paytag-indexer indexer/
# Runtime env:
#   PONDER_RPC_URL_84532  Base Sepolia RPC (required)
#   DATABASE_URL          Postgres connection string (required in production)
#   DATABASE_SCHEMA       Postgres schema for this deployment, e.g. "paytag_v1" (required with Postgres)
#   PORT                  HTTP port (default 42069)
FROM node:22.12-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Full install: Ponder type-checks and bundles the TypeScript sources at startup.
RUN npm ci --no-audit --no-fund

COPY . .

EXPOSE 42069
# /ready returns 200 only once backfill is complete, so a deploy goes live only when caught up.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10m --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||42069)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "exec npx ponder start --schema \"${DATABASE_SCHEMA:?set DATABASE_SCHEMA}\""]
