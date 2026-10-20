-- Stand-ins for Supabase's API roles, for testing migrations in a plain Postgres.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
