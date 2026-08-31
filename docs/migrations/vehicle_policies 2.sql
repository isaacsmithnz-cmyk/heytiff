-- Renewals become a history instead of a field you overwrite (issue #509,
-- slice 2).
--
-- WHAT ISAAC ASKED FOR. When a vehicle's insurance or rego is near expiry, an
-- Update button appears; you drop the new document in, it is scanned, the
-- expiry updates, "and then the previous one gets stored under previous
-- versions". Plus: a record of ALL the insurances, and the insurance cost over
-- time.
--
-- WHY A TABLE AND NOT A COLUMN. `vehicles.insurance_expiry` is one date: it
-- answers "when does this expire" and destroys the answer to "what have we
-- paid to insure this van since 2022" every time it is written. Cost-over-time
-- needs ROWS. The date on the vehicle stays — every chip, filter and attention
-- count reads it and none of them should learn about policies — but it becomes
-- a DERIVED cache of the newest row rather than the only record.
--
-- ONE TABLE, TWO KINDS. A rego renewal is the same shape as an insurance
-- renewal: a document, a period, a cost. Isaac framed it that way himself —
-- "insurance or the rego or whatever document has expired". Splitting them
-- would mean two tables with identical columns and two of every query.
--
-- THE PREVIOUS VERSION IS NOT A SEPARATE STORE. It is simply an older row.
-- "Current" is the one with the latest expires_on, and everything under it is
-- history by construction — nothing is moved, archived or flagged, so there is
-- no state that can disagree with itself.
--
-- premium is NULLABLE and never derived: a policy schedule that does not print
-- a price must not have one invented, for the same reason fuel GST is never
-- divided out of a total. No premium read means no premium charted.
--
-- POSTURE: RLS on with no policies, like every other table here — service-role
-- only, behind the app-layer `assets_all` gate.
--
-- APPLY THIS BEFORE MERGING THE PR.

create table if not exists public.vehicle_policies (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  vehicle_id  uuid not null references public.vehicles (id) on delete cascade,
  kind        text not null check (kind in ('insurance', 'rego')),
  -- who it is with: an insurer, or the road authority for a rego notice
  provider    text,
  -- what it cost, GST inclusive, as printed. Null = the document didn't say.
  premium     numeric(10, 2) check (premium is null or premium >= 0),
  starts_on   date,
  expires_on  date not null,
  -- the scanned document this row was read from; null if entered by hand
  document_id uuid,
  created_at  timestamptz not null default now()
);

comment on table public.vehicle_policies is
  'One row per insurance policy or rego renewal. The newest expires_on is current; older rows are the history, and the vehicle''s expiry column caches the newest.';

-- The read: one vehicle's history, newest first.
create index if not exists vehicle_policies_vehicle_idx
  on public.vehicle_policies (vehicle_id, kind, expires_on desc);

create index if not exists vehicle_policies_org_idx
  on public.vehicle_policies (org_id);

alter table public.vehicle_policies enable row level security;

-- The renewal documents themselves. Two kinds for the standing reason: the
-- kind is what stops the wrong owner adopting a file. Keep this list and
-- DocumentKind in step — documents_kind_catchup.sql is what happens otherwise.
alter table public.documents drop constraint if exists documents_kind_check;

alter table public.documents add constraint documents_kind_check check (
  kind = any (array[
    'notice_attachment'::text,
    'receipt'::text,
    'fuel_receipt'::text,
    'medical_certificate'::text,
    'licence'::text,
    'work_rights'::text,
    'org_logo'::text,
    'staff_photo'::text,
    'project_file'::text,
    'job_file'::text,
    'purchase_invoice'::text,
    'insurance_policy'::text,
    'rego_notice'::text,
    'other'::text
  ])
);
