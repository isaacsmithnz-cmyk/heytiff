-- What every cached job photo IS — the searchable bank.
--
-- WHY THIS MOVED OFF `job_photo_favourites`. The star was quietly doing two
-- unrelated jobs: "this is worth showing someone" (a human judgement) and
-- "this has been looked at" (an index entry). While only starred photos were
-- read those collapsed into one row and nobody noticed. They are different
-- questions with different lifetimes — unstar a photo and its reading is
-- still true — so the reading gets its own home and the star goes back to
-- being pure curation.
--
-- READ WHAT WE ALREADY HOLD. The trigger is the bytes landing, not the star:
-- opening a job card runs `cacheJobFiles`, and whatever it brings across is
-- read once, here. That keeps the bank growing along the paths people
-- actually walk — the same lazy rule that has kept storage at 432MB against
-- an account holding ~28GB of originals — instead of a 32,443-photo backfill
-- where four in five would never be searched.
--
-- NOT A FOREIGN KEY TO THE MIRROR, and not to `documents` either. Keyed by
-- the ServiceM8 attachment uuid, which is also `documents.remote_ref`, so the
-- picture is reachable by a join without a column that has to be kept in step.
-- The job number, client and name are SNAPSHOTTED for the reason every table
-- here snapshots them: `disconnectSm8` deletes the mirror and the next walk
-- rebuilds it, and a search result that cannot say which job it came from is
-- not a search result.
--
-- ocr_text IS THE POINT, not a bonus. These photographs are dataplates, model
-- stickers, switchboard labels and serial numbers, and the model reads them
-- for free while it is already looking — the first version threw that away by
-- squeezing it into six tags. `PUZ-M125VKA2-A` is the single most useful
-- searchable string on a rating plate and it now has somewhere to live.
--
-- A ROW MEANS "LOOKED AT", NOT "PLACED". `subject` stays null when the model
-- could not tell, because a wrong subject hides a photograph under a filter
-- nobody will open. The row's existence is what keeps it out of the queue.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: a new table, plus the removal of four
-- columns that only the showcase read and whose contents are copied across
-- first.

create table if not exists public.job_photo_readings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- sm8_attachments.uuid, and also documents.remote_ref. Deliberately NOT a
  -- foreign key to either: the mirror is disposable and the bucket is a cache.
  sm8_attachment_uuid text not null,
  -- the job it was read FROM (the card, never the claim clone)
  sm8_job_uuid text not null,
  -- SNAPSHOT, so a result can name its job after the mirror is wiped
  job_number text,
  client_name text,
  photo_name text not null default '',
  photo_taken_at text,
  -- what the picture is of; null when it could not be placed
  subject text,
  tags text[] not null default '{}',
  caption text not null default '',
  -- every word visible in the frame — model numbers, serials, label text
  ocr_text text not null default '',
  read_at timestamptz not null default now(),
  read_model text not null
);

comment on table public.job_photo_readings is
  'One row per job photo that has been looked at: what it is of, what is written on it, and enough of its job snapshotted to survive the mirror being wiped. The searchable bank behind photo search.';
comment on column public.job_photo_readings.sm8_attachment_uuid is
  'sm8_attachments.uuid, and documents.remote_ref. Not a foreign key to either — the mirror is disposable and the bucket is a cache.';
comment on column public.job_photo_readings.subject is
  'What the photo is OF, from the closed set in lib/workboard/photo-subjects.ts. Null when it could not be placed — the ROW is what says it was looked at.';
comment on column public.job_photo_readings.ocr_text is
  'Every word visible in the frame. Dataplates and switchboard labels are what these photographs mostly are, so this is the highest-value thing in the row.';

-- ONE READING PER PHOTO PER WORKSPACE. This index is the whole dedupe: a
-- photo already read is never paid for twice, however many times its job is
-- opened or by whom.
create unique index if not exists job_photo_readings_photo_idx
  on public.job_photo_readings (org_id, sm8_attachment_uuid);

-- "what on this job has been read" — the job card's own check.
create index if not exists job_photo_readings_job_idx
  on public.job_photo_readings (org_id, sm8_job_uuid);

-- the gallery's filter
create index if not exists job_photo_readings_subject_idx
  on public.job_photo_readings (org_id, subject, read_at desc)
  where subject is not null;

create index if not exists job_photo_readings_tags_idx
  on public.job_photo_readings using gin (tags);

-- THE SEARCH ITSELF. One generated tsvector over the free text a person might
-- type: the caption, the text ON the photo, and the job and client it belongs
-- to. `'simple'::regconfig` rather than `'english'` on purpose — a model
-- number is not an English word and must not be stemmed into a different one.
--
-- TWO THINGS A GENERATED COLUMN WILL NOT TAKE, both learned by being refused:
--   * a BARE `'simple'` leaves to_tsvector merely STABLE, not immutable, and
--     Postgres rejects the column. The `::regconfig` cast pins the config at
--     definition time, which is what makes it constant.
--   * `array_to_string` is STABLE too -- array output runs through per-type
--     output functions -- so `tags` CANNOT be folded in here. They are not
--     dropped from search: they carry their own GIN index above and the query
--     matches them alongside this vector. Wrapping array_to_string in a
--     function falsely declared IMMUTABLE would have worked, and would have
--     been a lie the planner is entitled to believe.
alter table public.job_photo_readings
  add column if not exists search tsvector
  generated always as (
    to_tsvector('simple'::regconfig,
      coalesce(caption, '') || ' ' ||
      coalesce(ocr_text, '') || ' ' ||
      coalesce(job_number, '') || ' ' ||
      coalesce(client_name, '')
    )
  ) stored;

-- photo_name IS DELIBERATELY ABSENT. ServiceM8 names every attachment the
-- literal string `Photo` — the trap that already cost 28,828 hidden
-- photographs through a name-based dedupe. Folded in here it is worse than
-- useless: `photo` prefix-matches every row in the bank, so the first word
-- anybody tries returns everything, ranked identically. The column stays on
-- the row; it is simply not searchable, because there is nothing in it.

create index if not exists job_photo_readings_search_idx
  on public.job_photo_readings using gin (search);

-- Trigram matching, so a half-remembered model number still finds the photo.
create extension if not exists pg_trgm;
create index if not exists job_photo_readings_ocr_trgm_idx
  on public.job_photo_readings using gin (ocr_text gin_trgm_ops);

alter table public.job_photo_readings enable row level security;

-- ── the star goes back to being only a star ───────────────────────────────
-- Carry across whatever the showcase already read, then drop the columns.
insert into public.job_photo_readings
  (org_id, sm8_attachment_uuid, sm8_job_uuid, job_number, client_name,
   photo_name, photo_taken_at, subject, tags, caption, read_at, read_model)
select org_id, sm8_attachment_uuid, sm8_job_uuid, job_number, client_name,
       photo_name, photo_taken_at, subject, tags, coalesce(caption, ''),
       coalesce(read_at, now()), coalesce(read_model, 'claude-opus-5')
from public.job_photo_favourites
where read_at is not null
on conflict (org_id, sm8_attachment_uuid) do nothing;

drop index if exists job_photo_favourites_subject_idx;
drop index if exists job_photo_favourites_unread_idx;
drop index if exists job_photo_favourites_tags_idx;

alter table public.job_photo_favourites
  drop column if exists subject,
  drop column if exists tags,
  drop column if exists read_at,
  drop column if exists read_model;
