-- New objects in public start closed to the public roles.
--
-- 0006 locked down the tables that existed then. But Supabase sets default privileges so that every
-- new table, sequence and function in public is granted to anon and authenticated (functions also
-- get EXECUTE through PUBLIC, Postgres's own default). A later migration creating a table would
-- quietly re-open the door. This revokes those defaults.
--
-- Default privileges are per creating role. Supabase sets them for two roles in public:
--   - postgres: the role the SQL editor and `supabase db push` run as, so it creates every object
--     our migrations make. This is the one that matters, and it must succeed.
--   - supabase_admin: used by Supabase itself (extensions). postgres isn't a member of it, so the
--     change is attempted and skipped with a notice when not permitted.
-- service_role keeps its defaults; migrations still grant it explicitly (see 0003, 0004, 0006).
--
-- After any migration that adds a table, view or function, run supabase/ops/exposure_check.sql.

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
-- EXECUTE for PUBLIC is Postgres's built-in *global* default. A per-schema entry can only add to the
-- global defaults, never remove from them, so `in schema public ... from public` would be a silent
-- no-op. Revoke it globally (functions postgres creates in any schema; our migrations make none).
alter default privileges for role postgres revoke execute on functions from public;

do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from anon, authenticated';
exception
  when insufficient_privilege or undefined_object then
    raise notice 'Skipped supabase_admin default privileges (%): objects it creates in public keep Supabase''s defaults.', sqlerrm;
end $$;
