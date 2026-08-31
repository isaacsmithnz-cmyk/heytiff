-- Starred job photos — the showcase's storage.
--
-- WHAT IT IS. A photo on a job card can be starred, and the starred set is a
-- curated collection kept for OTHER jobs: showing a client what the work
-- looks like, briefing a tech on a detail. Curated by hand, one photo at a
-- time. Never automatic, never "everything from a good job".
--
-- WHY NOT `sm8_attachments.is_favourite`. That column exists — it is
-- ServiceM8's own star, and we do not read it — but the mirror is READ-ONLY
-- BY CHARTER and disposable: `disconnectSm8` deletes every row in it, and
-- each sync upserts the whole shaped row back. A HeyTiff star written there
-- is destroyed by the next walk, and there is no write scope to push it the
-- other way. So the flag lives in ITS OWN TABLE, over the top.
--
-- WHY NOT A BOOLEAN ON `documents`. Most photos have no `documents` row at
-- all — the bucket is a lazy cache, 249 rows against 39,767 attachments — so
-- a boolean there could only be set for a photo that happened to be cached.
-- A showcase entry also wants a caption and an ordering, which is a row with
-- an identity, not a flag on somebody else's.
--
-- KEYED BY THE ATTACHMENT UUID, NOT A FOREIGN KEY, for the reason
-- studio_designs_sm8_job.sql and job_picklist.sql both spell out: nothing may
-- FK into the mirror. The star must survive the mirror row vanishing, which
-- is why the job number, client and photo date are SNAPSHOTTED here — a
-- disconnect wipes sm8_attachments, and a showcase that forgets what it was
-- looking at is not a showcase.
--
-- document_id IS a real composite FK, on (document_id, org_id), so a star can
-- never cite another workspace's file. `set null (document_id)` NAMES its
-- column: a bare ON DELETE SET NULL would try to null org_id too, which is
-- NOT NULL, and every document delete would fail — the job_picklist.sql trap.
-- Null is the ordinary state, not an error: the bytes are fetched when the
-- photo is starred, and a photo whose cache row is later cleared is still
-- starred.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: a new table nothing reads yet.

create table if not exists public.job_photo_favourites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- sm8_attachments.uuid of the photo. Deliberately NOT a foreign key.
  sm8_attachment_uuid text not null,
  -- the job the photo was starred FROM (the card, never the claim clone)
  sm8_job_uuid text not null,
  -- SNAPSHOT, so the row survives the mirror being wiped and re-walked
  job_number text,
  client_name text,
  photo_name text not null default '',
  -- ServiceM8's naive local stamp, copied as text exactly as the mirror holds it
  photo_taken_at text,
  -- our cached copy, when we hold one; null before the fetch and after a purge
  document_id uuid,
  -- the curator's own words about the photo, for the collection view
  caption text not null default '',
  -- ordering within the collection; newest starred first until somebody sorts it
  position integer not null default 0,
  added_at timestamptz not null default now(),
  added_by text not null,
  constraint job_photo_favourites_document_fk
    foreign key (document_id, org_id)
    references public.documents (id, org_id) on delete set null (document_id)
);

comment on table public.job_photo_favourites is
  'Starred job photos — a hand-curated showcase kept as examples for other jobs. An overlay on the read-only ServiceM8 mirror, never a column in it.';
comment on column public.job_photo_favourites.sm8_attachment_uuid is
  'sm8_attachments.uuid. Deliberately NOT a foreign key: the mirror is disposable and a star outlives it.';
comment on column public.job_photo_favourites.job_number is
  'Snapshot at starring time. Never re-derived — the mirror row it came from may be gone.';
comment on column public.job_photo_favourites.document_id is
  'Our cached copy of the bytes, when we hold one. Null is ordinary, not broken.';

-- ONE STAR PER PHOTO PER WORKSPACE. This is the constraint the toggle relies
-- on: starring twice is the same star, not two rows in the collection.
create unique index if not exists job_photo_favourites_photo_idx
  on public.job_photo_favourites (org_id, sm8_attachment_uuid);

-- "which of THIS job's photos are starred" — the job card's read, on every
-- open of the Photos face.
create index if not exists job_photo_favourites_job_idx
  on public.job_photo_favourites (org_id, sm8_job_uuid);

-- The collection itself, newest first. The showcase screen's read, before it
-- exists — the index costs nothing and the ordering is already decided.
create index if not exists job_photo_favourites_collection_idx
  on public.job_photo_favourites (org_id, position, added_at desc);

-- RLS deny-all, enforcement app-layer, same as every other table here: the
-- service role is the only path in and every server action re-checks the org
-- and the capability for itself.
alter table public.job_photo_favourites enable row level security;
