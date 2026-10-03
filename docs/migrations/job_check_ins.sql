-- CHECK IN / CHECK OUT ON THE JOB CARD — HeyTiff's own record of who was on
-- site and when (Isaac, 2026-10-02: "ServiceM8's hours do miss most things…
-- a simple check in and check out button on the job's card").
--
-- One row a stint: in, and out once the person presses it. A person has at
-- most ONE open check-in across every job — checking in somewhere else checks
-- them out of the last one at the same moment (the server action does that;
-- the partial unique index below makes it impossible to get wrong).
--
-- KEYED BY sm8_job_uuid, NOT A FOREIGN KEY, for the reason job_picklist.sql
-- gives: the mirror is a disposable cache, and a day's hours must outlive it.
--
-- A check-in left open overnight or past a working day is read the way
-- ServiceM8's are (sm8CheckInLeftOpen): the person was there, their hours
-- unknown. Nothing here changes a row to say so; the read decides.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: a new table nothing reads yet.

create table if not exists public.job_check_ins (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  sm8_job_uuid text not null,
  -- the person, as every other "added_by" in the app: their auth user id
  user_id text not null,
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  created_at timestamptz not null default now(),
  constraint job_check_ins_out_after_in check (checked_out_at is null or checked_out_at >= checked_in_at)
);

comment on table public.job_check_ins is
  'Who was on a job and when, pressed on the HeyTiff job card. ServiceM8''s own check-ins miss most days; on a day a person has one of these it is their hours for that job, over ServiceM8''s.';

-- the job card's read: every stint on a job
create index if not exists job_check_ins_job_idx on public.job_check_ins (org_id, sm8_job_uuid, checked_in_at);

-- one open check-in a person, across every job
create unique index if not exists job_check_ins_one_open
  on public.job_check_ins (org_id, user_id)
  where checked_out_at is null;

-- RLS deny-all, enforcement app-layer, same as every other table here.
alter table public.job_check_ins enable row level security;
