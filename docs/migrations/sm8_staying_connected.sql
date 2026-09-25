-- ServiceM8: staying connected.
--
-- ONE WORKSPACE PER SERVICEM8 ACCOUNT. ServiceM8's limit (180 a minute,
-- 20,000 a day) is per account, and two workspaces writing to one account
-- would double every note. The callback refuses by query; this index is the
-- backstop for two connects at once. Partial: Xero keeps #359's "shown, not
-- blocked", and a nameless row can't be compared.
--
-- WHERE THE ACCOUNT CHANGED FROM, for the owner's screen after a reconnect
-- to a different account cleared the copy and switched sending off.
--
-- A REFRESH CLAIM. ServiceM8 rotates the refresh token on every use; two
-- servers refreshing at once would spend it twice. One refreshes, the other
-- waits for its result.
--
-- APPLY BEFORE THE DEPLOY. The code reads all three defensively: without
-- them the switch notice falls back to "Connected to X.", refreshes go
-- unclaimed as they do today, and the callback still refuses a held account
-- by query. Additive and idempotent: safe to run twice.
--
-- TWO READ-ONLY CHECKS FIRST.
--
-- 1. No account is already held twice (expect no rows; if there are, the
--    index below fails loudly and nothing is half-applied):
--      select tenant_id, count(*) from public.integration_connections
--      where provider = 'servicem8' and tenant_id is not null
--      group by tenant_id having count(*) > 1;
--
-- 2. Every connection names the account its mirror holds (expect no rows).
--    The first sync after the deploy compares the two, and a mismatch reads
--    as a change of account: it clears that workspace's mirror and switches
--    its sending off.
--      select c.org_id, c.tenant_id, v.uuid
--      from public.integration_connections c
--      join public.sm8_vendor v on v.org_id = c.org_id
--      where c.provider = 'servicem8' and c.tenant_id <> v.uuid;
--
-- ROLLBACK: drop index if exists public.integration_connections_sm8_account_uniq;
-- The columns are inert without the code.

alter table public.integration_connections
  add column if not exists account_changed_at    timestamptz,
  add column if not exists account_changed_from  text,
  add column if not exists refresh_claimed_until timestamptz;

create unique index if not exists integration_connections_sm8_account_uniq
  on public.integration_connections (tenant_id)
  where provider = 'servicem8' and tenant_id is not null;
