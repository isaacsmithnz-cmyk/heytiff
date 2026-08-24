-- A vehicle gets a paper trail (issue #509, slice 1: the purchase invoice).
--
-- Isaac's spec: when you type in a purchase price, you should be able to
-- upload the receipt or invoice of the purchase — and each vehicle should
-- show its documents. The fuel docket set the pattern (fuel_receipts_tax.sql):
-- a figure with the document behind it, adopted onto the row it substantiates.
--
-- A HARD COLUMN, LIKE THE THREE BEFORE IT. documents already carries
-- expense_claim_id, notice_id and vehicle_log_id — this table has chosen hard
-- owner columns over a polymorphic pair three times, because a (type, id)
-- pair is a foreign key nothing can enforce. vehicle_id is the fourth owner:
-- a document that belongs to the VEHICLE itself (its purchase invoice today;
-- insurance policies and service records arrive in later slices), not to any
-- single log row.
--
-- Nullable because the upload comes FIRST: the invoice is uploaded and
-- scanned while the vehicle form is still open, and for a new vehicle the row
-- it belongs to doesn't exist until Save. Between those moments the document
-- is an orphan with no owner, which every read already filters out.
--
-- The kind CHECK is widened in the same migration that teaches the code the
-- kind, because documents_kind_catchup.sql exists to remember what happens
-- when the constraint and DocumentKind drift: a prod 503 on first use.
-- `purchase_invoice` is its own kind for the standing reason — the kind is
-- what stops an expense claim adopting the van's purchase paperwork and
-- putting a $45,000 vehicle into someone's reimbursements.
--
-- APPLY THIS BEFORE MERGING THE PR.

alter table public.documents
  add column if not exists vehicle_id uuid;

create index if not exists documents_vehicle_idx
  on public.documents (vehicle_id)
  where vehicle_id is not null;

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
    'other'::text
  ])
);
