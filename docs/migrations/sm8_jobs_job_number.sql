-- The phone's All jobs, newest number first (Isaac, 8 November 2026: "start
-- the list in numerical order from most recent to earliest").
--
-- ServiceM8 keeps a job's number as text, and text sorts 999 above 3518. This
-- adds the number's digits as an integer, worked out by Postgres from
-- generated_job_id on every write, so the sync never sets it and nothing that
-- writes the mirror changes. A clone's letter is dropped: 3323A is 3323, and
-- the list then orders a family by its text, 3323, 3323A, 3323B.
--
-- Additive: nothing reads it until the deploy does. APPLY BEFORE MERGING.

alter table public.sm8_jobs
  add column if not exists job_number integer
  generated always as (nullif(substring(generated_job_id from '^[0-9]{1,9}'), '')::integer) stored;

create index if not exists sm8_jobs_org_active_job_number_idx
  on public.sm8_jobs (org_id, active, job_number desc nulls last, generated_job_id);
