-- YOUR DAY ON THE PHONE — Clock on to Clock off (Isaac, 28 October 2026:
-- "GPS tracking only starts when you clock on for the day… Clocking out will
-- turn off the GPS"). One row a working day: when it began, when it ended,
-- and the stops at the office in between. The jobs in it are job_check_ins,
-- as before; this is the day around them.
--
-- One open day a person, as one open check-in: the partial unique index
-- below makes a second Clock on impossible to get wrong.
--
-- `office` is the stops at the office, [{"from": iso, "until": iso|null}],
-- in order. A stop is only ever a span of time: no place, no path, nothing
-- of where the person went in between is kept.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: a new table nothing reads yet.

create table if not exists public.staff_days (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- the person, as on job_check_ins: their auth user id
  user_id text not null,
  -- the day it is, on the account's own calendar, when they clocked on
  work_date date not null,
  on_at timestamptz not null,
  off_at timestamptz,
  office jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint staff_days_off_after_on check (off_at is null or off_at >= on_at)
);

comment on table public.staff_days is
  'A person''s working day, clocked on and off on the HeyTiff phone app: the span of it and the stops at the office. The jobs in it are job_check_ins. Location runs on the phone only between on_at and off_at.';

create index if not exists staff_days_person_idx on public.staff_days (org_id, user_id, work_date);

-- one open day a person
create unique index if not exists staff_days_one_open
  on public.staff_days (org_id, user_id)
  where off_at is null;

-- RLS deny-all, enforcement app-layer, same as every other table here.
alter table public.staff_days enable row level security;
