-- A JOB TASK'S QUOTED HOURS (slice 8.2; Isaac's go 2026-10-09: "those tasks
-- then get put straight on to the job").
--
-- A quote worked out task by task (quote_line_visits.sql) hands its tasks
-- to the job when an option is accepted, each placed on the visit day most
-- of it falls on (src/lib/workboard/task-plan.ts tasksFromQuote). Each keeps
-- the person-hours the quote gave it, shown beside it on the job card.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: one nullable column, every existing
-- task null (no hours). Additive and idempotent.

alter table public.job_tasks add column if not exists hours numeric check (hours is null or hours >= 0);

comment on column public.job_tasks.hours is
  'The person-hours the accepted quote gave this task; null for a task Tiff wrote from the quote or a person added.';
