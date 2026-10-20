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

-- 2. Views, materialized views or SECURITY DEFINER functions that would keep exposing
--    users/wallet_mappings (same query as the migration's guard). A function that only touches
--    auth.users (e.g. a handle_new_user trigger) is ignored.
with t as (
  select c.oid as rel, c.reltype as typ from pg_class c
  where c.oid in ('public.users'::regclass, 'public.wallet_mappings'::regclass)
)
-- Views and materialized views, any schema, any owner.
select format('%s %I.%I', case v.relkind when 'm' then 'materialized view' else 'view' end, vn.nspname, v.relname) as x
from pg_depend d
join pg_rewrite r on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid
join pg_class v on v.oid = r.ev_class
join pg_namespace vn on vn.oid = v.relnamespace
where d.refclassid = 'pg_class'::regclass and d.refobjid in (select rel from t)
  and v.oid not in (select rel from t)
union all
-- SECURITY DEFINER functions: a recorded dependency (SQL-standard BEGIN ATOMIC bodies, row-type
-- arguments or results) or the table name in the body text (plpgsql and plain SQL bodies record
-- none). Supabase's own auth.users doesn't count.
select format('function %I.%I', n.nspname, p.proname)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime',
                        'extensions', 'graphql', 'graphql_public', 'pgsodium', 'vault',
                        'supabase_functions', 'net', 'cron', 'pgbouncer')
  and (
    exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid
        and ((d.refclassid = 'pg_class'::regclass and d.refobjid in (select rel from t))
          or (d.refclassid = 'pg_type'::regclass and d.refobjid in (select typ from t)))
    )
    or regexp_replace(coalesce(p.prosrc, ''), 'auth\s*\.\s*"?users"?', '', 'gi') ~* '\m(users|wallet_mappings)\M'
  );

-- 3. For reference: what the public roles can do today (expect rows before, none after).
select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('users', 'wallet_mappings', 'auth_nonces')
  and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
group by grantee, table_name
order by table_name, grantee;
