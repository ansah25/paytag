-- Assertions for migrations/0006_lockdown.sql. Run by supabase/tests/run.sh after 0001..0006.

create or replace function pg_temp.expect_error(sql text, code text, label text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlstate <> code then
      raise exception 'FAIL %: expected SQLSTATE %, got % (%)', label, code, sqlstate, sqlerrm;
    end if;
    return;
  end;
  raise exception 'FAIL %: expected SQLSTATE % but it succeeded', label, code;
end $$;

-- Public roles can do nothing with users / wallet_mappings.
set role anon;
select pg_temp.expect_error('select owner_wallet from users', '42501', 'anon select users');
select pg_temp.expect_error('select address from wallet_mappings', '42501', 'anon select wallet_mappings');
select pg_temp.expect_error($q$insert into users (username, owner_wallet) values ('anonx', '0x000000000000000000000000000000000000dead')$q$, '42501', 'anon insert users');
select pg_temp.expect_error('update wallet_mappings set address = address', '42501', 'anon update wallet_mappings');
reset role;
set role authenticated;
select pg_temp.expect_error('select owner_wallet from users', '42501', 'authenticated select users');
select pg_temp.expect_error('delete from wallet_mappings', '42501', 'authenticated delete wallet_mappings');
reset role;

-- auth_nonces is gone; public read policies are gone.
do $$ begin
  if to_regclass('public.auth_nonces') is not null then raise exception 'FAIL auth_nonces still exists'; end if;
  if exists (select 1 from pg_policies where policyname in ('users_public_read', 'wallet_mappings_public_read')) then
    raise exception 'FAIL public read policy still exists';
  end if;
end $$;

-- service_role can do everything the API does, with every address shape the API accepts
-- (canonical forms, each checked against src/utils/addresses.ts).
set role service_role;
do $$
declare
  addrs text[][] := array[
    ['ethereum', '0x000000000000000000000000000000000000dead'],
    ['solana',   'So11111111111111111111111111111111111111112'],
    ['solana',   '11111111111111111111111111111111'],
    ['solana',   '4Nd1mYz7K8jM2QpRzWxV3Y5tF7gH9JkLm2NoP4Qr5SsT'],
    ['bitcoin',  '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
    ['bitcoin',  '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
    ['bitcoin',  '1111111111111111111114oLvT2'],
    ['bitcoin',  'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
    ['bitcoin',  'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'],
    ['bitcoin',  'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'],
    ['bitcoin',  'bc1sw50qgdz25j'],
    ['bitcoin',  'bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y']
  ];
  uid uuid;
  i int;
begin
  for i in 1 .. array_length(addrs, 1) loop
    insert into users (username, owner_wallet)
      values ('tst' || i, '0x' || lpad(to_hex(i), 40, '0'))
      returning id into uid;
    -- supabase-js upsert(onConflict: user_id,chain), twice: the insert path, then the update path.
    insert into wallet_mappings (user_id, chain, address) values (uid, addrs[i][1], addrs[i][2])
      on conflict (user_id, chain) do update set address = excluded.address, verified_at = null;
    insert into wallet_mappings (user_id, chain, address) values (uid, addrs[i][1], addrs[i][2])
      on conflict (user_id, chain) do update set address = excluded.address, verified_at = null;
  end loop;
  update users set display_name = 'x', session_version = session_version + 1 where username = 'tst1';
  update wallet_mappings set verified_at = now() where chain = 'ethereum';
  perform 1 from users join wallet_mappings m on m.user_id = users.id;
  delete from wallet_mappings where chain = 'solana';
  insert into address_verification_nonces (user_id, chain, address, nonce)
    select id, 'solana', 'So11111111111111111111111111111111111111112', 'n' from users where username = 'tst2';
  if (select count(*) from wallet_mappings) <> 9 then raise exception 'FAIL service_role row count'; end if;
end $$;

-- ...and the CHECKs refuse what the API would never store.
select pg_temp.expect_error($q$insert into wallet_mappings (user_id, chain, address) select id, 'doge', 'D8xyz' from users where username = 'tst1'$q$, '23514', 'unknown chain');
select pg_temp.expect_error($q$update wallet_mappings set address = '0x000000000000000000000000000000000000DEAD' where chain = 'ethereum'$q$, '23514', 'uppercase EVM');
select pg_temp.expect_error($q$update wallet_mappings set address = 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4' where address like 'bc1qw508%'$q$, '23514', 'uppercase bech32');
select pg_temp.expect_error($q$update wallet_mappings set address = 'bc1q' where address like 'bc1qw508%'$q$, '23514', 'short bech32');
select pg_temp.expect_error($q$update wallet_mappings set address = '0x000000000000000000000000000000000000dead' where address like '1A1z%'$q$, '23514', 'EVM address on bitcoin');
select pg_temp.expect_error($q$update users set owner_wallet = '0xABC' where username = 'tst1'$q$, '23514', 'bad owner_wallet');
select pg_temp.expect_error($q$insert into address_verification_nonces (user_id, chain, address, nonce) select id, 'bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'n' from users where username = 'tst5'$q$, '23514', 'verification chain');
reset role;

select 'ALL 0006 ASSERTIONS PASSED' as result;
