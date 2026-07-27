-- rate_calc_state joins the schema properly. APPLIED 2026-07-28.
--
-- The audit's B5: this table's DDL lived only as a comment inside
-- src/app/actions/rate-calc.ts, its org_id was TEXT where every sibling uses
-- uuid, and it had no FK — so deleting an organisation orphaned a blob
-- holding the org's whole cost model. The two ALTERs below were applied to
-- prod (single row, value verified castable, org verified present first).
-- The CREATE records the corrected shape for a rebuild.

create table if not exists public.rate_calc_state (
  org_id         uuid primary key references public.organizations (id) on delete cascade,
  state          jsonb not null,
  schema_version integer not null default 1,
  updated_by     text,
  updated_at     timestamptz not null default now()
);
alter table public.rate_calc_state enable row level security;
-- no policies: service-role access only, same posture as studio_designs

-- Applied to the live table (which predates this file):
alter table public.rate_calc_state
  alter column org_id type uuid using org_id::uuid;
alter table public.rate_calc_state
  add constraint rate_calc_state_org_fkey
    foreign key (org_id) references public.organizations (id) on delete cascade;
