-- A PHOTO TAKEN ON A JOB WITH THE PHONE: `job_photo` joins the kinds
-- (src/lib/documents/files.ts). Owned by the job (documents.sm8_job_uuid) as
-- a `job_document` is, but a picture of the work: it reads among the job's
-- photos and goes to ServiceM8 as one (Isaac, 27 October 2026).
--
-- KEEP THIS LIST AND DocumentKind IN STEP (documents_kind_catchup.sql says
-- why). This is the constraint as production holds it on 27 October 2026,
-- with `job_photo` added.
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
    'other'::text
  ])
);
