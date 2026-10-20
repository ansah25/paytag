-- Per database: Supabase preinstalls uuid-ossp in schema extensions (on the search path), so
-- 0001's `create extension if not exists "uuid-ossp"` is a no-op there. Mirror that instead of
-- letting it land in public.
create schema if not exists extensions;
create extension if not exists "uuid-ossp" schema extensions;
do $$ begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end $$;
