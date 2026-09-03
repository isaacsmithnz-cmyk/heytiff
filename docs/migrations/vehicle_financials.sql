-- The vehicle's money, as paper states it: the purchase invoice's own fields
-- and the finance agreement behind the repayments (vehicle modal v2, phase 2).
--
-- WHAT THE SCREEN RENDERS. The Financials screen of the redesigned vehicle
-- card shows the purchase as the invoice prints it (supplier, invoice number,
-- ex-GST, GST, on-road costs, deposit, odometer at purchase), the finance
-- agreement as the lender wrote it (lender, agreement number, type, start,
-- term, repayment, rate, balloon, amount financed), and a cost to run built
-- from what has actually been logged. The register held one price and one
-- date. Everything else here is a field a document prints and a person will
-- want to look up — at tax time, at trade-in, when the lender rings.
--
-- PURCHASE: COLUMNS ON THE VEHICLE. A vehicle is bought once. The seven fields
-- sit beside purchase_price and purchase_date, which they detail; all
-- nullable, no defaults, for the standing reason — an unset figure reads as
-- "not recorded" (lib/fleet/map.ts), never as $0.
--
-- FINANCE: A TABLE. A vehicle can be refinanced, and the agreement that ended
-- is still the answer to "what did we pay the lender in FY24". Same shape as
-- vehicle_policies: one row per agreement, the newest starts_on is current,
-- older rows are history by construction. Nothing is derived here: ENDS is
-- starts_on + term_months, and the "estimated position" the screen shows is
-- arithmetic on the schedule the agreement itself states, labelled as such.
-- Payments are not tracked; the payout figure is the lender's to confirm.
--
-- lender, starts_on and term_months are NOT NULL: without them there is no
-- schedule, and a finance row that cannot say when it ends is not a record.
-- Every money figure is nullable and never invented.
--
-- POSTURE: RLS on with no policies — service-role only, behind the app-layer
-- `assets_all` gate, like every other fleet table.
--
-- APPLY THIS BEFORE MERGING THE PR.

-- ---- the purchase, as the invoice prints it ----

alter table public.vehicles
  add column if not exists purchase_supplier   text,
  add column if not exists purchase_invoice_no text,
  add column if not exists purchase_ex_gst     numeric(12, 2) check (purchase_ex_gst is null or purchase_ex_gst >= 0),
  add column if not exists purchase_gst        numeric(12, 2) check (purchase_gst is null or purchase_gst >= 0),
  -- stamp duty, rego and CTP on the purchase, dealer delivery: the dealer's
  -- "on-road costs" line, as one figure
  add column if not exists purchase_on_road    numeric(12, 2) check (purchase_on_road is null or purchase_on_road >= 0),
  add column if not exists purchase_deposit    numeric(12, 2) check (purchase_deposit is null or purchase_deposit >= 0),
  add column if not exists purchase_odometer   integer check (purchase_odometer is null or purchase_odometer >= 0);

comment on column public.vehicles.purchase_deposit is
  'What was paid up front. With a finance agreement, the rest was financed; without one, purchase_price was paid in full. Null = not recorded.';
comment on column public.vehicles.purchase_odometer is
  'Odometer reading at purchase, as the invoice or delivery receipt shows it. Null = not recorded.';

-- ---- the finance agreement ----

create table if not exists public.vehicle_finance (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  vehicle_id      uuid not null references public.vehicles (id) on delete cascade,
  lender          text not null,
  agreement_no    text,
  kind            text
    check (kind is null or kind in ('chattel_mortgage', 'finance_lease', 'novated_lease', 'hire_purchase', 'loan')),
  starts_on       date not null,
  term_months     integer not null check (term_months > 0 and term_months <= 240),
  -- one repayment, in dollars, at the stated frequency
  repayment       numeric(12, 2) check (repayment is null or repayment >= 0),
  frequency       text not null default 'monthly'
    check (frequency in ('monthly', 'fortnightly', 'weekly')),
  rate_pct        numeric(6, 3) check (rate_pct is null or (rate_pct >= 0 and rate_pct < 100)),
  balloon         numeric(12, 2) check (balloon is null or balloon >= 0),
  amount_financed numeric(12, 2) check (amount_financed is null or amount_financed >= 0),
  -- the scanned agreement this row was read from; null if entered by hand
  document_id     uuid,
  -- "scanned from the document" and "entered by hand" are different levels of
  -- trust, and the screen says which
  source          text check (source is null or source in ('scan', 'manual')),
  created_at      timestamptz not null default now()
);

comment on table public.vehicle_finance is
  'One row per finance agreement on a vehicle. The newest starts_on is current; older rows are the history. Ends on starts_on + term_months; nothing here tracks payments made.';

create index if not exists vehicle_finance_vehicle_idx
  on public.vehicle_finance (vehicle_id, starts_on desc);

create index if not exists vehicle_finance_org_idx
  on public.vehicle_finance (org_id);

alter table public.vehicle_finance enable row level security;

-- ---- documents filed under an agreement ----
--
-- Same split as policies: `vehicle_finance.document_id` is the ONE document
-- the row was read from; `documents.finance_id` is the filing — every piece
-- of paper that belongs under this agreement, the scanned one included.
alter table public.documents
  add column if not exists finance_id uuid references public.vehicle_finance (id) on delete set null;

create index if not exists documents_finance_idx
  on public.documents (finance_id)
  where finance_id is not null;

-- Keep this list and DocumentKind (src/lib/documents/files.ts) in step.
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
    'green_slip'::text,
    'vehicle_photo'::text,
    'finance_agreement'::text,
    'other'::text
  ])
);
