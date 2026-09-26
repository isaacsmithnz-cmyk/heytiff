-- The Debrief's column goes (the new Home build, H3 of 25).
--
-- WHAT GOES. `workboard_notes.is_debrief`, which note_is_debrief.sql added so
-- the Debrief face could list one author's debriefs, and the partial index
-- that served that list and nothing else, `workboard_notes_debrief_idx`.
--
-- WHY. The Debrief is gone (Isaac, 2026-09-24: "the diary, tasks and HeyTiff
-- chat window should assist with that"). #812 (H1) took its face, button, dot
-- and card off Home. #818 (H2) took it out of the router and out of the
-- diary's read in the same change, so nothing on main has written or read the
-- column since. An old Debrief row keeps its place without it: it is an
-- applied note like any other, and its grouped note's door comes from
-- `applied.noteLines`.
--
-- NOTHING IS LOST. Checked against production on 2026-09-26: of 45 notes, one
-- was ever marked a debrief, a note from 2026-09-02 that was dismissed rather
-- than filed, so no diary has shown it. No function, view, policy, trigger or
-- publication names the column. All that depends on it is its own default and
-- the index, which Postgres would drop with it anyway; the index is dropped
-- by name first, so this file says everything it removes.
--
-- APPLY THIS ONCE #818 IS LIVE, NEVER BEFORE. The code before #818 writes the
-- column on every note and selects it for every diary, and PostgREST refuses
-- a write or a select that names a column that isn't there: until that deploy
-- lands, this would fail every note and empty every diary. #818 merged on
-- 2026-09-25. The PR that adds this file changes no code, so it can merge
-- before or after this runs.

drop index if exists public.workboard_notes_debrief_idx;

alter table public.workboard_notes
  drop column if exists is_debrief;
