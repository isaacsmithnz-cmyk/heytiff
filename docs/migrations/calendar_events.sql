-- Company events on the Home calendar: toolbox talks, training, meetings,
-- and shutdowns (a ranged event whose kind says the business is closed).
--
-- WHO: anyone holding `team` adds, edits and deletes them (Isaac's call,
-- 2026-09-25: the same gate as posting a notice), through the calendar's box
-- (Save, Sort it out, the Tiff button). Everyone with Home reads them. The
-- gate is app-layer, in the calendar's server actions, like every other
-- write here.
--
-- A REPEAT IS MATERIALISED: one row per occurrence, sharing series_id, so an
-- occurrence can be moved or deleted alone and a window read is one range
-- scan. `repeat` keeps the rule the rows were counted from (lib/calendar/
-- repeat.ts reads it back), for the panel's "Repeats" line and "Delete all".
-- A series stops at the calendar's window end and never rolls forward.
--
-- TIMES ARE LOCAL WALL-CLOCK, like notice events: 6:45 is 6:45 in the yard,
-- never a timestamptz. A shutdown has no hours: it closes whole days.
--
-- POSTURE: RLS on, no policies, like every other table here. Service role
-- only, behind the app-layer gate.
--
-- APPLY BEFORE MERGING the calendar-data pull request. Additive and
-- idempotent: a new table nothing reads today; running it twice changes
-- nothing. The code runs without it: a failed read of this table is an
-- empty source, and the calendar shows no company events until it exists.
-- Postgres 15 or later (`on delete set null (created_by)`), as
-- tiff_knowledge_base.sql and workboard_notes.sql already require.
--
-- READ-ONLY CHECKS, BEFORE:
--   select to_regclass('public.calendar_events');            -- expect null
--   -- the author key needs staff_profiles to be unique on (id, org_id):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.staff_profiles'::regclass and contype in ('p', 'u');
--   select current_setting('server_version_num')::int >= 150000;  -- expect t
-- AND AFTER:
--   select count(*) from public.calendar_events;               -- expect 0
--   select relrowsecurity from pg_class where oid = 'public.calendar_events'::regclass;  -- t
--   select count(*) from pg_policies where tablename = 'calendar_events';   -- 0
--   select conname from pg_constraint where conrelid = 'public.calendar_events'::regclass order by 1;

create table if not exists public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  kind        text not null default 'event' check (kind in ('event', 'shutdown')),
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  -- the first and last day, inclusive; the same day for a one-day event
  starts_on   date not null,
  ends_on     date not null,
  -- wall-clock, both optional: an all-day event has neither
  starts_at   time,
  ends_at     time,
  location    text check (location is null or char_length(location) <= 120),
  -- who it is for, in the words it was added with: "Everyone", "Installers"
  audience    text check (audience is null or char_length(audience) <= 80),
  note        text check (note is null or char_length(note) <= 2000),
  series_id   uuid,
  repeat      jsonb check (repeat is null or jsonb_typeof(repeat) = 'object'),
  created_by  uuid,
  -- how it arrived: typed and saved, sorted out by Tiff, or spoken
  source      text not null default 'typed' check (source in ('typed', 'sorted', 'voice')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint calendar_events_range    check (ends_on >= starts_on),
  -- an end time needs a start, and must come after it on a one-day event
  constraint calendar_events_times    check (ends_at is null or (starts_at is not null
                                             and (ends_on > starts_on or ends_at > starts_at))),
  -- a row is in a series exactly when it carries the rule
  constraint calendar_events_series   check ((series_id is null) = (repeat is null)),
  constraint calendar_events_shutdown check (kind <> 'shutdown' or starts_at is null),
  constraint calendar_events_author_fkey foreign key (created_by, org_id)
    references public.staff_profiles (id, org_id) on delete set null (created_by)
);

comment on table public.calendar_events is
  'Company events and shutdowns on the Home calendar. A repeat is one row per occurrence sharing series_id; times are local wall-clock.';

-- The read: one org, overlapping a twelve-month window.
create index if not exists calendar_events_span_idx
  on public.calendar_events (org_id, starts_on, ends_on);

-- "Delete all" and the Repeats line: one series.
create index if not exists calendar_events_series_idx
  on public.calendar_events (org_id, series_id) where series_id is not null;

alter table public.calendar_events enable row level security;
