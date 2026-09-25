-- Replies threaded under ServiceM8's notes (two-way phase 2, PR B).
--
-- WHEN TO APPLY: BEFORE THE DEPLOY OF PR B, and after sm8_notes_queue.sql
-- (PR A's), which adds the column this indexes. Additive and idempotent:
-- running it twice changes nothing, and main never reads it. The column
-- reply_to_sm8_note_uuid is PR A's (PR A's code reads it), as are
-- removed_at, sm8_refusal and the link confirmation; this file adds only the
-- index B's reads use: "has anybody replied to this note from HeyTiff?",
-- asked by the note's uuid when a job card opens (readJobAttention) — and
-- only where the deployment sends notes (SM8_WRITES names `note`). With
-- SM8_WRITES=1, as production is today, nothing reads it.
--
-- Replies are NOT recorded in job_note_actions: "answered by a reply" is
-- read from this column, so the one-row-per-note index there never meets a
-- reply, and a note can have many.
--
-- READ-ONLY, BEFORE:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'workboard_notes'
--      and column_name = 'reply_to_sm8_note_uuid';                    -- 1 row (PR A's migration is in)
--   select count(*) from public.workboard_notes
--    where reply_to_sm8_note_uuid is not null;                       -- 0 until notes are on
--   select count(*) from public.job_note_actions;                    -- note it: replies never add to it
-- AFTER:
--   select indexdef from pg_indexes
--    where schemaname = 'public' and indexname = 'workboard_notes_reply_idx';
--     -- CREATE INDEX workboard_notes_reply_idx ON public.workboard_notes
--     --   USING btree (org_id, reply_to_sm8_note_uuid) WHERE (reply_to_sm8_note_uuid IS NOT NULL)
--   select count(*) from public.job_note_actions;                    -- the same number as before

begin;

create index if not exists workboard_notes_reply_idx
  on public.workboard_notes (org_id, reply_to_sm8_note_uuid)
  where reply_to_sm8_note_uuid is not null;

commit;
