-- Revocable sessions.
--
-- JWTs carry the account's session_version when issued; the API refuses a token whose version no
-- longer matches. POST /auth/logout-all bumps it, which signs the account out everywhere.
--
-- Safe to run before deploying the API that uses it: it only adds a column with a default.

alter table users add column if not exists session_version integer not null default 0;
