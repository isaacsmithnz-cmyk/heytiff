-- ── A JOB'S SCOPE, KEPT UP TO DATE, WITH UNDO (slice 2 of the scope) ──
--
-- previous_brief: the brief as it stood before Tiff's newest change, so Undo
-- puts it back at once with no new read. Null once it has been taken back.
-- set_aside: what someone took out, so Tiff leaves it out of later rewrites
-- unless the job's record asks again.

alter table public.job_scopes
  add column if not exists previous_brief jsonb,
  add column if not exists set_aside jsonb not null default '[]'::jsonb;
