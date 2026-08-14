-- The kind CHECK had fallen four behind the code.
--
-- FOUND BY A PROD CRASH, 2026-08-14: caching a ServiceM8 job photo returned a
-- 503 in 1–6 seconds — too fast for a timeout, which is what made it a
-- constraint violation rather than a slow function. `job_file` was the kind
-- being written and the CHECK didn't list it.
--
-- The other three are the same bug, older and unfired. `DOCUMENT_KINDS` in
-- src/lib/documents/files.ts has carried `fuel_receipt`,
-- `medical_certificate` and `project_file` for some time; the constraint
-- never learned them, and `documents` holds exactly one row in production
-- (a staff photo), so nothing had ever tried. Attaching a file to a project,
-- claiming a fuel docket, or uploading a medical certificate would each have
-- failed the same way this did. Widening is the fix: the application already
-- treats all four as valid, and a CHECK that disagrees with the type is a
-- trap waiting for the first user of each feature.
--
-- KEEP THIS LIST AND DocumentKind IN STEP. They are two statements of one
-- fact, and this migration exists because they drifted.

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
    'other'::text
  ])
);
