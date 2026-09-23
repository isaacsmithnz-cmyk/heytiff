-- The business's own papers, and its people's tickets, put ON a job.
--
-- WHAT ISAAC ASKED FOR: a customer rings and wants our workers compensation,
-- our public liability and the ARC licence of whoever is coming. All of it is
-- already in HeyTiff — the certificates on the Organisation screen, the
-- tickets on each staff card — and none of it could be put on the job it was
-- wanted for. The job card's Documents face now takes it under Compliance,
-- beside the SWMS.
--
-- A LINK, NEVER A COPY. The certificate stays OWNED by its credential and the
-- licence scan by its ticket — the kind is what stops the wrong owner adopting
-- a file (documents_kind_catchup.sql), so a job may point at a paper but never
-- hold it. One public liability certificate on three hundred jobs is still one
-- file, and taking it off a job can never delete it: "Remove" on this row
-- drops the link and nothing else.
--
-- EXACTLY ONE OF THE TWO PAPERS. A row is the business's credential or a
-- staff licence, never both and never neither; the CHECK says so, and it also
-- keeps each kind's term column to its own kind.
--
-- THE TERM IS PINNED, not "whatever is current". `credential_record_id` /
-- `licence_record_id` name the certificate that was put on the job, so "which
-- one did we give this customer" stays answerable after the policy renews —
-- the question org_credential_records.sql was written to answer. The card
-- says Renewed when a newer term exists and one press moves the pin. A pin
-- whose term is deleted falls back to NULL, which reads as the current term.
--
-- NOT A FOREIGN KEY INTO THE MIRROR: `sm8_job_uuid` is a plain copy of the
-- job's uuid, the same shape documents.sm8_job_uuid has, because nothing may
-- FK into a table that disconnect wipes.
--
-- THE UNIQUE INDEXES ARE NOT PARTIAL, on purpose (documents_sm8_media.sql
-- has the #366 story): NULLs are distinct, so a staff row's NULL credential
-- collides with nothing, and one paper can be on a job once.
--
-- POSTURE: RLS on with no policies, like every other table here — service-role
-- only, behind the app-layer gates in app/actions/job-compliance.ts
-- (`workboard_manage` for the business's papers, `team` for a person's).
--
-- APPLY THIS BEFORE MERGING THE PR. Until it runs the Compliance group reads
-- empty and "Add to job" says it couldn't add them.

create table if not exists public.job_compliance (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations (id) on delete cascade,
  sm8_job_uuid         text not null,
  org_credential_id    uuid references public.org_credentials (id) on delete cascade,
  staff_licence_id     uuid references public.staff_licences (id) on delete cascade,
  credential_record_id uuid references public.org_credential_records (id) on delete set null,
  licence_record_id    uuid references public.staff_licence_records (id) on delete set null,
  -- staff_profiles.id of whoever put it on the job
  added_by             uuid,
  created_at           timestamptz not null default now(),
  constraint job_compliance_one_paper check (
    (org_credential_id is not null and staff_licence_id is null and licence_record_id is null)
    or (staff_licence_id is not null and org_credential_id is null and credential_record_id is null)
  )
);

comment on table public.job_compliance is
  'A business credential or a staff licence put on a ServiceM8 job. A link, never a copy: the paper stays owned by its credential or ticket, and the row pins the term that was given.';

-- One paper once per job. Also the job's read: (org_id, sm8_job_uuid) leads both.
create unique index if not exists job_compliance_credential_uniq
  on public.job_compliance (org_id, sm8_job_uuid, org_credential_id);

create unique index if not exists job_compliance_licence_uniq
  on public.job_compliance (org_id, sm8_job_uuid, staff_licence_id);

alter table public.job_compliance enable row level security;
