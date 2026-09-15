-- The service record behind a service log.
--
-- A fuel log has had its docket behind it since fuel_receipts_tax.sql; a
-- service log — the mechanic's invoice, the one document that says what was
-- actually done to the vehicle — had nowhere to go. Logging a service typed a
-- note. This gives the invoice a kind of its own, and the work it lists a
-- column of its own.
--
-- ADDITIVE, and safe to apply BEFORE the deploy: a kind nothing writes yet and
-- a column nothing reads yet. It must be applied before the PR merges — the
-- first service record uploaded would otherwise fail the kind CHECK, which is
-- exactly the crash documents_kind_catchup.sql was written after.

-- ---------------------------------------------------------------------------
-- `service_record` is its own kind for the standing reason: the kind is what
-- stops the wrong owner adopting a file. A service invoice is adopted by a
-- SERVICE log and nothing else — not by a fuel log (it would count as fuel in
-- the tax export), not by an expense claim (it would be reimbursed twice).
-- Keep this list and DocumentKind (src/lib/documents/files.ts) in step.
-- ---------------------------------------------------------------------------
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
    'org_licence'::text,
    'org_insurance'::text,
    'service_record'::text,
    'other'::text
  ])
);

-- ---------------------------------------------------------------------------
-- What the workshop did, as the invoice lists it — one line per item. Its own
-- column rather than the tail of `note`, because `note` is the ONE LINE every
-- history row prints ("Service — 100,000 km logbook service") and a list of
-- eleven items does not belong in a row. Nullable: a service logged by hand
-- with no record still has a note and no list.
--
-- No column for the workshop. `station` is the supplier on a fuel log and is
-- the supplier here too; the tax screen already reads it as one.
-- ---------------------------------------------------------------------------
alter table public.vehicle_logs
  add column if not exists work_done text;
