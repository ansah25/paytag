# Paytag indexer (Ponder). Build context: the indexer/ directory.
#   docker build -t paytag-indexer indexer/
# Runtime env (all required; the container refuses to start without them):
#   PONDER_RPC_URL_84532  Base Sepolia RPC
#   DATABASE_URL          Postgres connection string (without it Ponder would silently use
#                         ephemeral PGlite inside the container)
#   DATABASE_SCHEMA       Postgres schema for this deployment, e.g. "paytag_v1"
# Optional: PORT (default 42069)
FROM node:22.12-slim

ENV NODE_ENV=production
WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
# Production dependencies only (NODE_ENV=production): Ponder bundles the TypeScript sources
# itself at startup, so typescript/vitest aren't needed at runtime.
RUN npm ci --no-audit --no-fund

COPY --chown=node:node . .

EXPOSE 42069
# /ready returns 200 once historical sync is complete. Until then the API answers 503 NOT_READY
# itself, so correctness doesn't depend on the platform honouring this healthcheck.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10m --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||42069)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", ": \"${PONDER_RPC_URL_84532:?set PONDER_RPC_URL_84532}\" \"${DATABASE_URL:?set DATABASE_URL}\"; exec npx ponder start --schema \"${DATABASE_SCHEMA:?set DATABASE_SCHEMA}\""]
