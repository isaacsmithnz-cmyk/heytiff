-- NO DEPOSIT ON THIS JOB — ticked on the job card (Isaac, 2026-10-03: "if no
-- deposit required make that as an option so it can get ticked off").
--
-- The progress line's Deposit step is done when a deposit claim is paid. A
-- job that takes no deposit used to be guessed at ("no Deposit claim, so no
-- deposit"), which can't tell "none needed" from "not invoiced yet". One row
-- here says somebody decided: none needed. Unticking deletes the row.
--
-- KEYED BY sm8_job_uuid, NOT A FOREIGN KEY, for the reason job_picklist.sql
-- gives: the mirror is a disposable cache, and a decision must outlive it.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: a new table nothing reads yet.

create table if not exists public.job_no_deposit (
  org_id uuid not null references public.organizations (id) on delete cascade,
  sm8_job_uuid text not null,
  -- the person, as every other "added_by" in the app: their auth user id
  marked_by text not null,
  marked_at timestamptz not null default now(),
  primary key (org_id, sm8_job_uuid)
);

comment on table public.job_no_deposit is
  'Jobs somebody ticked as taking no deposit, on the job card. The progress line''s Deposit step reads it as done.';

-- RLS deny-all, enforcement app-layer, same as every other table here.
alter table public.job_no_deposit enable row level security;
