-- What a starred photo is OF — read from the picture itself.
--
-- Isaac asked for "smart categories" and chose, explicitly, the version that
-- READS THE PICTURE rather than one derived from the job's paperwork. A job's
-- category says Install or Service Call; it cannot say that this particular
-- frame is the dataplate, or the ductwork, or the fault somebody photographed
-- to explain it. Those are the questions a showcase is searched by.
--
-- ONE SUBJECT, MANY TAGS. `subject` is a CLOSED SET (see
-- lib/workboard/photo-subjects.ts) because a free-text category fragments on
-- contact with reality — "outdoor unit", "condenser" and "outdoor" are three
-- spellings of one filter, and a filter that misses a third of its own
-- members is worse than no filter. `tags` is the open half: whatever else is
-- worth saying, unconstrained, searched rather than filtered.
--
-- NULL SUBJECT IS THE ORDINARY STATE, NOT A FAILURE. A photo is starred
-- instantly and read afterwards, a few at a time, the way the job card brings
-- its bytes across. `read_at` is the marker that a read HAPPENED — a photo
-- Claude looked at and could not place keeps a null subject and a non-null
-- read_at, so the reader does not queue it forever.
--
-- read_model IS PROVENANCE, and it is why this is a column rather than a
-- constant. When the model changes, everything read by the old one is still
-- identifiable — and re-readable — instead of being silently mixed in.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: new nullable columns on a table only
-- this feature reads.

alter table public.job_photo_favourites
  add column if not exists subject text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists read_at timestamptz,
  add column if not exists read_model text;

comment on column public.job_photo_favourites.subject is
  'What the photo is OF, from a closed set (lib/workboard/photo-subjects.ts). Null until read, and null after a read that could not place it — read_at is what says a read happened.';
comment on column public.job_photo_favourites.tags is
  'The open half: anything else worth saying about the picture. Searched, not filtered.';
comment on column public.job_photo_favourites.read_model is
  'Which model read it. Provenance, so a model change leaves the old readings identifiable and re-readable.';

-- The gallery's filter: every starred photo of one subject, newest first.
create index if not exists job_photo_favourites_subject_idx
  on public.job_photo_favourites (org_id, subject, added_at desc)
  where subject is not null;

-- The reader's queue: what has not been looked at yet.
create index if not exists job_photo_favourites_unread_idx
  on public.job_photo_favourites (org_id, added_at)
  where read_at is null;

-- Tag search.
create index if not exists job_photo_favourites_tags_idx
  on public.job_photo_favourites using gin (tags);
