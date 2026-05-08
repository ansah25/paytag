-- Enforce one-username-per-wallet at the database level.
--
-- The application already pre-checks this in registerUsername, but without a
-- DB constraint two concurrent registrations from the same wallet for
-- different names could both succeed. This migration also normalises
-- owner_wallet to lowercase so EVM-address case variations cannot bypass
-- uniqueness ("0xABC..." vs "0xabc...").

-- 1. Backfill: normalise existing values to lowercase before adding the check.
update users
set owner_wallet = lower(owner_wallet)
where owner_wallet <> lower(owner_wallet);

-- 2. Fail loud if real duplicates already exist. Refuse to silently pick a
--    winner — an operator must hand-resolve before re-running.
do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count from (
    select owner_wallet from users group by owner_wallet having count(*) > 1
  ) d;
  if dup_count > 0 then
    raise exception
      'Cannot add unique(owner_wallet): % wallet(s) already own multiple usernames. Resolve manually before re-running.',
      dup_count;
  end if;
end $$;

-- 3. Unique constraint + lowercase invariant.
alter table users
  add constraint users_owner_wallet_unique unique (owner_wallet);

alter table users
  add constraint users_owner_wallet_lower check (owner_wallet = lower(owner_wallet));

-- 4. The functional index on lower(owner_wallet) becomes redundant once the
--    column itself is constrained to lowercase and uniquely indexed by the
--    constraint above.
drop index if exists users_owner_wallet_idx;
