-- Lock the tables down to the API (audit 2026-10-18, M6).
--
-- Only the API touches this database, as service_role (which bypasses RLS). The web app, SDK and
-- indexer never do, and no anon key is used anywhere. So:
--   1. drop the `using (true)` read policies that let anyone with the anon key dump
--      username/owner_wallet/addresses,
--   2. revoke every privilege the public roles (anon, authenticated) still hold,
--   3. grant service_role exactly what the API does (a fresh project wouldn't grant it at all),
--   4. drop auth_nonces (unused since sign-in nonces went stateless),
--   5. add CHECK constraints as a backstop.
--
-- CHECK principle: every constraint here is LOOSER THAN OR EQUAL TO the API's validation
-- (src/utils/addresses.ts), never stricter. The API is the gate; the database is the backstop.
-- A constraint that's too loose costs nothing (the API already rejected the input); one that's
-- tighter by a single character turns a valid write into a 500. Checksums stay in the API.
--
-- Guards at the top refuse to run (changing nothing) if existing rows would fail a CHECK, or if a
-- view or SECURITY DEFINER function would keep exposing these tables after the grants are gone.
-- Rollback: supabase/ops/0006_rollback.sql.

-- 0. Guards ----------------------------------------------------------------------------------

do $$
declare
  bad_chain int;
  bad_eth int;
  bad_sol int;
  bad_btc int;
  bad_owner int;
  bad_vchain int;
  exposures text;
begin
  select count(*) into bad_chain from wallet_mappings where chain not in ('ethereum', 'solana', 'bitcoin');
  select count(*) into bad_eth from wallet_mappings where chain = 'ethereum' and address !~ '^0x[0-9a-f]{40}$';
  select count(*) into bad_sol from wallet_mappings where chain = 'solana' and address !~ '^[A-Za-z0-9]{32,44}$';
  select count(*) into bad_btc from wallet_mappings
    where chain = 'bitcoin' and address !~ '^bc1[a-z0-9]{8,87}$' and address !~ '^[13][A-Za-z0-9]{24,40}$';
  select count(*) into bad_owner from users where owner_wallet !~ '^0x[0-9a-f]{40}$';
  select count(*) into bad_vchain from address_verification_nonces where chain not in ('ethereum', 'solana');
  if bad_chain + bad_eth + bad_sol + bad_btc + bad_owner + bad_vchain > 0 then
    raise exception
      'Rows would fail the new CHECKs (chain %, ethereum %, solana %, bitcoin %, owner_wallet %, verification chain %). Run supabase/ops/0006_preflight.sql to list them; fix by hand, then re-run.',
      bad_chain, bad_eth, bad_sol, bad_btc, bad_owner, bad_vchain;
  end if;

  -- Revoking table grants doesn't close a view or a SECURITY DEFINER function over the same rows.
  select string_agg(distinct x, ', ') into exposures from (
    select format('view %I.%I', v.table_schema, v.view_name) as x
    from information_schema.view_table_usage v
    where v.table_schema = 'public' and v.table_name in ('users', 'wallet_mappings')
    union all
    select format('function %I.%I', n.nspname, p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime',
                            'extensions', 'graphql', 'graphql_public', 'pgsodium', 'vault',
                            'supabase_functions', 'net', 'cron', 'pgbouncer')
      and p.prosrc ~* '\m(users|wallet_mappings)\M'
  ) e;
  if exposures is not null then
    raise exception 'These would still expose users/wallet_mappings after the lockdown: %. Review them first.', exposures;
  end if;
end $$;

-- 1. Public read policies ----------------------------------------------------------------------
-- RLS stays enabled with no policies: anon and authenticated are denied every row.

drop policy if exists users_public_read on users;
drop policy if exists wallet_mappings_public_read on wallet_mappings;

-- 2. Public roles get nothing ------------------------------------------------------------------

revoke all on table users, wallet_mappings from anon, authenticated;

-- 3. service_role: exactly what the API does ------------------------------------------------------
-- (upsert needs insert + update; deletes on users happen only by cascade.)

grant usage on schema public to service_role;
grant select, insert, update on table users to service_role;
grant select, insert, update, delete on table wallet_mappings to service_role;

-- 4. Unused table --------------------------------------------------------------------------------

drop table if exists auth_nonces;

-- 5. CHECK constraints (looser than or equal to the API; see the principle above) ---------------

alter table wallet_mappings drop constraint if exists wallet_mappings_chain_known;
alter table wallet_mappings
  add constraint wallet_mappings_chain_known check (chain in ('ethereum', 'solana', 'bitcoin'));

-- Per-chain shape of the stored (canonical) address.
alter table wallet_mappings drop constraint if exists wallet_mappings_address_shape;
alter table wallet_mappings
  add constraint wallet_mappings_address_shape check (
    case chain
      -- EVM: the API stores it lowercased.
      when 'ethereum' then address ~ '^0x[0-9a-f]{40}$'
      -- Base58 public key, 32 bytes -> 32..44 chars. Any alphanumerics; the API checks the alphabet.
      when 'solana' then address ~ '^[A-Za-z0-9]{32,44}$'
      -- Two separate branches; case rules differ:
      when 'bitcoin' then
        -- (a) segwit bech32/bech32m (bc1q..., bc1p...): the API stores it LOWERCASED.
        --     11..90 chars covers P2WPKH (42), P2WSH and taproot (62), and the BIP-173 max (90).
        address ~ '^bc1[a-z0-9]{8,87}$'
        -- (b) legacy base58check (1... / 3...): MIXED CASE by construction, stored byte-for-byte.
        --     The API allows 26..35 chars; this allows 25..41.
        or address ~ '^[13][A-Za-z0-9]{24,40}$'
      else false
    end
  );

alter table users drop constraint if exists users_owner_wallet_format;
alter table users
  add constraint users_owner_wallet_format check (owner_wallet ~ '^0x[0-9a-f]{40}$');

-- Only these chains can be verified (VERIFIABLE_CHAINS in src/services/verificationService.ts).
alter table address_verification_nonces drop constraint if exists address_verification_nonces_chain_known;
alter table address_verification_nonces
  add constraint address_verification_nonces_chain_known check (chain in ('ethereum', 'solana'));
