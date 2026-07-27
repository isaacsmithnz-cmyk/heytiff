-- Normal hours, and the day a person deliberately did not work.
--
-- APPLY BEFORE MERGE. The app tolerates every column here being absent:
-- getPaySettings reads `*` and falls back to the shipped defaults, and
-- shiftDefaultsFor swallows the error a missing column produces and returns
-- "nobody has an override". So an unmigrated workspace still presumes a normal
-- 7:00–3:00 week — it just can't SAVE a different one, silently.
--
-- 1. pay_settings.default_start / default_end — the workspace's normal hours.
--    Every Mon–Fri is presumed worked at these times once the day is over.
--    7:00 AM – 3:00 PM is exactly the shipped 8h standard day, so an org that
--    never touches the setting gets ordinary days rather than half an hour of
--    overtime on every one of them.
--
-- 2. staff_profiles.default_start / default_end — one person's override, NULL
--    when they're on the workspace hours. Nullable and unset for everyone, so
--    applying this changes nobody's timesheet.
--
-- 3. time_entries.kind gains 'off' — a weekday that was deliberately not
--    worked and is not leave. It has to be storable: without it, "I wasn't on
--    site Tuesday" is indistinguishable from "nothing entered yet", and the
--    normal-day presumption would refill it on every page load.

-- 4. work_days on both — WHICH days are normal working days (Mon 0 … Sun 6),
--    org default plus a personal override. Without it a part-timer on
--    Mon/Tue/Thu has a full Wednesday presumed onto them every week forever.
--    NULL on a staff row means "on the workspace pattern"; an EMPTY ARRAY is a
--    real answer meaning "no set days", so the two must stay distinguishable.
--
-- 5. staff_unavailability — a casual marking days they can't work. NOT a leave
--    request: no status, no reviewer, no approval. It is deliberately its own
--    table so a row with no balance and no status can never wander into the
--    queries that compute what somebody has left.

alter table public.pay_settings
  add column if not exists default_start text not null default '7:00 AM',
  add column if not exists default_end   text not null default '3:00 PM',
  add column if not exists work_days     int[] not null default '{0,1,2,3,4}';

alter table public.staff_profiles
  add column if not exists default_start text,
  add column if not exists default_end   text,
  add column if not exists work_days     int[];

create table if not exists public.staff_unavailability (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  staff_profile_id uuid not null,
  from_date        date not null,
  to_date          date not null,
  note             text,
  created_at       timestamptz not null default now(),
  constraint staff_unavailability_staff_fkey
    foreign key (staff_profile_id, org_id)
    references public.staff_profiles(id, org_id) on delete cascade,
  constraint staff_unavailability_range check (to_date >= from_date)
);

-- the roster's read: "who is unavailable over this span"
create index if not exists staff_unavailability_span
  on public.staff_unavailability (org_id, from_date, to_date);

-- deny-all, like every other table here: enforcement is app-layer through the
-- service role, and the anon key must never reach this
alter table public.staff_unavailability enable row level security;

-- time_entries.kind is a text column with a check constraint. Drop and restate
-- it rather than adding a second constraint, so the allowed set is readable in
-- one place. Named exactly as the original so a re-run is idempotent.
alter table public.time_entries
  drop constraint if exists time_entries_kind_check;

alter table public.time_entries
  add constraint time_entries_kind_check
  check (kind in ('work', 'leave', 'sick', 'ph', 'off'));
