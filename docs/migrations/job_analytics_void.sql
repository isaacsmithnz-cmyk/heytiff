-- VOID: A JOB THAT WASN'T ONE (Isaac, 2026-10-07: "i also need a way to mark
-- jobs void or something, unsuccessful isnt accurate for invalid jobs").
--
-- A fifth question on job_analytics_decisions, `void`, whose one answer is
-- `void`: a duplicate, a test, spam, a job raised by mistake. The analytics
-- take a void job out before anything is counted (src/lib/analytics/
-- job-analytics.ts), and Undo deletes the row. ServiceM8 has no void; its own
-- word for a job that wasn't one is deleting it, which the mirror then leaves
-- out by itself (`active = 0`).
--
-- Widens the question check job_analytics_decisions.sql made, and nothing
-- else. SAFE TO APPLY BEFORE THE PR MERGES: the code before it never writes
-- `void`, and every row it wrote still passes.

alter table public.job_analytics_decisions
  drop constraint if exists job_analytics_decisions_question_check;

alter table public.job_analytics_decisions
  add constraint job_analytics_decisions_question_check
  check (question in ('quote', 'kind', 'price', 'outcome', 'void'));
