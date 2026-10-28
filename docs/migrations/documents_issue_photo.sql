-- A PHOTO OF WHAT'S WRONG WITH A VEHICLE: `issue_photo` joins the kinds
-- (src/lib/documents/files.ts). Taken with the phone when an issue is
-- reported, adopted by that issue's vehicle log and nothing else (Isaac,
-- 28 October 2026: the phone's Report an issue, "with a photo if it helps").
--
-- KEEP THIS LIST AND DocumentKind IN STEP (documents_kind_catchup.sql says
-- why). This is the constraint as production holds it on 29 October 2026,
-- with `issue_photo` added.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: it only widens what may be written.

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
    'job_document'::text,
    'job_photo'::text,
    'purchase_invoice'::text,
    'insurance_policy'::text,
    'rego_notice'::text,
    'green_slip'::text,
    'vehicle_photo'::text,
    'finance_agreement'::text,
    'org_licence'::text,
    'org_insurance'::text,
    'service_record'::text,
    'issue_photo'::text,
    'other'::text
  ])
);
