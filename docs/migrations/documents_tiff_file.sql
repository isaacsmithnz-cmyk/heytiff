-- A PHOTO OR PDF HANDED TO TIFF: `tiff_file` joins the kinds
-- (src/lib/documents/files.ts). Added with the plus in her box on the phone, read back for her
-- answer for the person who added it, and adopted by nothing (Isaac, 1 November 2026: "the plus
-- symbol to add photo or other file").
--
-- KEEP THIS LIST AND DocumentKind IN STEP (documents_kind_catchup.sql says why).

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
    'purchase_docket'::text,
    'insurance_policy'::text,
    'rego_notice'::text,
    'green_slip'::text,
    'vehicle_photo'::text,
    'finance_agreement'::text,
    'org_licence'::text,
    'org_insurance'::text,
    'service_record'::text,
    'issue_photo'::text,
    'tiff_file'::text,
    'other'::text
  ])
);
