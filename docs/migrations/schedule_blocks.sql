-- Block out time (Isaac, 6 November 2026, "Build it" on his mock
-- https://claude.ai/artifact/9BSz3k2q6MYZbb7Ua7PhUL, option B).
--
-- A BLOCK IS A STRETCH OF SOMEONE'S DAY THAT ISN'T A JOB: a doctor, TAFE, a
-- meeting with a supplier. What it is, where, and how long. It is made in
-- one of two places:
--   - the Schedule's Jobs panel: a card with no one and no day yet
--     (sm8_staff_uuid, day and start_min all null), in its own group at the
--     top of Jobs, dragged onto someone like a job;
--   - the phone's New, Block out time: straight onto a person's day.
-- Placed, it is drawn on the person's row as a booking's card with a clock in
-- its box, and it goes to ServiceM8 as staff leave where leave is switched on
-- (sm8-leave-queue, subject block:<id>).
--
-- A placed block names its person by their ServiceM8 staff uuid, as the
-- Schedule's rows do, and by their HeyTiff card where one is linked (which
-- the ServiceM8 leave needs). Times are minutes past midnight on the
-- business's own clock, as the Schedule keeps them.
--
-- removed_at marks one taken away; nothing is ever hard-deleted, so a block
-- on the ServiceM8 board can always be found to take it off there too.
--
-- New table, nothing reads it until the deploy does. APPLY BEFORE MERGING.

create table if not exists public.schedule_blocks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  what             text not null check (length(trim(what)) between 1 and 40),
  where_text       text check (where_text is null or length(where_text) <= 60),
  -- how long, in minutes: the pile's length, and the placed span's
  minutes          integer not null check (minutes between 15 and 1440),
  -- placed: the person, the day and the start, all three or none
  sm8_staff_uuid   text,
  staff_profile_id uuid,
  day              date,
  start_min        integer check (start_min is null or start_min between 0 and 1439),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  placed_at        timestamptz,
  removed_at       timestamptz,
  constraint schedule_blocks_placed check (
    (sm8_staff_uuid is null) = (day is null) and (day is null) = (start_min is null)
  ),
  constraint schedule_blocks_in_day check (start_min is null or start_min + minutes <= 1440)
);

create index if not exists schedule_blocks_day on public.schedule_blocks (org_id, day) where removed_at is null;
create index if not exists schedule_blocks_pile on public.schedule_blocks (org_id) where removed_at is null and day is null;

alter table public.schedule_blocks enable row level security;
-- deny-all: every read and write goes through the service role, gated in the app
