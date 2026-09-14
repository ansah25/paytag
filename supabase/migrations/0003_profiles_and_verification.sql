-- Public profile fields and per-address ownership verification.

-- 1. Profile fields shown on the public page (/[username]).
alter table users
  add column if not exists display_name text,
  add column if not exists bio text,
  add column if not exists avatar_url text;

alter table users drop constraint if exists users_display_name_length;
alter table users
  add constraint users_display_name_length
  check (display_name is null or char_length(display_name) <= 40);

alter table users drop constraint if exists users_bio_length;
alter table users
  add constraint users_bio_length
  check (bio is null or char_length(bio) <= 120);

-- 2. Proof that the user controls a mapped address. Null means unverified.
--    The API resets it whenever the address for a chain changes.
alter table wallet_mappings
  add column if not exists verified_at timestamptz;

-- The owner wallet already proved control by signing in, so its default
-- ethereum mapping counts as verified. (Both columns are stored lowercase.)
update wallet_mappings m
set verified_at = u.created_at
from users u
where m.user_id = u.id
  and m.chain = 'ethereum'
  and m.address = u.owner_wallet
  and m.verified_at is null;

-- 3. Single-use verification challenges. Server-only, like auth_nonces: RLS on
--    and no policies, so only the service role can read or write them.
create table if not exists address_verification_nonces (
  user_id uuid not null references users(id) on delete cascade,
  chain text not null,
  address text not null,
  nonce text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, chain)
);

alter table address_verification_nonces enable row level security;

-- New tables are no longer granted to the Data API roles automatically
-- (Supabase change, enforced 2026-10-30). The API talks to this table as
-- service_role through supabase-js, so grant that explicitly; the public
-- roles get nothing (RLS with no policies would deny them anyway).
grant select, insert, update, delete on table address_verification_nonces to service_role;
revoke all on table address_verification_nonces from anon, authenticated;
