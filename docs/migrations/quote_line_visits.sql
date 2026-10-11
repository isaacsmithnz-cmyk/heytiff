-- A LABOUR LINE'S TASKS, KEPT (slice 8.2; Isaac's go 2026-10-09: "displaying
-- the list of tasks will help both tiff and the user to figure out the
-- correct labour… those tasks then get put straight on to the job").
--
-- Tiff works labour out task by task (#1097): one line per visit, its tasks
-- and their person-hours. Until now the tasks rode in the line's `why`,
-- cut at 400 characters. They are the line's own record now: the visit's
-- stage, its crew, the working day it was counted on, and every task, so a
-- person can change an hour or add a task on the quote, and the accepted
-- quote's tasks go onto the job. Shape: src/lib/quotes/line-visit.ts.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: one nullable column, every existing
-- row null (a line with no tasks). Additive and idempotent.

alter table public.quote_lines add column if not exists visit jsonb;

comment on column public.quote_lines.visit is
  'A labour line worked out task by task: { stage, people, dayHours, tasks: [{ task, hours, was, byHand }] }. Null for every other line. See src/lib/quotes/line-visit.ts.';
