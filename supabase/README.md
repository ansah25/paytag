# Database

Supabase Postgres. Only the API touches it, as `service_role` (`src/config/supabase.ts`). The web app, SDK and indexer never do, and no anon key is used anywhere.

## Rules for migrations

- **Nothing in `public` is granted to `anon`, `authenticated` or `PUBLIC`.** Migration 0006 locked down the existing tables. Migration 0007 makes new tables, sequences and functions start private. A migration that adds an object grants `service_role` exactly what the API needs, and nothing else.
- **CHECK constraints are looser than or equal to the API's validation, never stricter.** The API is the gate and the database is the backstop. A CHECK that's tighter by one character turns a valid write into a 500 (see 0006).
- **Test in Docker before running in production:** `bash supabase/tests/run.sh`.
  - Add scenarios for each new migration.
  - Include a control that proves each check can fail, because a check that can't fail looks like protection.
- **Functions `postgres` creates are executable by nobody else by default, in any schema** (0007 revokes PUBLIC's EXECUTE globally). If `service_role` must call one (e.g. a column DEFAULT or CHECK uses it), grant EXECUTE explicitly. Triggers don't need it.
- **Install extensions into the `extensions` schema, not `public`.** Their functions would otherwise be callable through PostgREST's `/rpc`.
- **After running a migration that adds a table, sequence, view, function or extension,** run `ops/exposure_check.sql` in the SQL editor. Every row it returns is a finding, and an empty result is the pass.

## Running migrations

Paste each file from `migrations/` into the Supabase SQL editor, in order. The editor runs the whole file as one transaction. Some migrations have operator scripts in `ops/`:

| File | When |
|---|---|
| `ops/0006_preflight.sql` | Before 0006. Lists rows that would fail its CHECKs and objects that would bypass the lockdown. |
| `ops/0006_rollback.sql` | Emergency undo of 0006. Re-opens the public reads. |
| `ops/exposure_check.sql` | After any migration that adds an object. Checks the "API only" invariant. |
