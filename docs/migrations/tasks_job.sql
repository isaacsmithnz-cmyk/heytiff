-- ── a task can be for a job (v2, 18 October 2026) ──
-- Isaac: "keep tasks in the new button, have job selection and due section.
-- That way on a job it automatically goes on the job, from home it's a
-- general task." New › Task names the job it is for when it is made on a
-- job's page; from anywhere else the job is empty and it is a general task.
-- `sm8_job_uuid` is the mirror's job uuid, as job_tasks keeps it: the mirror
-- is disposable, the task is ours, so it is not a foreign key.
--
-- Adds a column and an index and nothing else, so version 1 still runs on
-- this data (it never reads the column). Until it is applied, a task made
-- with a job is kept without it (app/actions/dashboard.ts, makeTask).
alter table public.tasks
  add column if not exists sm8_job_uuid text check (sm8_job_uuid is null or char_length(sm8_job_uuid) between 1 and 80);
create index if not exists tasks_job_idx on public.tasks (org_id, sm8_job_uuid) where sm8_job_uuid is not null;
