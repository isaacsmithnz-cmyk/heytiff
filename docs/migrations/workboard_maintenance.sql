-- Workboard maintenance — the recurring-service program HeyTiff OWNS.
--
-- WHY IT LIVES HERE AND NOT IN SERVICEM8: ServiceM8 exposes no recurring-jobs
-- API at all, and its own recurring section is where services go to be
-- missed — which is the complaint this feature answers. So the AGREEMENT
-- (client, site, cadence, what's on the roof, what to bring) and its
-- generated VISITS are native rows; a ServiceM8 job gets LINKED to a visit
-- when one is raised, and a linked job completing marks the visit done.
--
-- PROVIDER-NEUTRAL like projects: remote references are (provider,
-- remote_id) TEXT pairs beside typed human fields. An agreement must be
-- creatable before any integration exists and must outlive a disconnect —
-- hence client_name NOT NULL and every sm8-ish column nullable.
--
-- OVERDUE IS NEVER STORED. A visit is upcoming | booked | done | skipped;
-- "overdue" is derived at read (due_date < today on the account's clock,
-- status still upcoming/booked). A stored "missed" needs a mover job and can
-- lie; a derived one can't.
--
-- VISIT GENERATION is ensure-on-read (the holiday-sync pattern): insert-only
-- upserts against unique (agreement_id, due_date), horizon ~13 months,
-- occurrence k = anchor + k×interval_months CLAMPED to month length — never
-- iterated from the previous date, which is how Jan 31 drifts to Feb 28 to
-- Mar 28. Editing the cadence regenerates only PRISTINE future visits
-- (upcoming, unlinked, readiness untouched, no notes); anything a human
-- touched survives as "off-schedule".
--
-- READINESS is a jsonb of fixed keys (access_confirmed, time_confirmed,
-- parts_ready, customer_notified), enforced app-side by whitelist iteration
-- — the CAPABILITIES-resolve() idiom — so junk keys are ignored, never
-- interpreted.
--
-- POSTURE: RLS ON, NO policies (deny-all house-wide); service-role behind
-- can("workboard") / can("workboard_manage") gates; composite FKs carry
-- org_id so children can't cross workspaces.
--
-- APPLY THIS BEFORE MERGING THE PR.

create table if not exists public.maintenance_agreements (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,

  label             text not null,
  client_name       text not null,
  client_provider   text,
  client_remote_id  text,
  site_label        text,
  site_address      text,

  -- The cadence: every N months from the anchor. Presets are 1/3/6/12; the
  -- CHECK is a sanity rail, not the product rule.
  interval_months   smallint not null check (interval_months between 1 and 24),
  anchor_date       date not null,
  contract_start    date,
  -- Caps the generation horizon; null = evergreen.
  contract_end      date,

  status            text not null default 'active'
                      check (status in ('active', 'paused', 'ended')),

  -- The onboarding story: everything a tech needs BEFORE the day.
  we_installed      boolean not null default false,
  access_notes      text,
  bring_list        text,
  site_requirements text,
  notes             text,

  created_by_user_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

create unique index if not exists maintenance_agreements_id_org_uniq
  on public.maintenance_agreements (id, org_id);
create index if not exists maintenance_agreements_org_status_idx
  on public.maintenance_agreements (org_id, status);

-- What's actually on the roof / in the ceiling at this site — the list the
-- visit works through, optionally pointing back at the install project.
create table if not exists public.agreement_equipment (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  agreement_id       uuid not null,

  description        text not null,
  model              text,
  serial             text,
  location           text,
  install_project_id uuid,
  created_at         timestamptz not null default now(),

  constraint agreement_equipment_agreement_fkey
    foreign key (agreement_id, org_id)
    references public.maintenance_agreements(id, org_id) on delete cascade,
  constraint agreement_equipment_project_fkey
    foreign key (install_project_id, org_id)
    references public.projects(id, org_id) on delete set null
);

create index if not exists agreement_equipment_org_agreement_idx
  on public.agreement_equipment (org_id, agreement_id);

create table if not exists public.maintenance_visits (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  agreement_id       uuid not null,

  due_date           date not null,
  status             text not null default 'upcoming'
                       check (status in ('upcoming', 'booked', 'done', 'skipped')),
  readiness          jsonb not null default '{}'::jsonb,

  -- The raised job, once there is one. job_number typed or cached; the
  -- (provider, remote_id) pair only when it's a linked ServiceM8 job.
  job_number         text,
  provider           text,
  remote_id          text,
  -- The booked time cached at link time (naive account-local string, like
  -- every mirror datetime); the mirror's live schedule wins at read when
  -- present.
  booked_start_cached text,

  completed_at       date,
  completed_source   text check (completed_source in ('manual', 'servicem8')),
  notes              text,
  created_at         timestamptz not null default now(),

  constraint maintenance_visits_agreement_fkey
    foreign key (agreement_id, org_id)
    references public.maintenance_agreements(id, org_id) on delete cascade,

  -- The generation contract: one visit per agreement per due date. Ensure
  -- runs are insert-only upserts against exactly this.
  constraint maintenance_visits_agreement_due_uniq unique (agreement_id, due_date)
);

create index if not exists maintenance_visits_org_due_idx
  on public.maintenance_visits (org_id, due_date);
create index if not exists maintenance_visits_org_status_idx
  on public.maintenance_visits (org_id, status);
create index if not exists maintenance_visits_org_agreement_idx
  on public.maintenance_visits (org_id, agreement_id);
create index if not exists maintenance_visits_org_remote_idx
  on public.maintenance_visits (org_id, remote_id) where remote_id is not null;

alter table public.maintenance_agreements enable row level security;
alter table public.agreement_equipment    enable row level security;
alter table public.maintenance_visits     enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)
