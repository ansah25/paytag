-- Read-only (everything it creates is rolled back). Run in the Supabase SQL editor after any
-- migration that adds a table, view, sequence, function or extension.
--
-- The invariant: only the API (service_role) uses this database, so in schema public the public
-- roles (anon, authenticated, PUBLIC) can do nothing, and nothing routes around that.
-- EVERY ROW RETURNED IS A FINDING. An empty result is the pass.
--
-- Objects owned by an extension are not listed one by one (postgres can't change their grants,
-- and PostGIS alone has hundreds); instead every extension installed in public is a finding of its
-- own, since its functions are reachable through PostgREST's /rpc.

create temp table if not exists exposure_findings (kind text, object text, detail text);
truncate exposure_findings;

do $$
declare
  probe_table boolean;
  probe_seq boolean;
  probe_fn boolean;
begin
  -- 1. What a NEW object would get: create probes as the current role (the one migrations run as),
  --    ask what anon/authenticated could do with them, then roll the probes back.
  begin
    create table public.__exposure_probe (id int);
    create sequence public.__exposure_probe_seq;
    create function public.__exposure_probe_fn() returns int language sql as 'select 1';
    probe_table := has_table_privilege('anon', 'public.__exposure_probe', 'select,insert,update,delete,truncate,references,trigger')
                or has_table_privilege('authenticated', 'public.__exposure_probe', 'select,insert,update,delete,truncate,references,trigger');
    probe_seq := has_sequence_privilege('anon', 'public.__exposure_probe_seq', 'usage,select,update')
              or has_sequence_privilege('authenticated', 'public.__exposure_probe_seq', 'usage,select,update');
    probe_fn := has_function_privilege('anon', 'public.__exposure_probe_fn()', 'execute')
             or has_function_privilege('authenticated', 'public.__exposure_probe_fn()', 'execute');
    raise exception using errcode = 'P0001', message = '__rollback_probes__';
  exception
    when raise_exception then
      if sqlerrm <> '__rollback_probes__' then raise; end if;
    when insufficient_privilege or duplicate_table or duplicate_function then
      insert into exposure_findings values ('probe skipped', 'default privileges',
        format('could not create probe objects as %s (%s); run as postgres. The other checks still ran.', current_user, sqlerrm));
  end;
  if probe_table then insert into exposure_findings values ('default privileges', 'new tables', format('a table created by %s is open to anon/authenticated', current_user)); end if;
  if probe_seq then insert into exposure_findings values ('default privileges', 'new sequences', format('a sequence created by %s is open to anon/authenticated', current_user)); end if;
  if probe_fn then insert into exposure_findings values ('default privileges', 'new functions', format('a function created by %s is executable by anon/authenticated', current_user)); end if;
end $$;

with ext as (
  select objid from pg_depend where deptype = 'e'
),
rel as (
  select c.oid, c.relname, c.relkind,
         case c.relkind when 'S' then has_sequence_privilege('anon', c.oid, 'usage,select,update')
              else has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
                   or has_any_column_privilege('anon', c.oid, 'select,insert,update,references') end as anon_open,
         case c.relkind when 'S' then has_sequence_privilege('authenticated', c.oid, 'usage,select,update')
              else has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger')
                   or has_any_column_privilege('authenticated', c.oid, 'select,insert,update,references') end as auth_open
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    and c.oid not in (select objid from ext)
)
insert into exposure_findings
-- 2. Existing tables, views, materialized views, foreign tables, sequences the public roles can
--    touch, at table or column level.
select case relkind when 'r' then 'table' when 'p' then 'table' when 'v' then 'view'
                    when 'm' then 'materialized view' when 'f' then 'foreign table' else 'sequence' end,
       format('public.%I', relname),
       'open to ' || concat_ws(', ', case when anon_open then 'anon' end, case when auth_open then 'authenticated' end)
from rel
where anon_open or auth_open
union all
-- 3. Tables with RLS off (one stray grant away from public), and foreign tables (which can't have
--    RLS at all).
select case c.relkind when 'f' then 'foreign table' else 'table without RLS' end, format('public.%I', c.relname),
       case c.relkind when 'f' then 'foreign tables cannot have row level security' else 'row level security is disabled' end
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'f')
  and (c.relkind = 'f' or not c.relrowsecurity) and c.oid not in (select objid from ext)
union all
-- 4. Views and materialized views at all: the API uses none, so any is worth a look.
select case c.relkind when 'v' then 'view' else 'materialized view' end, format('public.%I', c.relname),
       'the API uses no views; check it doesn''t expose a locked table'
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm') and c.oid not in (select objid from ext)
union all
-- 5. Functions in public the public roles can execute (PostgREST exposes these as /rpc).
select case when p.prosecdef then 'security definer function' else 'function' end,
       format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
       'executable by ' || concat_ws(', ',
         case when has_function_privilege('anon', p.oid, 'execute') then 'anon' end,
         case when has_function_privilege('authenticated', p.oid, 'execute') then 'authenticated' end)
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.oid not in (select objid from ext)
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
union all
-- 6. Extensions installed in public: their functions are callable through /rpc (e.g. `http` makes
--    the database fetch arbitrary URLs). Install extensions into the `extensions` schema instead.
select 'extension in public', e.extname, 'its objects live in public; reinstall it in schema extensions'
from pg_extension e
where e.extnamespace = 'public'::regnamespace;

select * from exposure_findings order by kind, object;
