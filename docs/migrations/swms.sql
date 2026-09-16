-- Safe Work Method Statements, created on a job and signed on in the app.
--
-- A SWMS is written by the wizard on the job card from a library of steps,
-- hazards and controls, and it is a VERSION, not a file: once issued it never
-- changes. A revision is the next version, and the people it covers sign on
-- to that version again. Nothing here is ever deleted by the app — WHS
-- regulation 303 keeps a SWMS until the work is done, and for two years after
-- a notifiable incident, so there is no delete path to get wrong.
--
-- ADDITIVE, and safe to apply BEFORE the deploy: five new tables nothing reads
-- yet. RLS on with no policies, like every table here — the app reads and
-- writes through the service role and scopes every query by org_id.

-- ---------------------------------------------------------------------------
-- The SWMS itself: which job it belongs to. The job is a ServiceM8 job in the
-- mirror, keyed by its uuid the way job notes and job files are.
-- ---------------------------------------------------------------------------
create table if not exists public.swms (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  sm8_job_uuid       text not null,
  created_by_staff_id uuid,
  created_at         timestamptz not null default now()
);
comment on table public.swms is
  'A Safe Work Method Statement on a job. Its content lives on swms_versions; this row only ties the versions to the job.';
create index if not exists swms_job_idx on public.swms (org_id, sm8_job_uuid);
alter table public.swms enable row level security;

-- ---------------------------------------------------------------------------
-- One issued version. Immutable once written.
--
-- `answers` is what the person on site chose, as they chose it; `content` is
-- the document the library wrote from those answers, frozen at issue — so a
-- later library change can never rewrite a SWMS people have already signed.
-- `library_version` says which library wrote it.
-- ---------------------------------------------------------------------------
create table if not exists public.swms_versions (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null,
  swms_id               uuid not null references public.swms (id) on delete cascade,
  version               integer not null check (version >= 1),
  -- the state whose rules were applied (the site's, not the business's)
  jurisdiction          text not null check (jurisdiction in ('NSW', 'QLD')),
  answers               jsonb not null,
  content               jsonb not null,
  library_version       text not null,
  -- why this version exists: "First issue", or the review trigger and what changed
  reason                text not null,
  -- whether the change matters enough that everyone signs on again
  material              boolean not null default true,
  responsible_staff_id  uuid not null,
  -- "I've walked this site and this SWMS matches it" — the on-site review
  -- regulators require before a library-built SWMS can be used
  site_checked_by_staff_id uuid not null,
  site_checked_at       timestamptz not null,
  issued_by_staff_id    uuid not null,
  issued_at             timestamptz not null default now(),
  unique (swms_id, version)
);
comment on table public.swms_versions is
  'One issued version of a SWMS. Never updated: a revision is a new row with the next version number.';
create index if not exists swms_versions_swms_idx on public.swms_versions (swms_id, version desc);
alter table public.swms_versions enable row level security;

-- ---------------------------------------------------------------------------
-- Who a version covers: a team member, or someone from outside the business
-- named on it so their briefing is on the record. Exactly one of the two.
-- ---------------------------------------------------------------------------
create table if not exists public.swms_people (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  version_id        uuid not null references public.swms_versions (id) on delete cascade,
  staff_profile_id  uuid,
  outside_name      text,
  outside_company   text,
  created_at        timestamptz not null default now(),
  constraint swms_people_one_kind check (
    (staff_profile_id is not null and outside_name is null)
    or (staff_profile_id is null and outside_name is not null and length(trim(outside_name)) > 0)
  )
);
create index if not exists swms_people_version_idx on public.swms_people (version_id);
-- the bell's read: every version this person is on
create index if not exists swms_people_staff_idx
  on public.swms_people (org_id, staff_profile_id)
  where staff_profile_id is not null;
create unique index if not exists swms_people_one_staff_per_version
  on public.swms_people (version_id, staff_profile_id)
  where staff_profile_id is not null;
alter table public.swms_people enable row level security;

-- ---------------------------------------------------------------------------
-- A sign-on: this person, on this version, briefed and signed. One each.
--
-- A team member signs on in the app as themselves; someone from outside the
-- business signs on the crew lead's phone, and `signed_by_user_id` is the
-- lead's login while `person_id` is the helper — the document says whose phone.
-- The signature is the drawn path as SVG, a few kilobytes, kept with the row.
-- ---------------------------------------------------------------------------
create table if not exists public.swms_signons (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,
  version_id          uuid not null references public.swms_versions (id) on delete cascade,
  person_id           uuid not null references public.swms_people (id) on delete cascade,
  signed_by_user_id   text not null,
  signed_by_staff_id  uuid,
  briefed_by_staff_id uuid,
  signature_svg       text not null,
  -- anything the person raised at sign-on; a raised issue that changes a
  -- control is what makes the next version
  issue_raised        text,
  signed_at           timestamptz not null default now(),
  unique (person_id)
);
create index if not exists swms_signons_version_idx on public.swms_signons (version_id);
alter table public.swms_signons enable row level security;

-- ---------------------------------------------------------------------------
-- The library's approval. The wizard only writes from a library a competent
-- person in the business has read and adopted; each new library version needs
-- its own approval.
-- ---------------------------------------------------------------------------
create table if not exists public.swms_library_approvals (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,
  library_version     text not null,
  approved_by_staff_id uuid not null,
  approved_at         timestamptz not null default now(),
  unique (org_id, library_version)
);
alter table public.swms_library_approvals enable row level security;
