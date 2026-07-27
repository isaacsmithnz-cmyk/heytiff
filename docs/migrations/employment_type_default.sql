-- Everyone is full-time unless somebody says otherwise.
--
-- `staff_profiles.employment_type` has been nullable and unset since it was
-- added, which meant the roster's own vocabulary (Full-time · Part-time ·
-- Casual · Apprentice · Subcontractor) was in the profile dropdown but never
-- in the data. Most people at a business like this one are full-time, so that
-- is the default a workspace should get without being asked.
--
-- NOTHING BEHAVES DIFFERENTLY BECAUSE OF THIS. `classifyEmployment` in
-- lib/staff/employment.ts already reads null as "permanent" — deliberately,
-- because permanent is the safe end: it fills a week in and shows it to the
-- person before anything submits, where defaulting to casual would quietly
-- stop filling in the weeks of people who never told us what they are. This
-- migration makes the DATA say what the CODE already assumed.
--
-- WHAT IT COSTS, so it is on the record:
--   1. "Nobody has said yet" and "we checked, they're full-time" stop being
--      distinguishable. A profile that read "—" now reads "Full-time".
--   2. `payroll_complete` in lib/staff/rate-roster.ts is
--      `wage > 0 && !!employment && split === 100`, so an unset type used to
--      flag someone as not-ready-to-price. That prompt goes away. Wage and
--      cost split still gate it, so the signal isn't lost, only weakened.
-- The real cost lands on a CASUAL nobody has categorised: they will have a
-- normal week presumed onto their timesheet. That was already true of a null
-- row, so this changes no behaviour — but it does make the wrong answer look
-- like a deliberate one, which is the reason to set real types on real people
-- rather than leaning on this default.
--
-- The column default covers new rows: lib/auth0.ts creates a staff card on
-- first sign-in without naming employment_type, so Postgres fills it.

alter table public.staff_profiles
  alter column employment_type set default 'Full-time';

update public.staff_profiles
   set employment_type = 'Full-time'
 where employment_type is null
    or btrim(employment_type) = '';
