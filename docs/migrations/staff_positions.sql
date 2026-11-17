-- LIVE LOCATION ON HOME'S MAP (Isaac, 17 November 2026: "add it, i will give
-- notice. we will just have a disclaimer if future businesses want to
-- activate"). A business turns it on (Settings > Business), off by default.
-- While someone is clocked on, their phone sends where it is every two
-- minutes (lib/mobile/where); only the LAST position is kept, one row a
-- person, deleted when they clock off and for everyone when the business
-- turns it off. Read by Home's Schedule map only (lib/dashboard/team-day-query).
-- Applied 17 November 2026 by MCP apply_migration (name staff_positions).
alter table public.organizations add column if not exists live_location boolean not null default false;

create table if not exists public.staff_positions (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m real check (accuracy_m is null or accuracy_m >= 0),
  at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

alter table public.staff_positions enable row level security;
