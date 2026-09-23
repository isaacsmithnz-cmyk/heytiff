-- A document somebody HERE puts on a ServiceM8 job.
--
-- The job card's Documents face listed only what ServiceM8 holds, so a
-- certificate of compliance, the builder's plans or a supplier's quote had
-- nowhere to go but ServiceM8 itself — and the mirror is read-only by charter.
-- The face now takes an upload, and the file lives here.
--
-- ITS OWN KIND for the standing reason: the kind is what stops the wrong owner
-- adopting a file. `job_file` is the nearest neighbour and exactly wrong — it
-- is a re-fetchable CACHE of ServiceM8's own bytes, keyed by their attachment
-- uuid, and nobody uploaded it. A job document is the opposite: somebody put
-- it here, ServiceM8 never had it, and nothing can fetch it again.
--
-- NO NEW COLUMN. The owner is the job, and `documents.sm8_job_uuid` already
-- exists (with `documents_sm8_job_idx` on (org_id, sm8_job_uuid)). The row's
-- `source` stays at its default, 'manual', which is what keeps it out of every
-- read of the ServiceM8 cache — each of those filters `source = 'servicem8'`.
--
-- Keep this list and DocumentKind (src/lib/documents/files.ts) in step.
--
-- APPLY THIS BEFORE MERGING THE PR: until it runs, an upload from the job card
-- is refused at the row insert and the face says "Couldn't start that upload."

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
