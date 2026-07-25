-- org_credentials — the business's own licences and insurance policies, as ROWS.
--
-- WHY: they were five flat columns on `organizations` (arc_rta,
-- contractor_licence, insurer, insurance_policy, insurance_expiry), which meant
-- exactly one ARC authorisation, exactly one contractor licence and exactly one
-- insurance policy — and a second public-liability policy, a professional
-- indemnity, or a workers-compensation policy had nowhere to go. Staff licences
-- have been rows since day one (staff_licences); this is the same shape for the
-- company, so the screen can show a wall of credential cards rather than a form.
--
-- POSTURE: RLS is ON with NO policies, like every other table here — the
-- anon/authenticated keys can read nothing, and every access goes through the
-- service-role client behind an app-layer owner gate (app/actions/org-credentials.ts).
--
-- APPLY THIS BEFORE MERGING THE PR. The code stops reading the flat columns.

create table if not exists public.org_credentials (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  kind        text not null check (kind in ('licence', 'insurance')),
  name        text not null,
  number      text,
  issuer      text,
  expiry_date date,
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create index if not exists org_credentials_org_id_idx on public.org_credentials (org_id);

alter table public.org_credentials enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)

-- ---------------------------------------------------------------------------
-- Backfill: carry what the flat columns already hold into rows. Each INSERT is
-- guarded on a non-empty source value, so an org that never filled a field gets
-- no empty card. `where not exists` keeps this re-runnable.
-- ---------------------------------------------------------------------------

insert into public.org_credentials (org_id, kind, name, number, color)
select o.id, 'licence', 'ARC refrigerant trading authorisation', trim(o.arc_rta), '#00A389'
from public.organizations o
where coalesce(trim(o.arc_rta), '') <> ''
  and not exists (
    select 1 from public.org_credentials c
    where c.org_id = o.id and c.name = 'ARC refrigerant trading authorisation'
  );

insert into public.org_credentials (org_id, kind, name, number, color)
select o.id, 'licence', 'Contractor licence', trim(o.contractor_licence), '#F0A431'
from public.organizations o
where coalesce(trim(o.contractor_licence), '') <> ''
  and not exists (
    select 1 from public.org_credentials c
    where c.org_id = o.id and c.name = 'Contractor licence'
  );

-- Insurance carries three columns into one row: the insurer is the issuer, the
-- policy number is the number, and the expiry is the expiry. A policy with only
-- an expiry (no insurer, no number) is still worth keeping — that date is what
-- raises the dashboard chip.
insert into public.org_credentials (org_id, kind, name, number, issuer, expiry_date, color)
select
  o.id,
  'insurance',
  'Public liability',
  nullif(trim(o.insurance_policy), ''),
  nullif(trim(o.insurer), ''),
  o.insurance_expiry,
  '#2E68FF'
from public.organizations o
where (
    coalesce(trim(o.insurer), '') <> ''
    or coalesce(trim(o.insurance_policy), '') <> ''
    or o.insurance_expiry is not null
  )
  and not exists (
    select 1 from public.org_credentials c
    where c.org_id = o.id and c.kind = 'insurance' and c.name = 'Public liability'
  );

-- ---------------------------------------------------------------------------
-- LATER, as a separate cleanup migration once this has been live long enough to
-- trust the backfill (nothing in the app reads or writes these columns from the
-- org-react PR onwards):
--
--   alter table public.organizations
--     drop column arc_rta,
--     drop column contractor_licence,
--     drop column insurer,
--     drop column insurance_policy,
--     drop column insurance_expiry;
-- ---------------------------------------------------------------------------
