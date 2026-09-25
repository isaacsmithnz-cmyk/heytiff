-- School holidays for the Home calendar.
--
-- A REFERENCE TABLE. The dates belong to the state's education department
-- and are the same for every workspace, so there is no org_id and no
-- tombstone. (public_holidays has both because a business closes on its own
-- days and pay depends on them; school holidays change nobody's pay.) A
-- workspace reads the rows for its organizations.state, the same read
-- public_holidays uses; NSW reads division 'eastern' (lib/calendar/query,
-- schoolDivisionOf). A state with no rows shows no School holidays filter.
--
-- SEEDED, NOT SCRAPED (Isaac's call, 2026-09-25): NSW Eastern division up to
-- February 2029, re-seeded yearly by a migration like this one. Western
-- division NSW (the late-start schools) is not selectable yet, so it has no
-- rows; the division column is there for when it is.
--
-- SOURCE, every date checked on 2026-09-25 against the NSW Department of
-- Education's own pages:
--   https://education.nsw.gov.au/schooling/calendars/2026
--     (last updated 12 Aug 2026): Spring, Mon 28 Sept to Fri 9 Oct; Term 4
--     students back Tue 13 Oct; Summer 2026-27, Fri 18 Dec 2026 to Wed 27 Jan
--     2027.
--   https://education.nsw.gov.au/schooling/calendars/2027
--     (last updated 13 Aug 2026): Term 1 students back Wed 3 Feb; Autumn, Mon
--     12 Apr to Fri 23 Apr, back Thu 29 Apr; Winter, Mon 5 Jul to Fri 16 Jul,
--     back Tue 20 Jul; Spring, Mon 27 Sept to Fri 8 Oct, back Tue 12 Oct;
--     Summer 2027-28, Tue 21 Dec to Fri 28 Jan 2028.
--   https://education.nsw.gov.au/schooling/calendars/future-and-past-nsw-term-and-vacation-dates
--     (last updated 17 Aug 2026), for 2028: Autumn, Mon 10 Apr to Fri 21 Apr;
--     Winter, Mon 10 Jul to Fri 21 Jul; Spring, Tue 3 Oct to Fri 13 Oct;
--     Summer (Eastern), Fri 22 Dec to Thu 25 Jan 2029. There is no 2028 year
--     page yet, and that page's term dates include the staff development
--     days ("parents and carers should not send their children to school on
--     these days"), so the day students go back is not published: 2028's
--     students_back is NULL, never a guess from a term's first day.
--
-- POSTURE: RLS on, no policies, like every other table here. Read through
-- the service role only.
--
-- APPLY BEFORE MERGING the calendar-data pull request. Additive and
-- idempotent: it creates a table that nothing reads today, and running it
-- twice adds nothing twice. The code runs without it: a failed read of this
-- table is an empty source, and the calendar simply shows no school holidays.
--
-- READ-ONLY CHECKS, BEFORE (expect no row: the table is new):
--   select to_regclass('public.school_holidays');
--   select id, state from public.organizations;   -- the states in use
-- AND AFTER (expect 10 rows, all NSW eastern, 28 Sept 2026 to 25 Jan 2029,
-- students_back set through Oct 2027 and NULL from Dec 2027):
--   select season, starts_on, ends_on, students_back
--     from public.school_holidays
--     where state = 'NSW' and division = 'eastern'
--     order by starts_on;
--   select relrowsecurity from pg_class where oid = 'public.school_holidays'::regclass;
--   select count(*) from pg_policies where tablename = 'school_holidays';   -- 0

create table if not exists public.school_holidays (
  id            uuid primary key default gen_random_uuid(),
  state         text not null
                  check (state in ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT')),
  -- NSW's two calendars; every other state is 'all'
  division      text not null default 'all'
                  check (division in ('all', 'eastern', 'western')),
  season        text not null check (season in ('summer', 'autumn', 'winter', 'spring')),
  -- the break's first and last day, inclusive, as the department prints them
  starts_on     date not null,
  ends_on       date not null,
  -- the students' first day back, when published; NULL is "not yet", which
  -- is different from the day after ends_on (development days sit between)
  students_back date,
  -- the page the row was checked against, and the day it was checked
  source        text not null,
  checked_on    date not null,
  created_at    timestamptz not null default now(),
  constraint school_holidays_range check (ends_on >= starts_on),
  constraint school_holidays_back  check (students_back is null or students_back > ends_on),
  constraint school_holidays_key   unique (state, division, starts_on)
);

comment on table public.school_holidays is
  'School holidays by state and division, from each education department. Reference data: the same for every workspace, read by the Home calendar.';

-- The read: one state and division, overlapping a twelve-month window.
create index if not exists school_holidays_span_idx
  on public.school_holidays (state, division, starts_on, ends_on);

alter table public.school_holidays enable row level security;

insert into public.school_holidays
  (state, division, season, starts_on, ends_on, students_back, source, checked_on)
select 'NSW', 'eastern', v.season, v.starts_on::date, v.ends_on::date, v.back::date, v.source, date '2026-09-25'
from (values
  ('spring', '2026-09-28', '2026-10-09', '2026-10-13', 'https://education.nsw.gov.au/schooling/calendars/2026'),
  ('summer', '2026-12-18', '2027-01-27', '2027-02-03', 'https://education.nsw.gov.au/schooling/calendars/2026'),
  ('autumn', '2027-04-12', '2027-04-23', '2027-04-29', 'https://education.nsw.gov.au/schooling/calendars/2027'),
  ('winter', '2027-07-05', '2027-07-16', '2027-07-20', 'https://education.nsw.gov.au/schooling/calendars/2027'),
  ('spring', '2027-09-27', '2027-10-08', '2027-10-12', 'https://education.nsw.gov.au/schooling/calendars/2027'),
  ('summer', '2027-12-21', '2028-01-28', null,         'https://education.nsw.gov.au/schooling/calendars/2027'),
  ('autumn', '2028-04-10', '2028-04-21', null,         'https://education.nsw.gov.au/schooling/calendars/future-and-past-nsw-term-and-vacation-dates'),
  ('winter', '2028-07-10', '2028-07-21', null,         'https://education.nsw.gov.au/schooling/calendars/future-and-past-nsw-term-and-vacation-dates'),
  ('spring', '2028-10-03', '2028-10-13', null,         'https://education.nsw.gov.au/schooling/calendars/future-and-past-nsw-term-and-vacation-dates'),
  ('summer', '2028-12-22', '2029-01-25', null,         'https://education.nsw.gov.au/schooling/calendars/future-and-past-nsw-term-and-vacation-dates')
) as v(season, starts_on, ends_on, back, source)
on conflict (state, division, starts_on) do nothing;
