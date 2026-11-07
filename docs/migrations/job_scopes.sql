-- ── A JOB'S SCOPE (Isaac, 28 October 2026: "a common point where a quote can
-- get built from"; layout B, the written brief, of
-- https://claude.ai/artifact/SJBwjp8GmvKAFYuV6ufryT) ──
--
-- The brief Tiff writes at the top of a job's Overview from everything on the
-- job: its systems area by area, what was added, what isn't ours, what is
-- still to clarify, and the latest updates that shaped it
-- (src/lib/jobs/job-scope.ts). One row a job. Rewritten only when the job's
-- story has moved past `story_stamp`, as job_summaries is.
create table if not exists public.job_scopes (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  job_uuid     text not null,
  brief        jsonb not null,
  story_stamp  text not null,
  written_at   timestamptz not null default now(),
  primary key (org_id, job_uuid)
);
alter table public.job_scopes enable row level security;
