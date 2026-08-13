-- ServiceM8 attachment METADATA mirror — the job-media track's first table.
--
-- Inherits sm8_mirror.sql's doctrine whole: disposable cache, natural key
-- (org_id, uuid), every native field TEXT except integer flags, no CHECK
-- constraints on mirrored values, RLS on with no policies, wiped on
-- disconnect (SM8_WIPE_TABLES maps over SM8_OBJECTS, so this table joins the
-- wipe by existing).
--
-- METADATA ONLY, BYTES NEVER. What a file IS — name, type, which job, photo
-- dimensions, whether it's the quote or the invoice — lands here. The file
-- CONTENT is the next PR's lazy cache in the documents bucket, fetched on
-- first view; content must not live in a table that disconnect wipes, and a
-- mirror row must stay cheap enough to pull thousands of.
--
-- DELIBERATELY ABSENT, same privacy posture as sm8_staff and sm8_jobs:
--   extracted_info   the file's OCR'd text — content, not metadata, and
--                    unbounded; if search ever wants it, it can be re-pulled
--   metadata         free-form JSON ServiceM8 attaches
--   signature_data   signer name and signature — identity data with no
--                    reader here
--   lat / lng        photo GPS — the same location line sm8_jobs draws
-- The shape test pins these absences.
--
-- `timestamp` is ServiceM8's own field name for creation time; kept verbatim
-- like every other mirrored column (it is an unreserved word in Postgres).
--
-- APPLY THIS BEFORE MERGING THE PR. Until the account is reconnected with
-- read_job_attachments the sync records "Reconnect ServiceM8 to grant …" on
-- this object and keeps walking the others; the moment the grant lands, the
-- backfill fills this table with no further deploy.

create table if not exists public.sm8_attachments (
  org_id                uuid not null references public.organizations(id) on delete cascade,
  uuid                  text not null,
  -- 'job' | 'company' | …, lowercase verbatim; reads filter on it.
  related_object        text,
  related_object_uuid   text,
  attachment_name       text,
  -- Extension with the leading dot, lowercase: '.jpg', '.pdf'.
  file_type             text,
  -- What made the file: 'INVOICE' | 'QUOTE' | photo sources; verbatim.
  attachment_source     text,
  tags                  text,
  photo_width           integer,
  photo_height          integer,
  is_favourite          integer,
  created_by_staff_uuid text,
  "timestamp"           text,
  active                integer,
  edit_date             text,
  synced_at             timestamptz not null default now(),
  primary key (org_id, uuid)
);

-- The read the sheet does: every attachment on one job.
create index if not exists sm8_attachments_related_idx
  on public.sm8_attachments (org_id, related_object_uuid);

alter table public.sm8_attachments enable row level security;
