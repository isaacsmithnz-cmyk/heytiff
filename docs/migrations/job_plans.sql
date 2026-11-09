-- ── PLANS ON THE JOB (Isaac, 9 November 2026, on the mock
-- https://claude.ai/artifact/3gzx9mP747FgTX7qxsH9fe: "Go that" to a plan read
-- once as it is pressed into Plans; "Yes, a plans group at the top of
-- documents that can be easily read"; then "Build it") ──
--
-- A plan is a pointer to one of the job's own files (ours, documents.id, or
-- ServiceM8's, sm8_attachments.uuid) with Tiff's reading of it kept beside
-- the pointer (src/lib/jobs/plans.ts). Read once, by page; every design
-- started from it, the heat load, Revise the 3D and the quote use the one
-- read. `pages` says what each page of the set is and where its raster sits
-- in the studio-plans bucket; `reading` is the Studio's PlanReading keyed by
-- page. `state` is reading, read, check or failed; `said` why.
create table if not exists public.job_plans (
  id             text primary key,
  org_id         uuid not null references public.organizations(id) on delete cascade,
  job_uuid       text not null,
  document_id    text,
  attachment_id  text,
  name           text not null,
  source_ref     text,
  source_kind    text not null default 'pdf' check (source_kind in ('pdf', 'image')),
  page_count     integer not null default 0,
  pages          jsonb not null default '[]'::jsonb,
  reading        jsonb,
  state          text not null default 'reading' check (state in ('reading', 'read', 'check', 'failed')),
  said           text,
  added_by       uuid,
  added_at       timestamptz not null default now(),
  read_at        timestamptz
);
create index if not exists job_plans_job on public.job_plans (org_id, job_uuid, added_at desc);
-- one plan per file: pressing a file into Plans twice is one plan
create unique index if not exists job_plans_document on public.job_plans (org_id, document_id) where document_id is not null;
create unique index if not exists job_plans_attachment on public.job_plans (org_id, attachment_id) where attachment_id is not null;
alter table public.job_plans enable row level security;
