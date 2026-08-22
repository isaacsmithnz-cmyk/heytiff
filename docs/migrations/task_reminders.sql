-- Reminders — a task with a time on it.
--
-- WHAT THIS IS NOT. It is not a reminders table, and there is deliberately no
-- `is_reminder` flag. A reminder is a task you asked to be nudged about, and
-- `tasks` already holds the title, the person, the status and the due date.
-- A second entity would mean two things to complete, two things to assign and
-- two places to look for the same sentence.
--
-- WHY IT EXISTS. Isaac dictated "remind me to do that on Monday morning" into
-- Tiff. The router made the right task and dated it the right Monday, and then
-- the word "morning" hit `tasks.due_date`, which is a DATE, and vanished —
-- there was nowhere to put a time. That is this column.
--
-- THE DATE PART IS NOT A SECOND SOURCE OF TRUTH. `remind_at` is composed from
-- `due_date` plus a chosen time on the workspace's clock, so its date part IS
-- the due date by construction. Every existing reader — dueLabel, sortTasks,
-- openTasks, openTaskLoad, the journal chips — keeps working untouched, and a
-- task with no `remind_at` behaves exactly as it did yesterday. The composition
-- lives in ONE place, `remindAtFrom` in lib/dashboard/reminders.ts, because two
-- writers set it (applyNote and setTaskDueDate) and a due date edited later
-- would otherwise leave the nudge behind on the old day.
--
-- NOTHING RECORDS THAT A REMINDER FIRED, and that is the point. The bell asks
-- `remind_at <= now()` at read time, the same derive-at-read law the chips and
-- the urgent queue are built on: no fired flag, so no flag can go stale, and
-- "un-remind me" is not an operation that has to exist. Snoozing moves the
-- timestamp; completing is the task's own `status`.
--
-- Delivery by email is NOT part of this. When it is built it will need its own
-- bookkeeping — an email cannot be un-sent, so the mailer is the one thing here
-- entitled to a stamped column — and that migration adds it. Nothing
-- speculative goes in now.
--
-- APPLY THIS BEFORE MERGING THE PR.

alter table public.tasks
  add column if not exists remind_at timestamptz;

-- The bell's only query: my open tasks whose nudge time has passed. Partial,
-- because the overwhelming majority of tasks carry no reminder at all and a
-- full index would be mostly nulls.
create index if not exists tasks_remind_due_idx
  on public.tasks (org_id, assigned_to, remind_at)
  where remind_at is not null and status = 'open';
