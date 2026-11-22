-- SITE NOTES (Isaac, 11 November 2026: "something else that we need to add to
-- the job cards which would be site specific, so maybe attach it to the
-- address … if it's Unit 10 of 106 … notes would come up specific to that
-- unit as well. Things like access codes, or lockbox locations, parking
-- situations, maybe a building manager number"; the pop-up drawn on
-- https://claude.ai/artifact/DqJvanQJMJgjs5ZTRySYpB, and 14 November 2026:
-- "Build all as recommended", told it needs this table).
--
-- There is no site or address table: a job's address is ServiceM8's free text
-- (sm8_jobs.job_address). A note is kept on a BUILDING KEY worked out from it
-- (lib/sites/site-key.ts): the street number, the street's name and type in
-- Australia Post's short form, and the suburb, all lower case, with the unit,
-- the state and the postcode left off, so "2/106 Exampleton Avenue\nExampleton
-- NSW 2061" and "106 Exampleton Ave, Exampleton" share one key. `unit` is null
-- for a note on the whole building, and the unit's own words ("2", "1a",
-- "shop 3") for a note that shows only on that unit's jobs.
--
-- kind: access (lockbox, gate and door codes, parking, who to call)
--       issue  (what the crew ran into)
--       other
--
-- A change never edits words in place: the new words are a new row that
-- `replaces` the old, and the old one gets `replaced_at`, so a code that
-- changed keeps its history. Removing sets `removed_at`. Only a row with
-- neither is shown.
--
-- Staff only: never read into a customer email, a quote, a PDF or Tiff's
-- replies to a customer (src/lib/sites/__tests__/site-notes-kept-in.test.ts
-- holds who may read the table).

create table if not exists public.site_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  building_key text not null check (char_length(building_key) between 3 and 200),
  -- null: the whole building
  unit text check (unit is null or char_length(unit) between 1 and 20),
  kind text not null check (kind in ('access', 'issue', 'other')),
  words text not null check (char_length(btrim(words)) between 1 and 2000),
  -- a clip of what was found: a job photo's remote id, `doc:<documents.id>`
  -- for one of ours or ServiceM8's attachment uuid
  video text check (video is null or char_length(video) <= 120),
  -- who wrote it: their auth user id, and their staff card when they have one
  written_by text not null,
  written_by_staff uuid references public.staff_profiles (id) on delete set null,
  written_at timestamptz not null default now(),
  -- the job it was written on (ServiceM8's job uuid)
  from_job_uuid text,
  -- the old ServiceM8 job note it was filed from, once, off the list of
  -- likely codes (sm8_job_notes.uuid)
  from_sm8_note_uuid text,
  -- the row these words replaced
  replaces uuid references public.site_notes (id) on delete set null,
  replaced_at timestamptz,
  removed_at timestamptz,
  removed_by text
);

comment on table public.site_notes is
  'Notes kept on a site, the building and a unit within it (lockbox, gate codes, parking, issues found), shown on every job at that address. Staff only.';

create index if not exists site_notes_building_idx
  on public.site_notes (org_id, building_key)
  where replaced_at is null and removed_at is null;

-- an old ServiceM8 note is filed once
create unique index if not exists site_notes_from_sm8_note_once
  on public.site_notes (org_id, from_sm8_note_uuid)
  where from_sm8_note_uuid is not null;

-- RLS deny-all, enforcement app-layer, same as every other table here.
alter table public.site_notes enable row level security;
