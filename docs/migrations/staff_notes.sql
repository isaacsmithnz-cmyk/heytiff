-- My notes — the floor of the note cascade.
--
-- WHY THIS TABLE EXISTS AT ALL. Every note the app captures is aimed at a
-- job first, then at a person as a task. Those two cover nearly everything,
-- and where they don't, the words still have to go somewhere a human will
-- actually look. `workboard_notes` is NOT that place and never was: nothing
-- in the app reads it, which is exactly why "just keep the note" was killed
-- on 2026-08-02 — a drawer nobody opens is not a destination, and no
-- rewording of the button makes it one.
--
-- So this is the last rung, and its whole justification is that it has a
-- READER: /dashboard/my-notes lists these back to the person who wrote them.
-- If that surface is ever removed, remove this table with it rather than
-- leaving another write-only drawer behind.
--
-- THE CASCADE (decided with Isaac, 2026-08-05):
--     1. on the job      — notes, bring-list, progress, issues, flags
--     2. as a task       — `tasks` has no job column, so a task from a note
--                          stands alone and lands on the assignee's dashboard
--     3. here            — offered ONLY when 1 and 2 can't take it
--
-- Note that "action required" is deliberately absent from that list. It is a
-- DERIVED board (licence expiries, VEVO, rego, insurance, pending claims,
-- assembled by lib/dashboard/assemble.ts) with no row to insert. Rung 2 does
-- the work people expect of it.
--
-- PRIVATE BY DEFAULT. A note you couldn't file against a job is a note about
-- your own day, so `staff_id` is both the author and the audience; the
-- queries filter on it and there is no org-wide read. If shared personal
-- notes are ever wanted, that is a new column and a new decision, not a
-- widening of this one.
--
-- POSTURE: RLS ON, NO policies (deny-all house-wide); composite FKs carry
-- org_id so a note can never point at another workspace's staff row.
--
-- APPLY THIS BEFORE MERGING THE PR.

create table if not exists public.staff_notes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,

  -- Whose note it is: the person who wrote it and the only person who reads
  -- it. NOT NULL, unlike workboard_notes.author_id — a note with no owner
  -- has no reader, which is the failure this table exists to avoid.
  staff_id      uuid not null,

  body          text not null,

  -- How it got here. 'voice' and 'text' are direct captures; 'routed' means
  -- it fell through the cascade off a note that was already parsed, and
  -- `source_note_id` points back at the sentence.
  source        text not null default 'text'
                  check (source in ('text', 'voice', 'routed')),
  source_note_id uuid,

  -- Put away, not deleted. Clearing a note you've dealt with shouldn't
  -- destroy the record of having thought it.
  archived_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint staff_notes_staff_fkey
    foreign key (staff_id, org_id)
    references public.staff_profiles(id, org_id) on delete cascade,
  constraint staff_notes_source_fkey
    foreign key (source_note_id, org_id)
    references public.workboard_notes(id, org_id) on delete set null (source_note_id)
);

-- The list read: one person's live notes, newest first. Partial on the
-- archive so the common case never walks put-away rows.
create index if not exists staff_notes_org_staff_idx
  on public.staff_notes (org_id, staff_id, created_at desc)
  where archived_at is null;

-- The archive read, which is rarer and deserves its own narrow index rather
-- than a scan of the table with the partial one above skipped.
create index if not exists staff_notes_org_staff_archived_idx
  on public.staff_notes (org_id, staff_id, archived_at desc)
  where archived_at is not null;

alter table public.staff_notes enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)
