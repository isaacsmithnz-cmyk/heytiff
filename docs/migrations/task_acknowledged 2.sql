-- Being given a task alerts you the moment it exists (slice 6).
--
-- ISAAC'S RULE: a new task assignment ALWAYS alerts the assignee, time or no
-- time. Today the bell rings only TIMED reminders — `remind_at <= now`,
-- derived at read — so a plain task somebody assigned you waits silently on
-- the Tasks panel until you happen to look. The one thing a task management
-- feature must never do is keep a secret about work you have been given.
--
-- ONE NULLABLE COLUMN, AND NO SCHEDULER. The bell group is derived at read
-- exactly like the reminders beside it:
--
--     open  AND  assigned_to = me  AND  created_by <> assigned_to
--           AND  acknowledged_at IS NULL
--
-- "Got it" stamps this column and the row leaves the bell; the TASK stays,
-- because acknowledging is not doing. Completing the task clears it too, by
-- the status half of the same rule. A self-assigned task never rings — you
-- were there when it was made.
--
-- WHY A COLUMN AND NOT A ROW SOMEWHERE ELSE: every writer gets this for free.
-- A task typed on the Tasks panel, one Tiff minted from a note, one made from
-- a ServiceM8 mention — all of them insert into `tasks`, and none of them has
-- to remember to announce itself. A separate notifications table would have
-- needed every writer to know it existed.
--
-- Existing rows default to NULL, which means every open delegated task in the
-- workspace rings once. That is the correct backfill: nobody has ever
-- acknowledged any of them, and "here is the work you were given and never
-- told about" is the feature.

alter table public.tasks
  add column if not exists acknowledged_at timestamptz;

comment on column public.tasks.acknowledged_at is
  'When the assignee said "Got it". NULL means the bell still rings for it. Acknowledging is not doing — the task stays open; completing it clears the bell by the status rule instead.';

-- The bell asks this on every panel open and on the minute poll, per person,
-- on every screen in the app. Partial, because the only rows it ever wants are
-- the open unacknowledged ones — a fraction of the table, and the index stays
-- that size however many tasks the workspace closes.
create index if not exists tasks_unacknowledged_idx
  on public.tasks (org_id, assigned_to)
  where status = 'open' and acknowledged_at is null;
