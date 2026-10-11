-- ── a quote's past versions (2026-10-11) ──
-- Isaac's round-2 mock: before it's accepted, Update quote makes version 2
-- of the quote; the approval comes off and it goes back through Approve and
-- Send. The approved quote is kept here as it stood, numbered: each option's
-- name, its lines with what each came to, and its totals (quote-versions.ts).
-- Written once, never changed. The app reads and writes it with the service
-- role, by org; nobody else may.
create table if not exists public.quote_versions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  sm8_job_uuid  text not null,
  n             integer not null check (n >= 1),
  what          text not null default '',
  snapshot      jsonb not null,
  approved_at   timestamptz,
  approved_by   text,
  made_by       text not null,
  made_at       timestamptz not null default now(),
  unique (org_id, sm8_job_uuid, n)
);
alter table public.quote_versions enable row level security;
