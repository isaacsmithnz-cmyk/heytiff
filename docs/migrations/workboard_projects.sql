-- Workboard projects — HeyTiff-owned project tracking. The overlay side of
-- the split the ServiceM8 work established:
--
--   MIRRORS (sm8_*)   are a disposable cache of what ServiceM8 says.
--   OVERLAYS (these)  are HeyTiff's OWN truth — they exist before any
--                     integration, survive a disconnect, and never FK into a
--                     mirror.
--
-- PROVIDER-NEUTRAL BY DESIGN (Isaac, 2026-07-28): the Workboard must be fully
-- usable with no integration at all, and readable by a future CRM connector.
-- So every remote reference is a (provider, remote_id) TEXT pair — provider
-- null means "typed by hand", 'servicem8' is merely the first non-null value
-- — alongside always-present human fields (job_number, client_name) that are
-- typed directly in manual mode and cached from the mirror when linked.
-- Loaders LEFT JOIN the mirror at read: the mirror value wins when present,
-- the stored field renders when not. No cache-refresh job exists, ever.
--
-- WHY A PROJECT HOLDS SEVERAL JOBS: a real install is a quote job, an install
-- job and a variation or two, raised months apart. project_jobs is that
-- list; the same remote job MAY appear on two projects (a quote covering a
-- split install), so uniqueness is per-project and the UI warns on
-- cross-project reuse instead of refusing it.
--
-- POSTURE: RLS ON with NO policies everywhere (deny-all to the public keys);
-- all access is service-role behind can("workboard") / can("workboard_manage")
-- gates. Composite FKs carry org_id so a child row structurally cannot point
-- at another org's parent (house pattern, cf. expense_claims).
--
-- APPLY THIS BEFORE MERGING THE PR.

-- Referents for the composite FKs below (and for maintenance + notes later):
-- a composite FK needs a UNIQUE on exactly the referenced pair.
create unique index if not exists studio_designs_id_org_uniq
  on public.studio_designs (id, org_id);

create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,

  name            text not null,
  -- Who it's for — typed in manual mode, cached from the mirror at link time.
  client_name     text,
  client_provider text,
  client_remote_id text,
  site_label      text,
  site_address    text,

  -- The start-to-finish pipeline. TEXT + app-validated against the
  -- code-defined stage list (src/lib/workboard/stages.ts) — a DB CHECK would
  -- cost a migration every time the trade's real flow gets a tweak.
  stage           text not null default 'Quote',
  status          text not null default 'active'
                    check (status in ('active', 'on_hold', 'done', 'archived')),

  -- Optional link to a Design Studio design; survives the design's deletion
  -- as a null, never blocks it. TEXT, not uuid: studio_designs.id is text
  -- (the client mints design ids), and a composite FK's types must match its
  -- referent exactly.
  design_id       text,
  notes           text,

  created_by_user_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,

  -- SET NULL names its COLUMN: a composite FK's plain `set null` would null
  -- org_id too (NOT NULL → the design delete itself would fail). PG15+.
  constraint projects_design_fkey
    foreign key (design_id, org_id)
    references public.studio_designs(id, org_id) on delete set null (design_id)
);

create unique index if not exists projects_id_org_uniq
  on public.projects (id, org_id);
create index if not exists projects_org_status_idx
  on public.projects (org_id, status);

create table if not exists public.project_jobs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  project_id  uuid not null,

  -- The human job number — ALWAYS present, typed in manual mode. What staff
  -- search, say and write on things.
  job_number  text not null,
  provider    text,
  remote_id   text,
  role        text not null default 'other'
                check (role in ('quote', 'install', 'variation', 'service', 'other')),
  added_at    timestamptz not null default now(),

  constraint project_jobs_project_fkey
    foreign key (project_id, org_id)
    references public.projects(id, org_id) on delete cascade
);

-- One linked remote job once per project; one typed number once per project.
create unique index if not exists project_jobs_remote_uniq
  on public.project_jobs (org_id, project_id, provider, remote_id)
  where remote_id is not null;
create unique index if not exists project_jobs_number_uniq
  on public.project_jobs (org_id, project_id, job_number);
-- The reverse lookup: "is this remote job already on another project?"
-- (the UI's cross-project warning, and the visit auto-complete later).
create index if not exists project_jobs_org_remote_idx
  on public.project_jobs (org_id, remote_id) where remote_id is not null;
create index if not exists project_jobs_org_project_idx
  on public.project_jobs (org_id, project_id);

create table if not exists public.project_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  project_id  uuid not null,

  -- Sections group the list ("Approval & prep", "Handover"); the default
  -- template is seeded in code on create and fully editable per project.
  section     text not null,
  label       text not null,
  done        boolean not null default false,
  -- Who ticked it — provenance, kept even if the person later leaves.
  done_by     uuid,
  done_at     timestamptz,
  sort        integer not null default 0,

  constraint project_checklist_project_fkey
    foreign key (project_id, org_id)
    references public.projects(id, org_id) on delete cascade,
  -- Column-specific SET NULL again: offboarding someone must clear the
  -- provenance, not fail on org_id's NOT NULL.
  constraint project_checklist_staff_fkey
    foreign key (done_by, org_id)
    references public.staff_profiles(id, org_id) on delete set null (done_by)
);

create index if not exists project_checklist_org_project_idx
  on public.project_checklist_items (org_id, project_id);

-- "What was left on site" — the register the handover conversation reads
-- from: the unit itself, remotes, spare filters, and whether its manual
-- stayed with the customer.
create table if not exists public.project_equipment (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null,

  description   text not null,
  model         text,
  serial        text,
  location_note text,
  manual_left   boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now(),

  constraint project_equipment_project_fkey
    foreign key (project_id, org_id)
    references public.projects(id, org_id) on delete cascade
);

create index if not exists project_equipment_org_project_idx
  on public.project_equipment (org_id, project_id);

alter table public.projects                enable row level security;
alter table public.project_jobs            enable row level security;
alter table public.project_checklist_items enable row level security;
alter table public.project_equipment       enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)
