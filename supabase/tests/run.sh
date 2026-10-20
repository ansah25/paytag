#!/usr/bin/env bash
# Runs the migrations in a throwaway Postgres and checks 0006_lockdown and 0007_default_privileges.
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

echo "ALL SCENARIOS PASSED"
