-- THE DAY CLOCK'S SAFETIES (Isaac, 20 November 2026: his Thursday stayed on
-- all night and Friday showed 30 h; "There needs to be a safety for like a
-- maximum working time ... 14 hours. It should automatically stop the clock
-- if no other method has worked", then "Approved, build it" to
-- https://claude.ai/artifact/MNfi9mZUQ5kkuBvRUkv5LC).
--
-- staff_days gains:
--   home_at     when the phone last saw the person get home on this day
--               (the address on their card), for "Clock off at 3:00 pm?"
--               and the time a day left on stops at
--   held_until  Still here: the day's end moves to this, and the 14-hour
--               stop waits for it
--   ended_by    'stop' when the clock stopped itself, not a press
--   stopped_at  when the stop happened (Restart is open for two hours)
--   settled_at  when a stopped day's time went to ServiceM8 and the
--               timesheet (a stop the server makes has no press to send
--               with, so the person's phone settles it next time it asks)
--   seen_at     when the person looked at a stopped day (Keep, or Change)
--
-- staff_job_skips: "Not this job" — a job the person is never asked about
-- again, on any phone.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: new nullable columns and a new table.

alter table public.staff_days
  add column if not exists home_at timestamptz,
  add column if not exists held_until timestamptz,
  add column if not exists ended_by text,
  add column if not exists stopped_at timestamptz,
  add column if not exists settled_at timestamptz,
  add column if not exists seen_at timestamptz;

do $$ begin
  alter table public.staff_days add constraint staff_days_ended_by_check check (ended_by is null or ended_by = 'stop');
exception when duplicate_object then null; end $$;

create index if not exists staff_days_open_idx on public.staff_days (on_at) where off_at is null;

create table if not exists public.staff_job_skips (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id text not null,
  -- ServiceM8's job uuid, lower case
  job_uuid text not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id, job_uuid)
);

comment on table public.staff_job_skips is
  'Jobs a person said "Not this job" to on the phone: never asked about again when they pass one they aren''t booked on.';

alter table public.staff_job_skips enable row level security;

-- THE SWEEP, every 15 minutes from the database, as the sm8-drain heartbeat
-- (docs/plans/queues.md): it sends nothing until heytiff_cron_secret is in
-- Vault. vercel.json runs the same route once a day regardless.
select cron.schedule(
  'heytiff-day-stop',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://go.hey-tiff.com/api/cron/day-stop',
    headers := jsonb_build_object('Authorization', 'Bearer ' || s.decrypted_secret),
    timeout_milliseconds := 60000
  )
  from vault.decrypted_secrets s
  where s.name = 'heytiff_cron_secret';
  $$
);
