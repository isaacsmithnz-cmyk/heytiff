-- Regular days off: TAFE every Tuesday, an RDO every second Friday, uni
-- Thursday afternoons (v2, 18 October; docs/plans/layout-2026-10/6-revisions.md).
--
-- A RULE, NOT A LEDGER. A row says a person isn't available on some weekdays,
-- every week or every second week, between two dates, the whole day or part
-- of it, for a reason the business names. It is never leave: no balance, no
-- approval, nothing here is counted against anything. The Schedule reads it
-- (People's rows, and the question a booking asks when it lands on one).
--
-- WHEN TO APPLY: any time before the switch-over. The app tolerates the table
-- being absent: the read returns nothing and the Schedule says what it said
-- before; the form's save says the table isn't there yet.
--
-- READ-ONLY, BEFORE:
--   select to_regclass('public.staff_regular_days_off');   -- null
-- AFTER:
--   select to_regclass('public.staff_regular_days_off');   -- staff_regular_days_off

create table if not exists public.staff_regular_days_off (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  staff_profile_id uuid not null,
  -- what the business calls it: TAFE, RDO, Uni, or its own word
  reason           text not null check (length(trim(reason)) between 1 and 40),
  -- ISO weekdays, 1 Monday … 7 Sunday
  weekdays         smallint[] not null check (array_length(weekdays, 1) between 1 and 7),
  -- 1 every week, 2 every second week (counted from from_date's week)
  every_weeks      smallint not null default 1 check (every_weeks in (1, 2)),
  from_date        date not null,
  to_date          date,
  -- both null: the whole day; both set: 'HH:MM' on the business's clock
  part_from        text check (part_from is null or part_from ~ '^\d{2}:\d{2}$'),
  part_to          text check (part_to is null or part_to ~ '^\d{2}:\d{2}$'),
  -- the days it doesn't apply (TAFE holidays)
  skip_dates       date[] not null default '{}',
  created_at       timestamptz not null default now(),
  constraint staff_regular_days_off_staff_fkey
    foreign key (staff_profile_id, org_id)
    references public.staff_profiles(id, org_id) on delete cascade,
  constraint staff_regular_days_off_range check (to_date is null or to_date >= from_date),
  constraint staff_regular_days_off_part check ((part_from is null) = (part_to is null) and (part_from is null or part_to > part_from))
);

create index if not exists staff_regular_days_off_org on public.staff_regular_days_off (org_id, staff_profile_id);

alter table public.staff_regular_days_off enable row level security;
-- deny-all: every read and write goes through the service role, gated in the app
