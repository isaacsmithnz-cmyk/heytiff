-- YOUR REAL DAY BESIDE THE BOOKINGS (bug 89, Isaac, 24 November 2026: "My
-- actual day is very different"). Today on the phone shows each visit's
-- booked time beside when you were there, the office from where your phone
-- was, and any stretch over half an hour with nothing logged, with Add
-- missing time. This is that missing time: a stretch of the clocked day
-- said to be Admin, Travel, a Supplier run, Lunch, At the office, Unpaid,
-- or something else in your own words.
--
-- Not time_entries, which is one row a person a day. Several a day here,
-- each a span inside a staff_days day. Lunch and Unpaid come off the paid
-- hours Clock off puts on the timesheet; the rest is paid as the day is.
--
-- `source` is 'manual' (Add missing time) or 'gps' (kept for the phone
-- filling one in by itself; the office from GPS is staff_days.office).
--
-- SAFE TO APPLY BEFORE THE PR MERGES: a new table nothing reads yet.

create table if not exists public.day_time_blocks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- the person, as on job_check_ins and staff_days: their auth user id
  user_id text not null,
  -- the staff_days day it's in, on the account's own calendar
  work_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null,
  note text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  constraint day_time_blocks_kind_check check (kind in ('admin', 'travel', 'supplier', 'lunch', 'office', 'unpaid', 'other')),
  constraint day_time_blocks_source_check check (source in ('manual', 'gps')),
  constraint day_time_blocks_ends_after check (ends_at > starts_at),
  constraint day_time_blocks_note_length check (note is null or char_length(note) <= 200)
);

comment on table public.day_time_blocks is
  'Time in a clocked day said to be admin, travel, a supplier run, lunch, the office, unpaid or other, from the phone''s Add missing time. Lunch and unpaid come off the paid hours.';

create index if not exists day_time_blocks_person_idx on public.day_time_blocks (org_id, user_id, work_date);

-- RLS deny-all, enforcement app-layer, same as every other table here.
alter table public.day_time_blocks enable row level security;
