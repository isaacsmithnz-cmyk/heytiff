-- The write queue, safe to run unattended.
--
-- PAUSE. The owner's fourth setting, and HeyTiff's own when one ServiceM8
-- account is pressed more than 60 times in an hour: nothing goes, nothing
-- waiting is lost. `paused_reason` says who paused it ('owner' or 'cap');
-- `paused_at` is when, and is KEPT on resume, because the hourly cap counts
-- presses since the later of an hour ago and this.
--
-- A PERMISSION PER KIND. `write_scope_refused` is {kind: when ServiceM8
-- refused it for scope}. A kind refused since the last connect waits for a
-- reconnect; a reconnect (a newer connected_at) clears it without anything
-- having to write.
--
-- ONE ROW PER THING, a job or no job. `dedupe_key` is generated from
-- (kind, job, subject) with the job coalesced to '', so a NULL job can't
-- slip past the unique index the way it slips past (org, kind, job, subject)
-- — Postgres NULLs are distinct. The expression is sm8-write-plan's
-- dedupeKey, character for character. `subject` names the THING:
-- document:<id> today; later task:<id>:done, booking:<staff>:<start>,
-- op:<uuid> (one per update, so a second reschedule is a new row).
--
-- A CLAIM A FINISH MUST STILL HOLD. `claim_id` is set when a sender claims a
-- row; its answer is recorded only while the row still carries that claim,
-- so a sender whose lease lapsed can't write over the answer a second sender
-- recorded.
--
-- A FRESH UUID THAT REMEMBERS THE ONES IT REPLACED. A file pressed again
-- after it failed goes under a new uuid (the old one may be a dead record in
-- ServiceM8: an upload that failed half way stays "inactive and pending
-- upload"). `replaced_uuids` keeps the old ones, so they are known to be
-- ours; `verify_uuid` is an old one whose last try lost its answer, checked
-- before the new one goes so an upload that did land isn't made twice.
-- `free_retries` counts the goes a row didn't pay for (a dead record, a send
-- that ran out of time before it started); after two the row stops for a
-- person.
--
-- SERVICEM8'S OWN ERROR, KEPT SHORT, never shown on a screen:
-- `remote_code` (its errorCode) and `remote_message`.
--
-- A RECORD THAT A PERSON PRESSED: `source` ('press', the only way in) and
-- `pressed_at`, which the hourly cap counts; `requested_by_user` is the
-- Auth0 user beside `requested_by`, their staff card.
--
-- APPLY BEFORE THE DEPLOY. Old code keeps working: every new column has a
-- default or is generated, the old unique index stays, and the mode check
-- only widens. New code on a database without this degrades to holding:
-- settings it can't read hold every write and cancel nothing.
--
-- ROLLING BACK THE CODE: switch Paused to On or Off FIRST. Old code reads
-- 'paused' as off, and off cancels what is waiting. The columns are inert
-- without the code.
--
-- READ-ONLY CHECKS, BEFORE:
--   select id, kind, sm8_job_uuid, subject, status from public.sm8_writes;
--   select org_id, write_mode, tenant_id from public.integration_connections
--     where provider = 'servicem8';
-- AND AFTER (expect one row per write, key attachment:<job>:document:<id>,
-- source 'press', and the connection reading live | null | {}):
--   select dedupe_key, source, pressed_at, replaced_uuids from public.sm8_writes;
--   select write_mode, paused_reason, write_scope_refused
--     from public.integration_connections where provider = 'servicem8';
--
-- ON A SUPABASE BRANCH, NOT PROD, before merging: insert … on conflict
-- (org_id, dedupe_key) do nothing, twice, with sm8_job_uuid = null, leaves
-- one row. PostgREST's on_conflict naming a stored generated column is
-- expected to work and hasn't been proven here.
--
-- Additive and idempotent: safe to run twice.

-- ── the connection: Pause, and refusals per kind ──

alter table public.integration_connections
  drop constraint if exists integration_connections_write_mode_check;
alter table public.integration_connections
  add constraint integration_connections_write_mode_check
  check (write_mode in ('off', 'trial', 'live', 'paused'));

alter table public.integration_connections
  add column if not exists paused_reason text,
  add column if not exists paused_at timestamptz,
  add column if not exists write_scope_refused jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'integration_connections_paused_reason_check'
  ) then
    alter table public.integration_connections
      add constraint integration_connections_paused_reason_check
      check (paused_reason is null or paused_reason in ('owner', 'cap'));
  end if;
end $$;

-- ── the queue ──

alter table public.sm8_writes
  add column if not exists dedupe_key text
    generated always as (kind || ':' || coalesce(sm8_job_uuid, '') || ':' || subject) stored,
  add column if not exists source text not null default 'press',
  add column if not exists requested_by_user text,
  add column if not exists claim_id uuid,
  add column if not exists replaced_uuids text[] not null default '{}',
  add column if not exists verify_uuid text,
  add column if not exists free_retries integer not null default 0,
  add column if not exists remote_code text,
  add column if not exists remote_message text;

-- pressed_at: the default FIRST, so no insert can ever meet it without one.
-- One block, one transaction, and ALTER TABLE holds its lock to the end, so
-- nothing lands between the steps. The rows already there took this
-- transaction's now(); they get the time they were last touched instead.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sm8_writes' and column_name = 'pressed_at'
  ) then
    alter table public.sm8_writes add column pressed_at timestamptz not null default now();
    update public.sm8_writes set pressed_at = updated_at where pressed_at = now();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sm8_writes_source_check') then
    alter table public.sm8_writes
      add constraint sm8_writes_source_check check (source in ('press'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sm8_writes_remote_len_check') then
    alter table public.sm8_writes
      add constraint sm8_writes_remote_len_check check (
        (remote_message is null or char_length(remote_message) <= 300)
        and (remote_code is null or char_length(remote_code) <= 20)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sm8_writes_free_retries_check') then
    alter table public.sm8_writes
      add constraint sm8_writes_free_retries_check check (free_retries >= 0);
  end if;
end $$;

-- one row per thing, a job or no job (the upsert's conflict target)
create unique index if not exists sm8_writes_dedupe_uniq
  on public.sm8_writes (org_id, dedupe_key);

-- the hourly cap: this account's presses, latest first
create index if not exists sm8_writes_tenant_pressed_idx
  on public.sm8_writes (tenant_id, pressed_at desc);
