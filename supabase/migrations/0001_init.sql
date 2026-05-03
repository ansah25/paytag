-- Paytag initial schema
-- Tables: users, wallet_mappings, auth_nonces

create extension if not exists "uuid-ossp";

create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  username text not null unique,
  owner_wallet text not null,
  created_at timestamptz not null default now(),
  constraint users_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint users_username_lower check (username = lower(username))
);

create index if not exists users_owner_wallet_idx on users (lower(owner_wallet));

create table if not exists wallet_mappings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  chain text not null,
  address text not null,
  created_at timestamptz not null default now(),
  unique (user_id, chain)
);

create index if not exists wallet_mappings_user_id_idx on wallet_mappings (user_id);

create table if not exists auth_nonces (
  wallet_address text primary key,
  nonce text not null,
  created_at timestamptz not null default now()
);

-- Row-Level Security
-- Backend uses service role key which bypasses RLS.
-- These policies are for any future direct client access.
alter table users enable row level security;
alter table wallet_mappings enable row level security;
alter table auth_nonces enable row level security;

-- Public read on users + wallet_mappings (resolution is public)
drop policy if exists users_public_read on users;
create policy users_public_read on users for select using (true);

drop policy if exists wallet_mappings_public_read on wallet_mappings;
create policy wallet_mappings_public_read on wallet_mappings for select using (true);

-- auth_nonces is server-only; no public policies
