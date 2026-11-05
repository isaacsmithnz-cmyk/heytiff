-- Events and birthdays (Isaac, 6 November 2026, on his mock
-- https://claude.ai/artifact/L2p2fNKwDBzWJymNtwpXja: "Build").
--
-- AN EVENT ASKS MORE. The noticeboard's event already has a day, a time, a
-- place and Going / Maybe / Can't. A Christmas party asks three things more:
--   event_plus_one   the answers become Just me / Me + 1 / Can't make it
--                    (a new answer, 'plus_one', on notice_rsvps)
--   event_ask_diet   each person coming says their allergies or dietary
--                    needs (notice_rsvps.diet), seen by the poster alone
--   event_answer_by  the day to answer by; two days before it, anyone who
--                    hasn't answered gets one nudge (event_nudged_at stamps it)
--
-- A BIRTHDAY IS SHARED ONLY WHEN ITS PERSON SAYS SO. Two ticks on their own
-- card, both off: share_birthday sends the team a push on the day;
-- share_age adds how old they turn, and means nothing without the first.
-- birthday_pushed_on stamps the day the push went, so a second run of the
-- morning cron sends nothing twice.
--
-- Additive only: every new column has a default or is nullable, so the
-- running deploy reads and writes exactly as before. APPLY BEFORE MERGING.

alter table public.notices
  add column if not exists event_plus_one boolean not null default false,
  add column if not exists event_ask_diet boolean not null default false,
  add column if not exists event_answer_by date,
  add column if not exists event_nudged_at timestamptz;

alter table public.notice_rsvps
  add column if not exists diet text;

alter table public.notice_rsvps drop constraint if exists notice_rsvps_answer_check;
alter table public.notice_rsvps
  add constraint notice_rsvps_answer_check check (answer = any (array['yes', 'maybe', 'no', 'plus_one']));

alter table public.notice_rsvps drop constraint if exists notice_rsvps_diet_length;
alter table public.notice_rsvps
  add constraint notice_rsvps_diet_length check (diet is null or char_length(diet) <= 300);

alter table public.staff_profiles
  add column if not exists share_birthday boolean not null default false,
  add column if not exists share_age boolean not null default false,
  add column if not exists birthday_pushed_on date;
