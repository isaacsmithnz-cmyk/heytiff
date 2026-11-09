-- Days owed a wrap-up, kept in HeyTiff (Isaac, 9 November 2026: "Build it",
-- to keep them in HeyTiff, mark each day wrapped up, and put Friday back as
-- owed, after a reinstall lost Friday 6 November's from the phone).
--
-- A Clock off leaves its day owed a wrap-up until the person goes through
-- it. The phone used to keep that list only on itself (its store key
-- heytiff.wrapup.waiting), so a reinstall forgot it. Now the phone sends
-- each change here and reads the list back; its own copy is a cache.
--
-- One row per person per day. `jobs` are the words the phone's bar names
-- the day's jobs by (their numbers, "3488"); `done` and `noted` are the
-- jobs' ServiceM8 uuids, lowercase: wrapped up, and with their note in.
-- A day wrapped up is settled (settled_at), never deleted: it is the record
-- that the day was wrapped up.
--
-- New table, nothing reads it until the deploy does. APPLY BEFORE MERGING.

create table if not exists public.day_wrapups (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     text not null,
  work_date   date not null,
  jobs        jsonb not null default '[]'::jsonb check (jsonb_typeof(jobs) = 'array'),
  done        jsonb not null default '[]'::jsonb check (jsonb_typeof(done) = 'array'),
  noted       jsonb not null default '[]'::jsonb check (jsonb_typeof(noted) = 'array'),
  owed_at     timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  settled_at  timestamptz,
  primary key (org_id, user_id, work_date)
);

create index if not exists day_wrapups_owed on public.day_wrapups (org_id, user_id) where settled_at is null;

-- the server's own key only, as every operations table
alter table public.day_wrapups enable row level security;
