# Paytag indexer (Ponder). Build context: the indexer/ directory.
#   docker build -t paytag-indexer indexer/
# Runtime env (all required; the container refuses to start without them):
#   PONDER_RPC_URL_84532  Base Sepolia RPC
#   DATABASE_URL          Postgres connection string (without it Ponder would silently use
#                         ephemeral PGlite inside the container)
#   DATABASE_SCHEMA       Schema prefix, e.g. "paytag". The container runs on
#                         "<prefix>_<build hash>" (see below), so each code change gets its own schema.
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

# Ponder stamps a schema with a build ID derived from the config, schema, indexing and API code,
# and `ponder start` refuses a schema created by a different build. So the schema is named after
# a hash of exactly those inputs (plus the lockfile, for the Ponder version): changed code gets a
# fresh schema, synced while the previous container keeps serving; the same code redeployed
# reuses its schema and resumes. LC_ALL=C makes the file order, and so the hash, stable.
# `ls` first: sh has no pipefail, so a missing input would otherwise just hash fewer files.
RUN ls src abis ponder.config.ts ponder.schema.ts deployment.ts package-lock.json > /dev/null \
  && find src abis ponder.config.ts ponder.schema.ts deployment.ts package-lock.json -type f -print0 \
  | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12 > .build-hash

EXPOSE 42069
# /ready returns 200 once historical sync is complete. Until then the API answers 503 NOT_READY
# itself, so correctness doesn't depend on the platform honouring this healthcheck.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10m --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||42069)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", ": \"${PONDER_RPC_URL_84532:?set PONDER_RPC_URL_84532}\" \"${DATABASE_URL:?set DATABASE_URL}\"; schema=\"${DATABASE_SCHEMA:?set DATABASE_SCHEMA}_$(cat .build-hash)\"; echo \"Using database schema $schema\"; exec npx ponder start --schema \"$schema\""]
