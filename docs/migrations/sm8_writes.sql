-- Writing to ServiceM8: the owner's switch, and the queue every write goes
-- through.
--
-- THE MIRROR WAS READ-ONLY BY CHARTER, and this is the charter's first
-- amendment, made on purpose and in one place. The first write is small, a
-- file put on a job from the job card's Documents tab. Isaac's brief for it
-- was wider: "It's not just going to be for this, it will be for lots of
-- other aspects of TIFF." So the table is the write path, not the file
-- feature: every later write (a note, a status, a booking) is a new `kind`
-- here and reuses the claim, the retry, the account check and the log.
--
-- THE SWITCH IS THE OWNER'S, AND IT STARTS OFF. `write_mode` sits on the
-- connection it governs:
--   'off'   nothing is written, and the office sees no Send to ServiceM8
--   'trial' the office can press it; each write is read, checked and logged
--           here as 'trial', and nothing reaches ServiceM8
--   'live'  writes are sent
-- It survives a reconnect (saveSm8Connection upserts named columns, so a
-- column it doesn't name keeps its value) and dies with a disconnect, which
-- deletes the row: a new grant starts with writing off, whoever connects it.
--
-- EVERY WRITE IS A ROW BEFORE IT IS A REQUEST. A press on the card inserts
-- the row; a sender claims it, sends it and records what came back. So a
-- write the network loses is retried rather than lost, a write that fails
-- says why on the card and on the ServiceM8 screen, and "what has HeyTiff
-- put in our ServiceM8" is always a query.
--
-- `remote_uuid` IS CHOSEN HERE, BEFORE THE FIRST SEND. ServiceM8 takes a
-- client-chosen uuid on create, so a retry after a timeout names the SAME
-- record and cannot make a second copy of the file on the job. It is also
-- how the card knows the file it sent when the next sync mirrors it back
-- (sm8_attachments.uuid), and shows it once instead of twice.
--
-- `tenant_id` IS THE ACCOUNT THE WRITE WAS ASKED OF. A write queued against
-- one ServiceM8 account is never sent to another. The sender compares it with
-- the connection's account before every send and cancels on a mismatch. That
-- is the reconnect accident of 2026-08-10 (the wrong account connected by the
-- browser's own sign-in) with writes in it, and it must not be possible.
--
-- ONE ROW PER THING WRITTEN: (org, kind, job, subject) is unique, and the
-- subject is the caller's own name for what it wrote (`document:<id>` for a
-- file). Sending the same certificate to the same job twice is one row, and
-- the second press says it is already there.
--
-- NOT A MIRROR, SO A DISCONNECT DOESN'T WIPE IT. This is HeyTiff's own
-- record of what it did to somebody's ServiceM8. A disconnect cancels what
-- is still waiting and keeps the history. `sm8_job_uuid` is a plain copy of
-- the job's uuid for the same reason documents.sm8_job_uuid is: nothing may
-- FK into a table that a disconnect wipes.
--
-- POSTURE: RLS on, no policies, like every table here. Every read and write
-- goes through the service-role client behind app-layer gates
-- (src/app/actions/job-sm8.ts for the card, src/app/actions/integrations.ts
-- for the owner's switch).
--
-- APPLY THIS BEFORE MERGING THE PR. The integration screens read
-- `write_mode` with the rest of the connection, so they need the column.

alter table public.integration_connections
  add column if not exists write_mode text not null default 'off';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'integration_connections_write_mode_check'
  ) then
    alter table public.integration_connections
      add constraint integration_connections_write_mode_check
      check (write_mode in ('off', 'trial', 'live'));
  end if;
end $$;

create table if not exists public.sm8_writes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  tenant_id       text not null,
  kind            text not null check (kind in ('attachment')),
  sm8_job_uuid    text,
  subject         text not null,
  -- What the sender needs to make the request, as the kind defines it. For
  -- an attachment: the documents row whose bytes go, the name it goes
  -- under, its type and size, and where on the card it came from.
  payload         jsonb not null default '{}'::jsonb,
  remote_uuid     text not null,
  status          text not null default 'queued'
                    check (status in ('queued', 'sending', 'sent', 'failed', 'trial', 'cancelled')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- A claim on a row being sent. A sender that dies mid-request leaves it to
  -- lapse, and the next sender takes the row again under the same uuid.
  lease_until     timestamptz,
  -- Our own sentence, never ServiceM8's response body.
  last_error      text,
  http_status     integer,
  requested_by    uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create unique index if not exists sm8_writes_subject_uniq
  on public.sm8_writes (org_id, kind, sm8_job_uuid, subject);

-- the sender's pick: what is waiting, oldest first
create index if not exists sm8_writes_due_idx
  on public.sm8_writes (org_id, next_attempt_at)
  where status in ('queued', 'sending');

-- the job card: what has been sent from this job
create index if not exists sm8_writes_job_idx
  on public.sm8_writes (org_id, sm8_job_uuid);

-- the ServiceM8 screen: the latest few
create index if not exists sm8_writes_recent_idx
  on public.sm8_writes (org_id, updated_at desc);

alter table public.sm8_writes enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)
