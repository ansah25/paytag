#!/usr/bin/env bash
# Runs the migrations in a throwaway Postgres and checks 0006_lockdown, 0007_default_privileges and
# 0008_onchain_events.
# Usage (from the repo root): bash supabase/tests/run.sh   (needs Docker)
# Checks capture output before matching: `cmd | grep -q` under pipefail fails when grep exits early.
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
  psql_run "$1" < tests/db_setup.sql
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
out=$(psql_run legacy < tests/0006_lockdown_test.sql); [[ "$out" == *'ALL 0006 ASSERTIONS PASSED'* ]]
echo "ok   legacy grants"

# 2. Fresh project: no automatic grants; service_role must work from the migrations alone.
fresh_db fresh
migrate fresh 0006
out=$(psql_run fresh < tests/0006_lockdown_test.sql); [[ "$out" == *'ALL 0006 ASSERTIONS PASSED'* ]]
echo "ok   fresh project"

# 3. Guard: existing data that would fail a CHECK -> refuses, changes nothing.
fresh_db baddata
psql_run baddata < tests/legacy_default_grants.sql
migrate baddata 0005
psql_run baddata -c "insert into users (username, owner_wallet) values ('bad', '0x000000000000000000000000000000000000dead')" \
  -c "insert into wallet_mappings (user_id, chain, address) select id, 'bitcoin', 'not-an-address' from users"
expect_migration_failure baddata "guard: bad existing row" "Rows would fail the new CHECKs"
out=$(psql_run baddata < ops/0006_preflight.sql); [[ "$out" == *not-an-address* ]]
echo "ok   preflight lists the bad row"

# 4. Guard: a view over users would survive the revokes -> refuses.
fresh_db viewdb
psql_run viewdb < tests/legacy_default_grants.sql
migrate viewdb 0005
psql_run viewdb -c "create view public_profiles as select username, owner_wallet from users"
expect_migration_failure viewdb "guard: exposing view" "would still expose"

guarded_db() { # db, setup sql -> a 0005 database with that exposure added
  fresh_db "$1"
  psql_run "$1" < tests/legacy_default_grants.sql
  migrate "$1" 0005
  psql_run "$1" -c "$2"
}

# 4b. ...a materialized view (information_schema doesn't list them).
guarded_db matview "create materialized view mv as select username, owner_wallet from users"
expect_migration_failure matview "guard: materialized view" "materialized view public.mv"

# 4c. ...a SECURITY DEFINER function with a SQL-standard body (no prosrc text to match).
guarded_db atomicfn "create function public.dump() returns setof users language sql security definer begin atomic select * from public.users; end"
expect_migration_failure atomicfn "guard: BEGIN ATOMIC function" "function public.dump"

# 4d. ...a view in another schema, owned by another role: reported under its own schema.
guarded_db otherview "create role someone_else; create schema reporting; create view reporting.v as select owner_wallet from public.users; alter view reporting.v owner to someone_else"
expect_migration_failure otherview "guard: view in another schema" "view reporting.v"

# 4d2. ...a SECURITY DEFINER function in a Supabase-managed schema that depends on public.users
#      (the text scan skips those schemas; the dependency check doesn't).
guarded_db authdep "create schema auth; create function auth.peek() returns setof public.users language sql security definer begin atomic select * from public.users; end"
expect_migration_failure authdep "guard: dependency in auth schema" "function auth.peek"

# 4e. A SECURITY DEFINER function over Supabase's own auth.users must NOT block the lockdown.
guarded_db authfn "create schema auth; create table auth.users (id uuid primary key); create function public.handle_new_user() returns trigger language plpgsql security definer as \$f\$ begin insert into public.profiles_stub select new.id from auth.users limit 0; return new; end \$f\$"
psql_run authfn --single-transaction < migrations/0006_lockdown.sql
echo "ok   auth.users-only function doesn't block"

# 4f. A grant to PUBLIC is revoked too.
guarded_db publicgrant "grant select on users to public"
psql_run publicgrant --single-transaction < migrations/0006_lockdown.sql
[[ "$(psql_run publicgrant -tAc "select count(*) from information_schema.role_table_grants where table_name = 'users' and grantee = 'PUBLIC'")" == 0 ]]
echo "ok   PUBLIC grant revoked"

# 5. Rollback restores the public reads (select only), the policies and an empty auth_nonces.
psql_run legacy --single-transaction < ops/0006_rollback.sql
[[ "$(psql_run legacy -tAc "select count(*) from pg_policies where policyname in ('users_public_read','wallet_mappings_public_read')")" == 2 ]]
psql_run legacy -c "set role anon" -c "select count(*) from users" >/dev/null
fresh_db rbfresh
migrate rbfresh 0006
psql_run rbfresh --single-transaction < ops/0006_rollback.sql
[[ "$(psql_run rbfresh -tAc "select string_agg(privilege_type, ',') from information_schema.role_table_grants where table_name = 'users' and grantee = 'anon'")" == SELECT ]]
psql_run legacy -c "select 1 from auth_nonces limit 1" >/dev/null
echo "ok   rollback"

# --- 0007_default_privileges ---------------------------------------------------------------------

# Rows from ops/exposure_check.sql, as an optional role ($2). Empty output = pass.
findings() {
  local pre=(); [[ -n "${2:-}" ]] && pre=(-c "set role $2")
  local raw; raw=$(psql_run "$1" -tA -F'|' "${pre[@]}" -f - < ops/exposure_check.sql)
  printf '%s
' "$raw" | sed '/^$/d'
}

# 6. Before 0007, the exposure check flags what a new table/sequence/function would get. (Control:
#    proves the check sees the gap, so a clean result after 0007 means something.)
fresh_db pre7
psql_run pre7 < tests/legacy_default_grants.sql
migrate pre7 0006
out=$(findings pre7)
[[ "$out" == *"new tables"* && "$out" == *"new sequences"* && "$out" == *"new functions"* ]] \
  || { echo "FAIL exposure check missed the default-privilege gap:"; echo "$out"; exit 1; }
echo "ok   exposure check flags open defaults before 0007"

# 7. After 0007: the check is clean, and real new objects created by postgres are closed to the
#    public roles but still usable by service_role.
psql_run pre7 --single-transaction < migrations/0007_default_privileges.sql
out=$(findings pre7)
[[ -z "$out" ]] || { echo "FAIL exposure check after 0007:"; echo "$out"; exit 1; }
psql_run pre7 -c "create table public.later (id int)" -c "create sequence public.later_seq" \
  -c "create function public.later_fn() returns int language sql as 'select 1'"
[[ "$(psql_run pre7 -tAc "select has_table_privilege('anon','public.later','select') or has_table_privilege('authenticated','public.later','insert')
  or has_sequence_privilege('anon','public.later_seq','usage') or has_function_privilege('anon','public.later_fn()','execute')
  or has_function_privilege('authenticated','public.later_fn()','execute')")" == f ]] \
  || { echo "FAIL new objects still open after 0007"; exit 1; }
[[ "$(psql_run pre7 -tAc "select has_table_privilege('service_role','public.later','select,insert')")" == t ]] \
  || { echo "FAIL service_role lost its default grant"; exit 1; }
echo "ok   0007 closes new objects; service_role keeps access"

# 8. The exposure check flags an existing open object (a table that slipped through with a grant).
psql_run pre7 -c "grant select on public.later to anon"
out=$(findings pre7)
[[ "$out" == *"public.later"*"anon"* ]] || { echo "FAIL exposure check missed an open table:"; echo "$out"; exit 1; }
psql_run pre7 -c "drop table public.later; drop sequence public.later_seq; drop function public.later_fn()"
echo "ok   exposure check flags an open existing table"

# 8b. ...a column-level grant (has_table_privilege alone doesn't see it).
psql_run pre7 -c "grant select (username) on public.users to anon"
out=$(findings pre7)
[[ "$out" == *"public.users"*"anon"* ]] || { echo "FAIL exposure check missed a column grant:"; echo "$out"; exit 1; }
psql_run pre7 -c "revoke select (username) on public.users from anon"
echo "ok   exposure check flags a column-level grant"

# 8c. ...a foreign table (no RLS possible), and an extension installed in public.
psql_run pre7 -c "create extension postgres_fdw; create server loop foreign data wrapper postgres_fdw;
  create foreign table public.ft (id int) server loop; create extension citext schema public"
out=$(findings pre7)
[[ "$out" == *"foreign table|public.ft"* && "$out" == *"extension in public|citext"* ]] \
  || { echo "FAIL exposure check missed a foreign table or extension:"; echo "$out"; exit 1; }
psql_run pre7 -c "drop foreign table public.ft; drop server loop; drop extension postgres_fdw; drop extension citext"
[[ -z "$(findings pre7)" ]] || { echo "FAIL leftovers after 8c"; exit 1; }
echo "ok   exposure check flags a foreign table and an extension in public"

# 8d. Run as a role that can't create in public: the probe is reported as skipped, and the other
#     sections still run (a planted open table is still found).
psql_run pre7 -c "create role no_create; create table public.leak (id int); alter table public.leak enable row level security; grant select on public.leak to anon"
out=$(findings pre7 no_create)
[[ "$out" == *"probe skipped"* && "$out" == *"public.leak"*"anon"* ]] \
  || { echo "FAIL probe-skip path:"; echo "$out"; exit 1; }
psql_run pre7 -c "drop table public.leak; drop role no_create"
echo "ok   probe skipped without CREATE; other checks still run"

# 9. Default privileges are per creating role: another role's defaults are untouched by 0007, and
#    the check, run as that role, says so. (This is why 0007 names `postgres` explicitly.)
psql_run pre7 -c "create role other_creator; grant create, usage on schema public to other_creator" \
  -c "alter default privileges for role other_creator in schema public grant all on tables to anon"
out=$(findings pre7 other_creator)
[[ "$out" == *"new tables"*"other_creator"* ]] || { echo "FAIL per-role control:"; echo "$out"; exit 1; }
echo "ok   per-role defaults: other roles unaffected, and the check reports it"

# 10. supabase_admin: changed when permitted, skipped with a notice when the role doesn't exist.
fresh_db sbadmin
psql_run sbadmin -c "create role supabase_admin" \
  -c "alter default privileges for role supabase_admin in schema public grant all on tables to anon, authenticated"
migrate sbadmin 0007
[[ "$(psql_run sbadmin -tAc "select count(*) from pg_default_acl d, aclexplode(d.defaclacl) a
  where d.defaclrole = 'supabase_admin'::regrole and a.grantee = 'anon'::regrole")" == 0 ]] \
  || { echo "FAIL supabase_admin defaults not revoked"; exit 1; }
echo "ok   supabase_admin defaults revoked when permitted"

# --- 0008_onchain_events -------------------------------------------------------------------------

sr() { psql_run "$1" -tA -c "set role service_role" -c "$2"; } # as the API
T1=11111111-1111-1111-1111-111111111111
T2=22222222-2222-2222-2222-222222222222
EV="insert into onchain_events (block_number, log_index, tx_hash, event, node, to_address)
  values (48167400, 3, '0x$(printf 'a%.0s' {1..64})', 'Transfer', '0x$(printf 'b%.0s' {1..64})', '0x$(printf 'c%.0s' {1..40})')"

# 11. Production-like path (0001..0008 under the old blanket grants): nothing new is exposed.
fresh_db onchain
psql_run onchain < tests/legacy_default_grants.sql
migrate onchain 0008
out=$(findings onchain)
[[ -z "$out" ]] || { echo "FAIL exposure check after 0008:"; echo "$out"; exit 1; }
[[ "$(psql_run onchain -tAc "select has_table_privilege('anon','onchain_events','select') or has_table_privilege('authenticated','onchain_sync_state','update')
  or has_function_privilege('anon','onchain_sync_try_lease(uuid,integer)','execute')")" == f ]] \
  || { echo "FAIL 0008 objects open to the public roles"; exit 1; }
echo "ok   0008 exposes nothing"

# 12. Seeded cursor: the block before the v0.2 deployment, not genesis.
[[ "$(psql_run onchain -tAc "select last_synced_block from onchain_sync_state")" == 48167394 ]] \
  || { echo "FAIL cursor not seeded to the deploy block"; exit 1; }
echo "ok   cursor seeded to the v0.2 deploy block"

# 13. Idempotent sync: the same event twice is one row (as the API inserts: on conflict do nothing).
sr onchain "$EV on conflict do nothing" >/dev/null
sr onchain "$EV on conflict do nothing" >/dev/null
[[ "$(psql_run onchain -tAc "select count(*) from onchain_events")" == 1 ]] || { echo "FAIL duplicate event row"; exit 1; }
#     Control: without the conflict clause the primary key refuses it, so the count above means something.
if sr onchain "$EV" >/dev/null 2>"$ERR"; then echo "FAIL duplicate accepted"; exit 1; fi
grep -q "duplicate key" "$ERR" || { echo "FAIL unexpected error:"; cat "$ERR"; exit 1; }
echo "ok   re-syncing a range inserts nothing twice"

# 14. CHECKs refuse what the API never writes (mixed-case hex, unknown event).
for bad in "upper(node)" "'Transfer2'"; do
  col=$([[ "$bad" == "upper(node)" ]] && echo node || echo event)
  if sr onchain "insert into onchain_events (block_number, log_index, tx_hash, event, node)
      select 1, 1, tx_hash, $([[ $col == event ]] && echo "$bad" || echo event), $([[ $col == node ]] && echo "$bad" || echo node) from onchain_events limit 1" \
      >/dev/null 2>"$ERR"; then echo "FAIL CHECK accepted bad $col"; exit 1; fi
  grep -q "violates check constraint" "$ERR" || { echo "FAIL unexpected error:"; cat "$ERR"; exit 1; }
done
echo "ok   CHECKs refuse bad hex and unknown events"

# 15. Lease: held by one token, refused to another, renewed and released.
[[ "$(sr onchain "select onchain_sync_try_lease('$T1', 60)")" == 48167394 ]] || { echo "FAIL first lease"; exit 1; }
[[ -z "$(sr onchain "select onchain_sync_try_lease('$T2', 60)")" ]] || { echo "FAIL second holder got the lease"; exit 1; }
[[ "$(sr onchain "select onchain_sync_try_lease('$T1', 60)")" == 48167394 ]] || { echo "FAIL holder can't renew"; exit 1; }
[[ -z "$(sr onchain "select onchain_sync_advance('$T2', 48169999, 60)")" ]] || { echo "FAIL non-holder advanced"; exit 1; }
[[ "$(sr onchain "select onchain_sync_advance('$T1', 48168000, 60)")" == t ]] || { echo "FAIL holder can't advance"; exit 1; }
sr onchain "select onchain_sync_advance('$T1', 48167500, 60)" >/dev/null # backwards: ignored
[[ "$(psql_run onchain -tAc "select last_synced_block from onchain_sync_state")" == 48168000 ]] \
  || { echo "FAIL cursor moved backwards or a non-holder moved it"; exit 1; }
sr onchain "select onchain_sync_release('$T2')" >/dev/null # not the holder: no effect
[[ -z "$(sr onchain "select onchain_sync_try_lease('$T2', 60)")" ]] || { echo "FAIL a non-holder released the lease"; exit 1; }
sr onchain "select onchain_sync_release('$T1')" >/dev/null
[[ "$(sr onchain "select onchain_sync_try_lease('$T2', 1)")" == 48168000 ]] || { echo "FAIL lease not free after release"; exit 1; }
echo "ok   lease: exclusive, renewable, forward-only, released by its holder only"

# 16. An expired lease is taken over, and the old holder can no longer advance.
psql_run onchain -c "update onchain_sync_state set lease_until = now() - interval '1 second'"
[[ "$(sr onchain "select onchain_sync_try_lease('$T1', 60)")" == 48168000 ]] || { echo "FAIL expired lease not taken over"; exit 1; }
[[ -z "$(sr onchain "select onchain_sync_advance('$T2', 48169000, 60)")" ]] || { echo "FAIL expired holder advanced"; exit 1; }
echo "ok   expired lease taken over; the old holder is locked out"

# 17. Fresh project (no legacy grants): service_role works from the migrations alone.
fresh_db onchainfresh
migrate onchainfresh 0008
sr onchainfresh "$EV on conflict do nothing" >/dev/null
[[ "$(sr onchainfresh "select onchain_sync_try_lease('$T1', 60)")" == 48167394 ]] || { echo "FAIL fresh-project lease"; exit 1; }
[[ -z "$(findings onchainfresh)" ]] || { echo "FAIL exposure check on a fresh project after 0008"; exit 1; }
echo "ok   0008 on a fresh project"

echo "ALL SCENARIOS PASSED"
