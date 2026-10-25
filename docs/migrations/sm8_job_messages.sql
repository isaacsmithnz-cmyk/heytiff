-- The customer's texts and emails on each job: ServiceM8's read-only job
-- communication history (sms.json and email.json, scopes read_sms and
-- read_email, the May 2026 API update), inbound and outbound merged. Isaac,
-- 25 October 2026: "on service, mate, you can see the customer conversation.
-- Like email replies, email sent … I think we're actually missing this."
--
-- Inherits sm8_mirror.sql: disposable cache, natural key (org_id, uuid),
-- ServiceM8-native fields TEXT (a malformed uuid degrades a column, it can't
-- fail a 400-row upsert), RLS on with no policies, wiped on disconnect and on
-- a change of account by SM8_WIPE_TABLES / SM8_ACCOUNT_RESET_TABLES, which
-- map over SM8_OBJECTS (both kinds name this one table).
--
-- THE RECORD IS KEPT WHOLE. ServiceM8 documents these endpoints' filters, not
-- their fields, so `raw` is the record exactly as sent, and only the four
-- names the update documents are lifted out — each null when absent. What a
-- job's conversation shows is chosen from the keys the first real read
-- brings, not guessed now. `kind` is HeyTiff's: which endpoint it came from.
--
-- NO edit_date, AND SO NO KEEP-NEWER GUARD (sm8_calls_echo_freshness.sql):
-- these endpoints have no edit-date filter, so every walk reads the whole
-- history by cursor and upserts it (sm8-sync-plan, MESSAGE_REREAD_MS).
--
-- APPLY BEFORE THE DEPLOY. Additive and idempotent; the code on main never
-- reads it. Without it, the new code's sms and email walks fail to store
-- ("A page couldn't be stored") and the other objects walk on.
--
-- CHECKS, AFTER:
--   select count(*) from information_schema.columns
--     where table_name = 'sm8_job_messages';                         -- 8
--   select relrowsecurity from pg_class where relname = 'sm8_job_messages';  -- t

create table if not exists public.sm8_job_messages (
  org_id              uuid not null references public.organizations(id) on delete cascade,
  uuid                text not null,
  kind                text not null check (kind in ('sms', 'email')),
  direction           text,
  related_object      text,
  related_object_uuid text,
  raw                 jsonb not null,
  synced_at           timestamptz not null default now(),
  primary key (org_id, uuid)
);

-- a job's conversation is read by the record it hangs off, like notes
create index if not exists sm8_job_messages_related_idx
  on public.sm8_job_messages (org_id, related_object_uuid);

alter table public.sm8_job_messages enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)
