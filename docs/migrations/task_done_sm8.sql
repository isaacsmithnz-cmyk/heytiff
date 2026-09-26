-- Done and Undo for tasks made from ServiceM8 notes (two-way phase 2, PR C).
--
-- WHEN TO APPLY: BEFORE THE DEPLOY OF PR C, and after sm8_notes_queue.sql
-- (PR A's), which adds every column this file indexes. Additive and
-- idempotent: running it twice changes nothing, and the code before PR C
-- never reads it. Safe before the deploy: nothing here changes a row, and no
-- row today has task_id set, so the unique index builds over nothing.
--
-- A Done is one of HeyTiff's own diary rows (workboard_notes), marked
-- is_task_done and linked to its task. A reply that closes its task carries
-- the same link without the mark, so Reopen never takes a reply back, and a
-- Done stays a Done after its task is deleted (task_id goes null through
-- workboard_notes_task_fkey, ON DELETE SET NULL; the mark stays). The
-- columns task_id and is_task_done, and removed_at, are PR A's (PR A's code
-- reads them). This file adds the rule and the indexes.
-- One live Done per task is the unique index below: two ticks, two tabs or a
-- retry racing a tick make one Done. A Done that is taken back (removed_at
-- set) no longer holds it, so the task can be ticked again.
--
-- NOTHING ABOUT NOTES CHANGES IN PRODUCTION until SM8_WRITES names `note`
-- (Isaac's order: only after phase 1's live walk). Until then no Done row is
-- ever inserted, and these indexes sit empty.
--
-- READ-ONLY, BEFORE:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'workboard_notes'
--      and column_name in ('task_id', 'is_task_done', 'removed_at');     -- 3 rows (PR A's migration is in)
--   select count(*) from public.workboard_notes where task_id is not null; -- 0
--   select count(*) from public.job_note_actions where task_id is not null; -- note it: tasks made from notes
-- AFTER:
--   select indexname from pg_indexes where schemaname = 'public'
--    and indexname in ('workboard_notes_one_done_uniq', 'workboard_notes_task_idx',
--                      'job_note_actions_task_idx', 'sm8_writes_note_failed_by_idx');  -- 4 rows
--   select count(*) from public.workboard_notes where task_id is not null; -- 0
--   select count(*) from public.job_note_actions where task_id is not null; -- the same number as before

begin;

-- one Done per task that hasn't been taken back
create unique index if not exists workboard_notes_one_done_uniq
  on public.workboard_notes (org_id, task_id)
  where is_task_done and task_id is not null and removed_at is null;

create index if not exists workboard_notes_task_idx
  on public.workboard_notes (org_id, task_id) where task_id is not null;

create index if not exists job_note_actions_task_idx
  on public.job_note_actions (org_id, task_id) where task_id is not null;

create index if not exists sm8_writes_note_failed_by_idx
  on public.sm8_writes (org_id, requested_by, updated_at desc)
  where kind = 'note' and status = 'failed';

commit;
