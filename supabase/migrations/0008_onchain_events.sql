-- On-chain events for the list endpoints (names by owner, names pointing at an address), replacing
-- the Ponder indexer. Additive only.
--
-- Lookups (/onchain/resolve, /available, /reverse) read the contracts directly and never use this.
-- The lists can't be answered from contract state (the contracts can't enumerate), so the API
-- keeps the three events they need here and catches up lazily when a list is requested. Every
-- listed name is re-checked against live contract state before it is returned, so this table only
-- has to contain the candidates: a stale or reorged row can hide nothing and add nothing.
--
-- Sync state is a single row, shared by every API machine. The lease columns replace an advisory
-- lock: PostgREST runs each call as its own transaction on a pooled connection, so a session lock
-- would stay on whichever connection took it. The lease is taken and released with conditional
-- UPDATEs (database clock), and expires by itself if a machine dies mid-sync.
--
-- CHECKs are looser than or equal to what the API writes (it lowercases every hex value). The
-- functions pin search_path, so an object planted earlier on the path can't shadow the table.
-- After running this, run supabase/ops/exposure_check.sql: every row it returns is a finding.

create table onchain_events (
  block_number    bigint  not null check (block_number >= 0),
  log_index       integer not null check (log_index >= 0),
  tx_hash         text    not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  event           text    not null check (event in ('NameRegistered', 'Transfer', 'RecordSet')),
  node            text    not null check (node ~ '^0x[0-9a-f]{64}$'),
  -- NameRegistered: the name and its block's time (the registration time, which isn't in state).
  name            text,
  block_timestamp bigint  check (block_timestamp >= 0),
  -- Transfer (the mint included): from / to. NameRegistered: to = the first owner.
  from_address    text    check (from_address ~ '^0x[0-9a-f]{40}$'),
  to_address      text    check (to_address ~ '^0x[0-9a-f]{40}$'),
  -- RecordSet: coin type and raw record bytes.
  coin_type       numeric(78, 0) check (coin_type >= 0),
  value           text    check (value ~ '^0x([0-9a-f]{2})*$'),
  -- Re-syncing a range inserts nothing twice.
  primary key (block_number, log_index)
);

-- Names by owner: the Transfers that sent a name to an address.
create index onchain_events_transfers_to on onchain_events (to_address) where event = 'Transfer';
-- Names pointing at an address: ETH records (coin type 60) by value.
create index onchain_events_eth_records on onchain_events (value) where event = 'RecordSet' and coin_type = 60;
-- A node's registration (name and registeredAt).
create index onchain_events_registrations on onchain_events (node) where event = 'NameRegistered';

create table onchain_sync_state (
  id                boolean primary key default true check (id), -- exactly one row
  -- Every block up to and including this one is in onchain_events.
  last_synced_block bigint      not null check (last_synced_block >= 0),
  lease_token       uuid,
  lease_until       timestamptz not null default '-infinity',
  updated_at        timestamptz not null default now()
);

-- Contracts v0.2 were deployed at block 48167395 (src/onchain/deployment.ts); nothing before it.
insert into onchain_sync_state (last_synced_block) values (48167394);

alter table onchain_events enable row level security;
alter table onchain_sync_state enable row level security;

-- Takes the lease for p_seconds if it is free, expired, or already this token's. Returns the
-- cursor when taken, null when another holder has it (the caller skips the sync).
create function onchain_sync_try_lease(p_token uuid, p_seconds integer)
returns bigint
language sql
set search_path = public
as $$
  update onchain_sync_state
     set lease_token = p_token,
         lease_until = now() + make_interval(secs => least(greatest(p_seconds, 1), 600))
   where id and (lease_until < now() or lease_token = p_token)
  returning last_synced_block;
$$;

-- Moves the cursor forward (never back) and extends the lease, only for a live holder. False when
-- the lease was lost (expired and taken by another machine): the caller must stop.
create function onchain_sync_advance(p_token uuid, p_block bigint, p_seconds integer)
returns boolean
language sql
set search_path = public
as $$
  update onchain_sync_state
     set last_synced_block = greatest(last_synced_block, p_block),
         lease_until = now() + make_interval(secs => least(greatest(p_seconds, 1), 600)),
         updated_at = now()
   where id and lease_token = p_token and lease_until >= now()
  returning true;
$$;

create function onchain_sync_release(p_token uuid)
returns void
language sql
set search_path = public
as $$
  update onchain_sync_state set lease_token = null, lease_until = '-infinity'
   where id and lease_token = p_token;
$$;

-- Only the API (service_role) touches these. Revoke first in case the project's default
-- privileges predate 0007.
revoke all on table onchain_events, onchain_sync_state from anon, authenticated, public;
revoke all on function onchain_sync_try_lease(uuid, integer), onchain_sync_advance(uuid, bigint, integer),
  onchain_sync_release(uuid) from anon, authenticated, public;

grant usage on schema public to service_role;
grant select, insert on table onchain_events to service_role;
grant select, update on table onchain_sync_state to service_role;
grant execute on function onchain_sync_try_lease(uuid, integer), onchain_sync_advance(uuid, bigint, integer),
  onchain_sync_release(uuid) to service_role;
