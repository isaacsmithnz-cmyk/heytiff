-- The vehicle record grows up: specs, a photo, a fourth status, and renewals
-- that carry what the certificate actually said.
--
-- WHAT DROVE THIS. Two real documents for one vehicle — a QBE green slip and a
-- Transport for NSW Certificate of Registration — and the register had a home
-- for six of the thirty-odd facts printed on them. VIN, engine number, tare,
-- GVM, seating, variant: nowhere. Policy number, cover type, excess, term:
-- nowhere. A green slip's garaging postcode, a rego's safety-check date:
-- nowhere. The redesigned vehicle modal (design handoff, Sep 2026) renders all
-- of them, and a screen that renders a field the table can't hold is a screen
-- that shows blanks forever.
--
-- COLUMNS, NOT A JSON BAG. Every one of these is a plain scalar a document
-- prints and a person searches for — "which van is VIN …826" is a query, and a
-- jsonb key is not a thing you index, type, or constrain. The long tail this
-- deliberately leaves out (axle code, shape code, billing number) is on the
-- certificate, which is filed against the vehicle and is the better home for
-- things you look up twice a decade.
--
-- ALL NULLABLE, NO DEFAULTS. Eleven vehicles exist and none of them have any
-- of this. An unset spec reads as "not recorded" (lib/fleet/map.ts), never as
-- a value — the same rule the expiry dates learned the hard way.
--
-- APPLY THIS BEFORE MERGING THE PR.

-- ---- what the vehicle IS: the certificate of registration's own fields ----

alter table public.vehicles
  add column if not exists body_type          text
    check (body_type is null or body_type in ('van', 'ute', 'car', 'truck', 'trailer')),
  add column if not exists colour             text,
  add column if not exists vin                text,
  add column if not exists engine_number      text,
  add column if not exists engine_capacity_cc integer check (engine_capacity_cc is null or engine_capacity_cc > 0),
  add column if not exists seating            integer check (seating is null or seating > 0),
  add column if not exists tare_kg            integer check (tare_kg is null or tare_kg > 0),
  add column if not exists gvm_kg             integer check (gvm_kg is null or gvm_kg > 0),
  -- trailers have no GVM in the driver's sense; ATM is the figure on their plate
  add column if not exists atm_kg             integer check (atm_kg is null or atm_kg > 0),
  add column if not exists variant            text,
  -- the road authority's customer number for this registration — what Service
  -- NSW asks for on the phone. Stable across renewals, so it lives here.
  add column if not exists rego_customer_no   text,
  -- the photo on the card. A pointer, not a copy: the document row owns the
  -- file, its kind, and its signed URL like every other file in the app.
  add column if not exists photo_document_id  uuid;

comment on column public.vehicles.body_type is
  'What shape of thing this is — drives the placeholder illustration and the CTP vehicle class. Null = not recorded.';
comment on column public.vehicles.vin is
  'Vehicle identification / chassis number as printed on the registration certificate.';

-- A vehicle that is FOR SALE is still in the fleet: it needs rego, it needs
-- insurance, it can still be driven. Sold is the exit. Both exist because a
-- for-sale vehicle that got filed as sold would stop being warned about.
alter table public.vehicles drop constraint if exists vehicles_status_check;
alter table public.vehicles
  add constraint vehicles_status_check
  check (status in ('active', 'offroad', 'for_sale', 'sold'));

-- ---- what the renewal SAID: the rest of the certificate ----

alter table public.vehicle_policies
  add column if not exists policy_number     text,
  -- insurance only; the kind of cover decides what a claim pays for
  add column if not exists cover             text
    check (cover is null or cover in ('comprehensive', 'third_party_property', 'third_party_fire_theft')),
  add column if not exists excess            numeric(10, 2) check (excess is null or excess >= 0),
  add column if not exists term_months       integer check (term_months is null or term_months > 0),
  -- CTP: the postcode the premium was rated on
  add column if not exists garaging_postcode text,
  -- rego: the safety check (pink slip) date, where one was required
  add column if not exists inspection_on     date,
  -- HOW the row got here. "scanned from the certificate" and "entered by
  -- hand" are different levels of trust and the screen says which.
  add column if not exists source            text
    check (source is null or source in ('scan', 'manual'));

-- ---- documents filed under a policy ----
--
-- A policy has more than one piece of paper — the certificate, the schedule,
-- the receipt. `vehicle_policies.document_id` stays what it always was: the
-- ONE document the row was read from. `documents.policy_id` is the filing:
-- every document that belongs under this policy, the scanned one included.
-- Hard owner column, like the seven before it, for the standing reason.
alter table public.documents
  add column if not exists policy_id uuid references public.vehicle_policies (id) on delete set null;

create index if not exists documents_policy_idx
  on public.documents (policy_id)
  where policy_id is not null;

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
    'other'::text
  ])
);
