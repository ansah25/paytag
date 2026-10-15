#!/bin/sh
# Container entrypoint (see Dockerfile). Fails fast on missing env, then starts Ponder on a schema
# of its own: "<DATABASE_SCHEMA>_<container id>".
#
# Why per container: Ponder refuses a schema created by a different build of the indexer, and one
# that another live process holds (its lock heartbeat). A Coolify rolling update starts the new
# container while the old one still serves, so the new one needs a different schema even when the
# code didn't change. The id is random, generated on the container's first start and kept in its
# writable layer: a restart of the same container finds it and resumes (crash recovery), while a
# new deploy (a new container) starts without it. A fresh schema syncs fast because Ponder caches
# RPC data in a shared schema of its own (`ponder_rpc_cache_1` in 0.18).
set -eu
: "${PONDER_RPC_URL_84532:?set PONDER_RPC_URL_84532}"
: "${DATABASE_URL:?set DATABASE_URL}"
: "${DATABASE_SCHEMA:?set DATABASE_SCHEMA}"

id_file=/app/.container-schema-id
if [ ! -s "$id_file" ]; then
  head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$id_file"
fi
schema="${DATABASE_SCHEMA}_$(cat "$id_file")"
echo "Using database schema $schema"
# node directly (not npx), so SIGTERM from `docker stop` reaches Ponder, which then shuts down
# cleanly and releases its schema lock instead of leaving a restart to wait out a stale one.
exec node node_modules/.bin/ponder start --schema "$schema"
