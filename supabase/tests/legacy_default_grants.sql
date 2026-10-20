-- Supabase's default privileges for objects the postgres role creates in public (as in
-- supabase/postgres:17.4.1.054): every new table, sequence and function is granted to the API
-- roles. Production's original tables were created under these, and they stay in force until
-- 0007 revokes them.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
