-- CTP (the green slip) becomes a renewal of its own.
--
-- WHAT WENT WRONG WITHOUT IT. `vehicle_policies.kind` had two values, and an
-- Australian vehicle carries three renewals: registration, CTP, and whatever
-- comprehensive/third-party-property cover the business chooses to hold. A
-- green slip filed as `insurance` overwrote `vehicles.insurance_expiry` — the
-- cache every chip, filter and attention count reads — so the CTP date quietly
-- became the comprehensive date and the warning that matters when a truck is
-- written off went silent. Filed as `rego` it wrote a CTP period into the rego
-- column and the reader was being asked to find a road authority on a document
-- issued by an insurer.
--
-- Caught on a real QBE green slip for the Triton: QBE, 30/09/2026–29/09/2027,
-- $945.54. There was nowhere correct to put it.
--
-- WHY NOT ONE "REGO" DATE FOR BOTH. In NSW the two normally fall on the same
-- day, so one date would be right most of the time. But the green slip is what
-- the registration renewal DEPENDS on — let it lapse and the rego cannot be
-- renewed at all — and "right most of the time" is not a warning. They are also
-- bought from different parties on different paper, and the whole point of the
-- policy table is that what you paid and who you paid it to is a record.
--
-- THE COLUMN IS A CACHE, exactly like the other two: the newest policy row of
-- the kind is the record, and this is what the register reads so nothing below
-- it has to learn that policies exist. Nullable with no default — a vehicle
-- nobody has filed a green slip for has no CTP date, and 'unknown' must read as
-- "not soon" rather than "expired" (lib/fleet/map.ts does that).
--
-- APPLY THIS BEFORE MERGING THE PR.

alter table public.vehicles
  add column if not exists ctp_expiry date;

comment on column public.vehicles.ctp_expiry is
  'Cache of the newest CTP (green slip) policy''s expiry. The record is vehicle_policies.';

-- Three kinds now. The constraint is the thing that stops a typo'd kind from
-- becoming a fourth renewal nobody renders.
alter table public.vehicle_policies
  drop constraint if exists vehicle_policies_kind_check;

alter table public.vehicle_policies
  add constraint vehicle_policies_kind_check check (kind in ('insurance', 'rego', 'ctp'));

-- The certificate itself. Its own document kind for the standing reason: the
-- kind is what stops the wrong owner adopting a file, and a green slip must not
-- be adoptable as the comprehensive policy it is not. Keep this list and
-- DocumentKind (src/lib/documents/files.ts) in step.
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
    'other'::text
  ])
);
