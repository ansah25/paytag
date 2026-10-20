-- Before 2026-10-30 Supabase granted every new public table to all three API roles. Production's
-- original tables were created that way, so this reproduces their starting privileges.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
