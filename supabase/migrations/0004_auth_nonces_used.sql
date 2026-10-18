-- Spent sign-in nonces.
--
-- Sign-in nonces are now stateless (issued with a MAC, nothing stored), so requesting one can no
-- longer overwrite or evict anyone else's. Single use is enforced by recording each nonce when a
-- sign-in succeeds; the primary key lets exactly one sign-in through per nonce. The API forgets
-- rows once they're older than the nonce lifetime (with a wide margin), so the table only holds
-- recent successful sign-ins.
--
-- Safe to run before deploying the API that uses it: it only adds a table. auth_nonces is unused
-- by that API and is dropped in a later migration.

create table if not exists auth_nonces_used (
  wallet_address text not null check (wallet_address = lower(wallet_address)),
  nonce text not null check (nonce ~ '^[0-9a-f]{80}$'),
  used_at timestamptz not null default now(),
  primary key (wallet_address, nonce)
);

create index if not exists auth_nonces_used_used_at_idx on auth_nonces_used (used_at);

alter table auth_nonces_used enable row level security;

-- New tables aren't granted to the Data API roles automatically (Supabase change, enforced
-- 2026-10-30): grant the API's service_role explicitly; the public roles get nothing.
grant select, insert, delete on table auth_nonces_used to service_role;
revoke all on table auth_nonces_used from anon, authenticated;
