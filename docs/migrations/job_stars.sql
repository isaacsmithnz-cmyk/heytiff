-- ── a job you starred (Isaac, 24 November 2026, bugs 78 and 89) ──
-- Booking a job into your day to remember it made Today show visits that
-- weren't. A star keeps a job where you can find it (the phone's Jobs ›
-- Starred), with Add task for anything to do; the schedule is left to real
-- visits. Starred is yours alone: one row per person, per job.
--
-- `user_id` is the sign-in (Auth0's sub), as memberships.user_id and
-- nav_pins.user_sub keep it, so a star needs no staff card. `sm8_job_uuid`
-- is the mirror's job uuid, as tasks keep it: the mirror is disposable, the
-- star is ours, so it is not a foreign key.
--
-- POSTURE: RLS ON, NO policies, as tasks: the app reads and writes it with
-- the service role, by org and sign-in. Adds a table and nothing else.
create table if not exists public.job_stars (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_id       text not null check (char_length(user_id) between 1 and 200),
  sm8_job_uuid  text not null check (char_length(sm8_job_uuid) between 1 and 80),
  created_at    timestamptz not null default now(),
  unique (org_id, user_id, sm8_job_uuid)
);
create index if not exists job_stars_mine_idx on public.job_stars (org_id, user_id, created_at desc);
alter table public.job_stars enable row level security;
