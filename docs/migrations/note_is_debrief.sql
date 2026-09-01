-- A debrief is a different act from a note, and nothing recorded which was which.
--
-- THE PROBLEM. Isaac (2026-09-01): "the debrief, you should be able to see all
-- of your previous debriefs." The face could not, and the reason was not the
-- screen — it was that the fact had never been written down.
--
-- Both doors write the same row. `NoteToken as="debrief"` and
-- `NoteToken as="entry"` call the same `routeNote`, which inserts into
-- `workboard_notes` with `target_kind: 'none'` either way. Measured on prod
-- before writing this: every row in the table is `target_kind = 'none'`, so a
-- debrief and a line typed into the diary are byte-for-byte the same shape.
-- "Show me my debriefs" could only ever have returned the whole diary, which
-- is the tab next door.
--
-- WHY NOT REUSE `target_kind`. It answers "what is this note ABOUT" — a job, a
-- project, or nothing. A debrief spans jobs; that is the whole point of it, and
-- it is exactly why the debrief passes `none` today. Adding 'debrief' to that
-- column would make one column answer two unrelated questions, and the first
-- person to filter on it would get a surprise.
--
-- WHAT THIS ADDS. One boolean saying which door the words came through.
-- `routeNote` already TAKES `debrief?: boolean` — it changes what the brain is
-- asked for — and has simply been throwing it away after the model ran. This
-- keeps it.
--
-- NOT NULL WITH A DEFAULT, and no backfill. Every existing row predates the
-- distinction, so there is no honest way to say which were debriefs; `false`
-- is not a guess about the past, it is the truthful "this row never claimed to
-- be one". Three applied rows exist in prod, so nothing is lost either way.
--
-- POSTURE: RLS on with no policies, unchanged. Enforcement stays app-layer in
-- src/app/actions/workboard-notes.ts.
--
-- APPLY THIS BEFORE MERGING THE PR.

alter table public.workboard_notes
  add column if not exists is_debrief boolean not null default false;

comment on column public.workboard_notes.is_debrief is
  'Which door the words came through: the Debrief face (true) or an ordinary note/diary capture (false). Set at insert from routeNote''s existing `debrief` flag; never inferred.';

-- The Debrief face reads one author's debriefs, newest first — the same shape
-- the journal query already uses, plus this column.
create index if not exists workboard_notes_debrief_idx
  on public.workboard_notes (org_id, author_id, created_at desc)
  where is_debrief and status = 'applied';
