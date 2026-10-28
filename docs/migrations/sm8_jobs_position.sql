-- WHERE A JOB IS, as ServiceM8 geocoded its address (the job object's `lat`
-- and `lng`, read only, under read_jobs, kept only when its `geo_is_valid`
-- is 1). The phone app's day clock needs it: arriving at a job puts your time
-- on it (Isaac, 28 October 2026: "the GPS is tracking you moving between
-- jobs… if it's open and I'm nearby, it could pop up saying add time to this
-- job").
--
-- APPLY BEFORE THE PR MERGES: the sync writes these columns as soon as the
-- new pick list deploys, and an upsert naming a column the table lacks fails.

alter table public.sm8_jobs add column if not exists lat double precision;
alter table public.sm8_jobs add column if not exists lng double precision;
