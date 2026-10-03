-- Certificates on a job: the installer's certificate a builder asks for once
-- the work is done, so their certifier can issue the Occupation Certificate.
-- docs/certificates-plan.md is the design.
--
-- A CERTIFICATE IS A VERSION, NOT A FILE, the SWMS rule (swms.sql): once
-- issued it never changes. A reissue is the next version, and the first stays
-- on file. The PDF printed at issue is an ordinary `job_document` on the job,
-- so the Documents face lists it, emails it and sends it to ServiceM8 with no
-- new path. The version points at it.
--
-- ADDITIVE, and safe to apply BEFORE the deploy: six new tables nothing reads
-- yet. RLS on with no policies, like every table here: the app reads and
-- writes through the service role and scopes every query by org_id.
--
-- NOT A FOREIGN KEY INTO THE MIRROR: `sm8_job_uuid` is a plain copy of the
-- job's uuid, as on swms and job_compliance, because nothing may FK into a
-- table that disconnect wipes.

-- ---------------------------------------------------------------------------
-- A person's signature, drawn once on their own staff card and used on every
-- certificate they issue. Each version keeps its own copy, so a signature
-- redrawn later never changes a certificate already sent. Its own table so it
-- never rides the staff card's flat section save.
-- ---------------------------------------------------------------------------
create table if not exists public.staff_signatures (
  staff_profile_id uuid primary key,
  org_id uuid not null,
  signature_svg text not null,
  set_at timestamptz not null default now()
);
create index if not exists staff_signatures_org_idx on public.staff_signatures (org_id);
alter table public.staff_signatures enable row level security;

-- ---------------------------------------------------------------------------
-- The certificate itself: which job card it belongs to (never a claim).
-- ---------------------------------------------------------------------------
create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  sm8_job_uuid text not null,
  type text not null default 'mechanical' check (type in ('mechanical')),
  -- a snapshot of the builder it went to, kept after the mirror is wiped
  builder_company_uuid text,
  created_by_staff_id uuid,
  created_at timestamptz not null default now()
);
comment on table public.certificates is
  'An installer''s certificate on a job. Its content lives on certificate_versions; this row only ties the versions to the job.';
create index if not exists certificates_job_idx on public.certificates (org_id, sm8_job_uuid);
create index if not exists certificates_builder_idx on public.certificates (org_id, builder_company_uuid);
alter table public.certificates enable row level security;

-- ---------------------------------------------------------------------------
-- UNUSED since 2026-10-03: no certifier is asked for or printed, and
-- nothing writes this table or certifier_profile_id. Kept because it is
-- already in production; dropping it needs its own migration.
-- clause_keys is a record of what each last asked for, not a prefill.
-- ---------------------------------------------------------------------------
create table if not exists public.certifier_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,
  clause_keys text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);
alter table public.certifier_profiles enable row level security;

-- ---------------------------------------------------------------------------
-- One issued version. Never updated except to point at its PDF once printed.
--
-- `answers` is what the person chose and typed; `content` is the certificate
-- the library wrote from them, frozen at issue, so a later wording change can
-- never rewrite a certificate already sent. The signatory's licences and
-- signature are copied in, because a certificate states what was held on the
-- day it was signed.
-- ---------------------------------------------------------------------------
create table if not exists public.certificate_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  certificate_id uuid not null references public.certificates (id) on delete cascade,
  version integer not null check (version >= 1),
  answers jsonb not null,
  -- each certifier requirement as written, and how it was answered
  requirements jsonb not null default '[]'::jsonb,
  -- the certifier's list this version answered: a job_document, or a
  -- job_file brought across from ServiceM8. Null when the email was pasted.
  requirements_document_id uuid,
  certifier_profile_id uuid references public.certifier_profiles (id) on delete set null,
  content jsonb not null,
  library_version text not null,
  -- "First issue", or why it was reissued
  reason text not null,
  signatory_staff_id uuid not null,
  signatory_licences jsonb not null,
  signature_svg text not null,
  -- the PDF, a job_document; null until printed
  document_id uuid,
  issued_by_staff_id uuid not null,
  issued_at timestamptz not null default now(),
  unique (certificate_id, version)
);
comment on table public.certificate_versions is
  'One issued version of a certificate. A reissue is a new row with the next version number.';
create index if not exists certificate_versions_cert_idx on public.certificate_versions (certificate_id, version desc);
alter table public.certificate_versions enable row level security;

-- ---------------------------------------------------------------------------
-- The fans the business fits, each with its rated airflow from the spec
-- sheet, so a bathroom fan's figure is entered once and never typed again.
-- ---------------------------------------------------------------------------
create table if not exists public.fan_models (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  model text not null,
  rated_lps numeric not null check (rated_lps > 0),
  -- the spec sheet the figure came from, when one was attached
  spec_document_id uuid,
  created_by_staff_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, model)
);
alter table public.fan_models enable row level security;

-- ---------------------------------------------------------------------------
-- The wording's approval. Nothing issues from wording the owner hasn't read
-- and adopted; each new library version needs its own approval.
-- ---------------------------------------------------------------------------
create table if not exists public.cert_template_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  type text not null default 'mechanical',
  library_version text not null,
  approved_by_staff_id uuid not null,
  approved_at timestamptz not null default now(),
  unique (org_id, type, library_version)
);
alter table public.cert_template_approvals enable row level security;
