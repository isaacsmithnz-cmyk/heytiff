-- What happened to a task after it was made: the Tasks face's history.
--
-- THE ROW STAYS THE TRUTH FOR WHAT IT HOLDS. created_at/created_by say when
-- and who; the note that made it is found the way the journal finds it
-- (workboard_notes.applied.taskIds, job_note_actions.task_id,
-- projects.defects_task_id); acknowledged_at is the assignee's "Got it";
-- done_at/done_by are the latest completion. None of it is copied here.
--
-- WHAT THE ROW CANNOT SAY, and so the kinds:
--   created   who a task was made FOR when it was made. The row keeps only
--             the current assignee, so once a task changes hands nothing on
--             it says who it started with. Written by addTask and createTask.
--   due       the date moved (the row keeps only the new date): due_from and
--             due_to, either of which may be null (set / taken off). Written
--             by setTaskDue, and never when the date did not change.
--   given     the task changed hands: from_staff and to_staff. Written by
--             giveTask, and never when it went to the person who had it.
--   done      every completion, not only the last (reopening clears done_at).
--   reopened  every "Not done yet".
-- Written after the action's own update, best-effort
-- (src/lib/dashboard/task-events.ts): a failed insert leaves the history
-- quiet about one change and never blocks the change. Nothing before this
-- file ran is reconstructed; the Tasks face derives the made line, "Got it"
-- and the latest Done from the row for every task, old or new. Other writers
-- (applyNote, taskFromJobNote, the defects period, snoozes) do not log yet.
--
-- WHO. by_staff is whoever pressed; null when that card is later deleted.
-- to_staff and from_staff are nullable ON PURPOSE for the same reason: a
-- deleted staff card sets them null ("Given to someone who has left"), and a
-- NOT NULL check here would make that delete fail. The staff keys are
-- composite with org_id, so an event can never name another workspace's
-- person; `on delete set null (col)` needs Postgres 15 or later, as
-- workboard_notes.sql and calendar_events.sql already require.
--
-- POSTURE: RLS on, no policies; enforcement app-layer
-- (src/app/actions/dashboard.ts), like every other table here.
--
-- APPLY BEFORE MERGING the task-data pull request (H7). Additive and
-- idempotent: a new table, two new indexes, nothing altered; running it
-- twice changes nothing. The code runs without it: a failed insert is
-- swallowed, and a missing table reads as no events.
--
-- READ-ONLY CHECKS, BEFORE:
--   select to_regclass('public.task_events');                      -- expect null
--   select current_setting('server_version_num')::int >= 150000;   -- expect t
--   -- the staff keys need staff_profiles unique on (id, org_id):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.staff_profiles'::regclass and contype in ('p', 'u');
--   select indexname, indexdef from pg_indexes
--     where schemaname = 'public' and tablename = 'staff_profiles';
--   -- Phase 2's task_done_sm8.sql makes the same index; if it is there, the
--   -- create below is a no-op:
--   select indexname from pg_indexes where indexname = 'job_note_actions_task_idx';
--   -- the Tasks face finds a diary task with this filter (unverified against
--   -- production until this runs; expect the notes that made that task):
--   select id from public.workboard_notes
--     where org_id = '<org uuid>' and status = 'applied'
--       and applied -> 'taskIds' @> '["<a task id from a diary entry>"]'::jsonb;
-- AND AFTER:
--   select count(*) from public.task_events;                        -- expect 0
--   select relrowsecurity from pg_class where oid = 'public.task_events'::regclass;  -- t
--   select count(*) from pg_policies where tablename = 'task_events';                -- 0
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.task_events'::regclass order by 1;
--
-- ROLLBACK: drop table if exists public.task_events;
--           (leave job_note_actions_task_idx: Phase 2 wants it too)

create table if not exists public.task_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  task_id     uuid not null references public.tasks (id) on delete cascade,
  kind        text not null
                constraint task_events_kind_check
                check (kind in ('created', 'due', 'given', 'done', 'reopened')),
  by_staff    uuid,
  at          timestamptz not null default now(),
  -- kind 'due': the date before and after; either may be null (set / taken off)
  due_from    date,
  due_to      date,
  -- kind 'given': who had it; kind 'created' or 'given': who it went to
  from_staff  uuid,
  to_staff    uuid,
  constraint task_events_due_only
    check (kind = 'due' or (due_from is null and due_to is null)),
  constraint task_events_from_only
    check (kind = 'given' or from_staff is null),
  constraint task_events_to_only
    check (kind in ('created', 'given') or to_staff is null),
  constraint task_events_by_fkey foreign key (by_staff, org_id)
    references public.staff_profiles (id, org_id) on delete set null (by_staff),
  constraint task_events_from_fkey foreign key (from_staff, org_id)
    references public.staff_profiles (id, org_id) on delete set null (from_staff),
  constraint task_events_to_fkey foreign key (to_staff, org_id)
    references public.staff_profiles (id, org_id) on delete set null (to_staff)
);

-- The one read: a page of tasks' events, in time order.
create index if not exists task_events_task_idx
  on public.task_events (org_id, task_id, at);

alter table public.task_events enable row level security;

comment on table public.task_events is
  'Changes to a task the tasks row cannot hold: who it was made for, due moves, hand-overs, and every done and reopen. The made line, "Got it" and the latest completion are read off the tasks row.';

-- task -> the ServiceM8 note that made it. Same name and shape as Phase 2
-- PR C's task_done_sm8.sql: whichever lands first creates it, the other no-ops.
create index if not exists job_note_actions_task_idx
  on public.job_note_actions (org_id, task_id) where task_id is not null;
