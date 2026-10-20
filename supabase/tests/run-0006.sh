#!/usr/bin/env bash
# Runs migrations 0001..0006 in a throwaway Postgres and checks 0006_lockdown.
# Usage (from the repo root): bash supabase/tests/run-0006.sh   (needs Docker)
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
NAME=paytag-0006-test
IMAGE=postgres:15-alpine
ERR=$(mktemp)

psql_run() { docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -q -U postgres -d "$1" "${@:2}"; }

fresh_db() {
  docker exec "$NAME" psql -q -U postgres -c "create database $1"
  psql_run "$1" < tests/roles.sql 2>/dev/null || true # roles are cluster-wide; exist after the first db
}

migrate() { # db, last migration to apply (inclusive)
  for f in migrations/*.sql; do
    psql_run "$1" --single-transaction < "$f"
    [[ "$(basename "$f")" == "$2"* ]] && break
  done
}

expect_migration_failure() { # db, label, expected error text
  if psql_run "$1" --single-transaction < migrations/0006_lockdown.sql 2>"$ERR"; then
    echo "FAIL $2: 0006 ran but should have refused"; exit 1
  fi
  grep -q "$3" "$ERR" || { echo "FAIL $2: unexpected error:"; cat "$ERR"; exit 1; }
  # Nothing changed: the public read policy is still there.
  [[ "$(psql_run "$1" -tAc "select count(*) from pg_policies where policyname = 'users_public_read'")" == 1 ]] \
    || { echo "FAIL $2: 0006 partially applied"; exit 1; }
  echo "ok   $2"
}

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=x "$IMAGE" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1; rm -f "$ERR"' EXIT
until docker exec "$NAME" pg_isready -U postgres -q 2>/dev/null; do sleep 1; done
sleep 2

# 1. Production-like: original tables created under Supabase's old blanket grants.
fresh_db legacy
psql_run legacy < tests/legacy_default_grants.sql
migrate legacy 0006
psql_run legacy < tests/0006_lockdown_test.sql | grep -q 'ALL 0006 ASSERTIONS PASSED'
echo "ok   legacy grants"

# 2. Fresh project: no automatic grants; service_role must work from the migrations alone.
fresh_db fresh
migrate fresh 0006
psql_run fresh < tests/0006_lockdown_test.sql | grep -q 'ALL 0006 ASSERTIONS PASSED'
echo "ok   fresh project"

# 3. Guard: existing data that would fail a CHECK -> refuses, changes nothing.
fresh_db baddata
psql_run baddata < tests/legacy_default_grants.sql
migrate baddata 0005
psql_run baddata -c "insert into users (username, owner_wallet) values ('bad', '0x000000000000000000000000000000000000dead')" \
  -c "insert into wallet_mappings (user_id, chain, address) select id, 'bitcoin', 'not-an-address' from users"
expect_migration_failure baddata "guard: bad existing row" "Rows would fail the new CHECKs"

# 4. Guard: a view over users would survive the revokes -> refuses.
fresh_db viewdb
psql_run viewdb < tests/legacy_default_grants.sql
migrate viewdb 0005
psql_run viewdb -c "create view public_profiles as select username, owner_wallet from users"
expect_migration_failure viewdb "guard: exposing view" "would still expose"

# 5. Rollback restores the old shape (policies, grants, an empty auth_nonces).
psql_run legacy --single-transaction < ops/0006_rollback.sql
[[ "$(psql_run legacy -tAc "select count(*) from pg_policies where policyname in ('users_public_read','wallet_mappings_public_read')")" == 2 ]]
psql_run legacy -c "set role anon" -c "select count(*) from users" >/dev/null
psql_run legacy -c "select 1 from auth_nonces limit 1" >/dev/null
echo "ok   rollback"

echo "ALL SCENARIOS PASSED"
