-- AN ISSUE WITH A TASK, ON THE DAY (Isaac, 25 October 2026, on the job
-- page's mock: "on the day a task has Done, Started (25, 50, 75) and
-- Issue").
--
-- Issue on a task's Started menu asks what's wrong, with a photo if there
-- is one, and the task wears it until it is cleared: the note, who said
-- it and when, and the photo as a job document (kind job_document, on the
-- same job, uploaded through the job's own files).
--
-- SAFE TO APPLY BEFORE THE PR MERGES: four nullable columns, every
-- existing task null (no issue). Additive and idempotent; nothing existing
-- is dropped or altered.

alter table public.job_tasks add column if not exists issue_note text check (issue_note is null or char_length(issue_note) between 1 and 500);
alter table public.job_tasks add column if not exists issue_photo_document_id uuid references public.documents (id) on delete set null;
alter table public.job_tasks add column if not exists issue_by text;
alter table public.job_tasks add column if not exists issue_at timestamptz;

comment on column public.job_tasks.issue_note is
  'What''s wrong with the task, as the person on the day said it; null when it has no issue. See docs/migrations/job_task_issues.sql.';
comment on column public.job_tasks.issue_photo_document_id is
  'A photo of the issue, a job document on the same job; null when none was added.';
comment on column public.job_tasks.issue_by is 'Who said what''s wrong, by name.';
comment on column public.job_tasks.issue_at is 'When the issue was said.';
