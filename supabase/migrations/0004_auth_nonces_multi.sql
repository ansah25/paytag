-- Several sign-in nonces per wallet (was one, replaced on every request).
--
-- With one nonce per wallet, anyone could call /auth/nonce for a victim's wallet and replace the
-- nonce they were about to sign, keeping them locked out. Now each request adds a nonce, the
-- client sends back the one it signed, and the API keeps at most ten per wallet (oldest dropped)
-- and deletes expired ones.
--
-- Run before deploying the API that uses it. Existing rows are short-lived (5 minute TTL) and are
-- cleared rather than migrated.

delete from auth_nonces;

alter table auth_nonces drop constraint if exists auth_nonces_pkey;
alter table auth_nonces add primary key (wallet_address, nonce);

alter table auth_nonces
  add constraint auth_nonces_wallet_lowercase check (wallet_address = lower(wallet_address));

-- Expiry cleanup scans by age.
create index if not exists auth_nonces_created_at_idx on auth_nonces (created_at);
