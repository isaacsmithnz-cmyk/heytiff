-- WHAT SOMEBODY DECIDED ABOUT A JOB FOR THE ANALYTICS — the To decide tab
-- (Isaac, 2026-10-07: "anything unknown or questionable should be manually
-- decided"; docs/job-analytics-plan.md).
--
-- The analytics read ServiceM8's copy, and some jobs can't be placed from it:
-- a work order with no quote sent that looks like an install, a job whose kind
-- can't be read, a price far from its kind's, Unsuccessful but paid. One row
-- here is a person's answer to one of those questions about one job, and the
-- figures read it in place of what was worked out. Undo deletes the row.
--
--   question  answers
--   quote     quote | not_quote
--   kind      split | multi | ducted | vrf | service | maintenance
--   price     count | leave_out
--   outcome   won | lost
--
-- The answers are checked by the action that writes them
-- (src/app/actions/analytics-decide.ts), not here, so a new kind of job is a
-- code change and not a migration.
--
-- KEYED BY sm8_job_uuid, NOT A FOREIGN KEY, for the reason job_picklist.sql
-- gives: the mirror is a disposable cache, and a decision must outlive it.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: a new table nothing reads yet. Until it
-- is applied, the To decide tab shows its questions and says the answers
-- can't be kept yet.

create table if not exists public.job_analytics_decisions (
  org_id uuid not null references public.organizations (id) on delete cascade,
  sm8_job_uuid text not null,
  question text not null check (question in ('quote', 'kind', 'price', 'outcome')),
  answer text not null,
  -- the person, as every other "added_by" in the app: their auth user id
  decided_by text not null,
  decided_at timestamptz not null default now(),
  primary key (org_id, sm8_job_uuid, question)
);

comment on table public.job_analytics_decisions is
  'Answers given on the Analytics To decide tab: one per job and question. The figures read them in place of what was worked out from ServiceM8''s copy.';
comment on column public.job_analytics_decisions.sm8_job_uuid is
  'sm8_jobs.uuid. Deliberately NOT a foreign key: the mirror is disposable.';

-- RLS deny-all, enforcement app-layer, same as every other table here: the
-- service role is the only path in, and the action re-checks the org and
-- workboard_money for itself.
alter table public.job_analytics_decisions enable row level security;
