-- Every PDF that lands on a job is read once and used (Isaac, 11 November
-- 2026: "I just want it so that you're not uploading things and it's not
-- using the information anywhere"; the builder's package mock,
-- https://claude.ai/artifact/6FP52g4ropVpfAqqzNLk2c).
--
-- job_file_reads: one row per file a job has taken in, whatever door it came
-- through (an upload, a drop on Documents, an email filed on the job, the
-- phone): what its own words say it is, why, and the plan it became. It is
-- what "Scope built from" lists, the used and the Not used alike, and it is
-- why a file is never read twice: a document has one row, and the same bytes
-- arriving again (sha256) point at the first.
--
-- job_plans.kind: a plan is a set of drawings, read for its floors, or a
-- specification, read by its words for the air, ventilation and exhaust.
-- job_plans.claimed_at: a read is claimed before it starts, so two doors
-- asking at once pay for one read.
--
-- Service role only, as job_plans: RLS on, no policies.

create table if not exists public.job_file_reads (
  id text primary key,
  org_id uuid not null references public.organizations(id),
  job_uuid text not null,
  document_id text,
  attachment_id text,
  file_name text not null,
  sha256 text,
  sort text not null check (sort in ('drawings', 'spec', 'ours', 'other', 'same', 'unreadable', 'failed')),
  why text not null default '',
  plan_id text references public.job_plans(id) on delete set null,
  read_at timestamptz not null default now()
);

create index if not exists job_file_reads_job on public.job_file_reads (org_id, job_uuid);
create index if not exists job_file_reads_sha on public.job_file_reads (org_id, job_uuid, sha256);
create unique index if not exists job_file_reads_document on public.job_file_reads (org_id, document_id) where document_id is not null;
create unique index if not exists job_file_reads_attachment on public.job_file_reads (org_id, attachment_id) where attachment_id is not null;

alter table public.job_file_reads enable row level security;

alter table public.job_plans add column if not exists kind text not null default 'drawings';
alter table public.job_plans drop constraint if exists job_plans_kind_check;
alter table public.job_plans add constraint job_plans_kind_check check (kind in ('drawings', 'spec'));
alter table public.job_plans add column if not exists claimed_at timestamptz;
