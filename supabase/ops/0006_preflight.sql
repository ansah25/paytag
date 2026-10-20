-- Read-only. Run in the Supabase SQL editor BEFORE migrations/0006_lockdown.sql.
-- Every result set should be empty. Any row listed would block (or survive) the lockdown.

-- 1. Rows that would fail the new CHECK constraints.
select 'wallet_mappings' as tbl, user_id::text as key, chain, address as value
from wallet_mappings
where chain not in ('ethereum', 'solana', 'bitcoin')
   or (chain = 'ethereum' and address !~ '^0x[0-9a-f]{40}$')
   or (chain = 'solana' and address !~ '^[A-Za-z0-9]{32,44}$')
   or (chain = 'bitcoin' and address !~ '^bc1[a-z0-9]{8,87}$' and address !~ '^[13][A-Za-z0-9]{24,40}$')
union all
select 'users', username, null, owner_wallet
from users
where owner_wallet !~ '^0x[0-9a-f]{40}$'
union all
select 'address_verification_nonces', user_id::text, chain, address
from address_verification_nonces
where chain not in ('ethereum', 'solana');

-- 2. Views or SECURITY DEFINER functions that would keep exposing users/wallet_mappings.
select 'view' as kind, v.view_schema || '.' || v.view_name as name
from information_schema.view_table_usage v
where v.table_schema = 'public' and v.table_name in ('users', 'wallet_mappings')
union all
select 'security definer function', n.nspname || '.' || p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime',
                        'extensions', 'graphql', 'graphql_public', 'pgsodium', 'vault',
                        'supabase_functions', 'net', 'cron', 'pgbouncer')
  and p.prosrc ~* '\m(users|wallet_mappings)\M';

-- 3. For reference: what the public roles can do today (expect rows before, none after).
select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('users', 'wallet_mappings', 'auth_nonces')
  and grantee in ('anon', 'authenticated', 'service_role')
group by grantee, table_name
order by table_name, grantee;
