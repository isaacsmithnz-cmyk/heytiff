-- WHY YOU WERE THERE, on a stretch of time at a job (Isaac, 28 October 2026:
-- "quick buttons like site meeting, help team… so that hour, that time can
-- get attributed… as a cost no matter what"). Time at an open job you
-- weren't booked on goes on it by itself; the phone's buttons say why. No
-- reason is plain labour. It stays in HeyTiff: ServiceM8 gets the time.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: a new nullable column nothing reads yet.

alter table public.job_check_ins add column if not exists reason text;

do $$ begin
  alter table public.job_check_ins add constraint job_check_ins_reason_known check (reason is null or reason in ('site_meeting', 'helping'));
exception when duplicate_object then null; end $$;
