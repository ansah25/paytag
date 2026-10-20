-- Undo migrations/0006_lockdown.sql. Only for an emergency: it re-opens the public read policies
-- the audit flagged. Run in the Supabase SQL editor.

-- CHECK constraints.
alter table wallet_mappings drop constraint if exists wallet_mappings_chain_known;
alter table wallet_mappings drop constraint if exists wallet_mappings_address_shape;
alter table users drop constraint if exists users_owner_wallet_format;
alter table address_verification_nonces drop constraint if exists address_verification_nonces_chain_known;

-- auth_nonces, recreated empty (as in 0001) so an API build from before PR #22 can still start.
create table if not exists auth_nonces (
  wallet_address text primary key,
  nonce text not null,
  created_at timestamptz not null default now()
);
alter table auth_nonces enable row level security;
grant select, insert, update, delete on table auth_nonces to service_role;

-- The public reads, as before. Only select: the old blanket grants included writes that RLS
-- blocked anyway, and on a project without them `grant all` would add TRUNCATE (not subject to RLS).
grant select on table users, wallet_mappings to anon, authenticated;

drop policy if exists users_public_read on users;
create policy users_public_read on users for select using (true);

drop policy if exists wallet_mappings_public_read on wallet_mappings;
create policy wallet_mappings_public_read on wallet_mappings for select using (true);
