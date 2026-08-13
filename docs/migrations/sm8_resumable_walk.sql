-- A paused walk remembers where it stopped.
--
-- THE BUG THIS CLOSES. `cursor` is the edit_date WATERMARK — the floor a walk
-- filters from — and it advances only when a walk COMPLETES, which is right:
-- a half-finished walk must not move the floor past rows it never read.
-- ServiceM8's PAGINATION cursor is a different thing entirely, and it was
-- being thrown away at the end of every run, so a paused walk restarted at
-- page one next time.
--
-- Below PAGE_BUDGET × 1000 rows that is invisible: the walk finishes inside
-- one run and nothing is ever resumed. Above it the object can NEVER finish.
-- Observed on the live account 2026-08-14: sm8_attachments held 24,999 rows
-- while rows_pulled read 49,992 — two runs, each re-reading the same ~25,000
-- rows, `backfill_done` false forever, ~25 API calls a day burnt to learn
-- nothing. The mirror was permanently missing everything past page 25.
--
-- WHY THE FILTER IS STORED TOO, and not recomputed on resume. A backfill
-- floor is `now - backfillMonths`, so recomputing it a day later asks a
-- DIFFERENT question, and a pagination cursor minted against the old question
-- would be walking a result set that no longer exists. Freezing the filter for
-- the life of one walk makes a resumed page provably the next page of the
-- same query. NULL is a legitimate stored value (an object with no floor);
-- `walk_cursor` is what says whether a walk is in progress, never the filter.
--
-- Both columns clear when a walk completes, so a healthy object at rest looks
-- exactly as it did before this migration.

alter table public.sm8_sync_state
  add column if not exists walk_cursor text,
  add column if not exists walk_filter text;
