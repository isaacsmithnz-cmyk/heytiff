-- ServiceM8 mirror tables — the org-scoped local copy of what the connected
-- ServiceM8 account says, plus the sync engine's two bookkeeping tables.
--
-- DOCTRINE: MIRRORS ARE A DISPOSABLE CACHE. Every row here is rebuildable
-- from ServiceM8 in minutes, so nothing may FK into these tables, overlay
-- features (projects, maintenance) must never depend on their existence, and
-- disconnect WIPES them — a customer's client book has no business outliving
-- the grant that fetched it. Overlay rows carry their own typed/cached labels
-- and LEFT JOIN these at read time: mirror value wins when present, the cached
-- label renders when not. That is also why there are no surrogate `id`
-- columns: the natural key (org_id, uuid) is the primary key, and nothing
-- exists for an id to name.
--
-- TYPING RULE: every ServiceM8-native field is TEXT — uuids included, dates
-- especially. ServiceM8 timestamps are naive local strings in the ACCOUNT's
-- timezone ('YYYY-MM-DD HH:MM:SS', see sm8_vendor.timezone_name) and the API
-- emits '0000-00-00 00:00:00' as its null-date sentinel; a timestamptz column
-- would shift every schedule entry by ~10 hours AND hard-fail the insert on
-- the sentinel (Postgres rejects year zero). The strings sort correctly
-- lexicographically, which is all the sync cursor and range queries need;
-- conversion to real dates happens only at display, against the account's
-- zone. The shaping layer (src/lib/integrations/sm8-sync-plan.ts) nulls the
-- sentinel before rows get here. Integer flags (active, sort_order) are the
-- one exception — the shaper coerces them and nulls anything unreadable, so a
-- malformed value degrades a field instead of killing a sync page.
--
-- NO CHECK CONSTRAINTS ON MIRRORED VALUES, deliberately: ServiceM8 adding a
-- fifth job status must not brick the sync. Mirrors store verbatim; reads
-- interpret. (Deletes are ServiceM8 soft-deletes: active = 0 rows keep
-- arriving from the API, so deletions mirror themselves.)
--
-- WHAT IS DELIBERATELY NOT HERE: badges (the only ServiceM8 badge scope is a
-- WRITE scope), lat/lng, client ABNs/billing details, and staff
-- email/mobile/GPS/status — sm8_staff is names and titles only. Less PII
-- mirrored is less liability, and columns are cheap to add later because
-- rebuilds are free.
--
-- MONEY USED TO BE ON THAT LIST AND NO LONGER IS (see sm8_jobs_money.sql).
-- The job's own total and its invoice/payment flags are mirrored, because a
-- board that can't say where the money is on a job isn't finished. The
-- protection moved from absence to a READ GATE: capability `workboard_money`,
-- owner-tier, enforced by loaders that never SELECT those columns without it.
-- Absence protected those numbers from the business that owns them, which was
-- never the threat. Per-payment RECORDS are still absent and stay that way —
-- ServiceM8 puts them behind `manage_job_payments`, a write scope.
--
-- POSTURE: RLS is ON with NO policies on every table here (deny-all to the
-- public keys, house-wide). All access goes through the service-role client
-- behind app-layer gates.
--
-- APPLY THIS BEFORE MERGING THE PR. The sync engine writes these tables from
-- its first kick; the ServiceM8 screen renders "waiting for first sync"
-- rather than erroring while they're empty.

-- ── the account itself ─────────────────────────────────────────────────────
-- One row per org. timezone_name is load-bearing: it is the clock every
-- ServiceM8 timestamp in this account is written against, and the zone
-- Workboard due-date buckets are computed in.
create table if not exists public.sm8_vendor (
  org_id        uuid primary key references public.organizations(id) on delete cascade,
  uuid          text not null,
  name          text not null,
  email         text,
  timezone_name text,
  currency      text,
  synced_at     timestamptz not null default now()
);

-- ── clients & their people ─────────────────────────────────────────────────
create table if not exists public.sm8_companies (
  org_id              uuid not null references public.organizations(id) on delete cascade,
  uuid                text not null,
  name                text,
  address             text,
  -- Sites add-on: a site is a child company pointing at its parent.
  parent_company_uuid text,
  is_individual       integer,
  active              integer,
  edit_date           text,
  synced_at           timestamptz not null default now(),
  primary key (org_id, uuid)
);

create table if not exists public.sm8_company_contacts (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  uuid         text not null,
  company_uuid text,
  first        text,
  last         text,
  email        text,
  mobile       text,
  phone        text,
  type         text,
  active       integer,
  edit_date    text,
  synced_at    timestamptz not null default now(),
  primary key (org_id, uuid)
);

-- ── jobs & their satellites ────────────────────────────────────────────────
create table if not exists public.sm8_jobs (
  org_id                    uuid not null references public.organizations(id) on delete cascade,
  uuid                      text not null,
  -- The human job number — what staff type, search and say out loud.
  generated_job_id          text,
  -- 'Quote' | 'Work Order' | 'Unsuccessful' | 'Completed' today; stored
  -- verbatim, interpreted at read (see the no-CHECK note above).
  status                    text,
  company_uuid              text,
  job_address               text,
  geo_city                  text,
  geo_state                 text,
  geo_postcode              text,
  category_uuid             text,
  queue_uuid                text,
  queue_expiry_date         text,
  queue_assigned_staff_uuid text,
  date                      text,
  quote_date                text,
  work_order_date           text,
  completion_date           text,
  job_description           text,
  work_done_description     text,
  purchase_order_number     text,
  active                    integer,
  edit_date                 text,
  synced_at                 timestamptz not null default now(),
  primary key (org_id, uuid)
);

create table if not exists public.sm8_job_contacts (
  org_id    uuid not null references public.organizations(id) on delete cascade,
  uuid      text not null,
  job_uuid  text,
  first     text,
  last      text,
  email     text,
  mobile    text,
  phone     text,
  -- 'JOB' | 'BILLING' | 'Property Manager' per the API docs; verbatim.
  type      text,
  active    integer,
  edit_date text,
  synced_at timestamptz not null default now(),
  primary key (org_id, uuid)
);

-- Scheduled blocks: who is booked on which job, when. The board's "booked"
-- truth and the source of a visit's confirmed time.
create table if not exists public.sm8_job_activities (
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  uuid                   text not null,
  job_uuid               text,
  staff_uuid             text,
  start_date             text,
  end_date               text,
  activity_was_scheduled integer,
  active                 integer,
  edit_date              text,
  synced_at              timestamptz not null default now(),
  primary key (org_id, uuid)
);

create table if not exists public.sm8_job_checklists (
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  uuid                    text not null,
  job_uuid                text,
  name                    text,
  -- 'Todo' | 'Asset' | 'Photo' | 'Form' | 'Document'; verbatim.
  item_type               text,
  section_name            text,
  sort_order              integer,
  completed_timestamp     text,
  completed_by_staff_uuid text,
  active                  integer,
  edit_date               text,
  synced_at               timestamptz not null default now(),
  primary key (org_id, uuid)
);

-- ── small lookup mirrors ───────────────────────────────────────────────────
-- Names and titles ONLY: the ServiceM8 staff object also carries live GPS,
-- navigation state and status messages, and none of that is ours to hold.
create table if not exists public.sm8_staff (
  org_id    uuid not null references public.organizations(id) on delete cascade,
  uuid      text not null,
  first     text,
  last      text,
  job_title text,
  active    integer,
  edit_date text,
  synced_at timestamptz not null default now(),
  primary key (org_id, uuid)
);

create table if not exists public.sm8_categories (
  org_id    uuid not null references public.organizations(id) on delete cascade,
  uuid      text not null,
  name      text,
  colour    text,
  active    integer,
  edit_date text,
  synced_at timestamptz not null default now(),
  primary key (org_id, uuid)
);

create table if not exists public.sm8_queues (
  org_id    uuid not null references public.organizations(id) on delete cascade,
  uuid      text not null,
  name      text,
  active    integer,
  edit_date text,
  synced_at timestamptz not null default now(),
  primary key (org_id, uuid)
);

-- ── sync bookkeeping ───────────────────────────────────────────────────────
-- One row per (org, object). `cursor` is the max edit_date STRING seen on the
-- last COMPLETED walk of that object — the naive-local format compares
-- lexicographically, so text is the honest type here too. It advances only
-- when a walk finishes (x-next-cursor exhausted); a partial walk re-pulls
-- from the same floor next kick, which costs repeat reads and nothing else
-- because upserts are idempotent.
create table if not exists public.sm8_sync_state (
  org_id         uuid not null references public.organizations(id) on delete cascade,
  object         text not null,
  cursor         text,
  backfill_done  boolean not null default false,
  last_synced_at timestamptz,
  -- Our own sentence, never ServiceM8's response body.
  last_error     text,
  rows_pulled    bigint not null default 0,
  primary key (org_id, object)
);

-- One row per org: the run lease and the "last sync attempt" the screen
-- shows. `lease_until` is the cross-instance mutex — cron, Sync-now and the
-- page-load kick land on different serverless instances, so an in-process
-- guard can't serialise them; a conditional write on this column can. The
-- calls_today/calls_day pair is a self-imposed daily budget (~a tenth of
-- ServiceM8's 20k/day account cap) so a runaway loop of ours can never eat a
-- customer's real quota.
create table if not exists public.sm8_sync_runs (
  org_id           uuid primary key references public.organizations(id) on delete cascade,
  lease_until      timestamptz,
  last_trigger     text,
  last_started_at  timestamptz,
  last_finished_at timestamptz,
  last_ok          boolean,
  last_note        text,
  calls_today      integer not null default 0,
  calls_day        date
);

-- ── the reads the Workboard actually runs ──────────────────────────────────
create index if not exists sm8_jobs_org_status_idx
  on public.sm8_jobs (org_id, status) where active = 1;
create index if not exists sm8_jobs_org_number_idx
  on public.sm8_jobs (org_id, generated_job_id);
create index if not exists sm8_jobs_org_company_idx
  on public.sm8_jobs (org_id, company_uuid);
create index if not exists sm8_job_activities_org_start_idx
  on public.sm8_job_activities (org_id, start_date);
create index if not exists sm8_job_activities_org_job_idx
  on public.sm8_job_activities (org_id, job_uuid);
create index if not exists sm8_job_checklists_org_job_idx
  on public.sm8_job_checklists (org_id, job_uuid);
create index if not exists sm8_companies_org_parent_idx
  on public.sm8_companies (org_id, parent_company_uuid) where parent_company_uuid is not null;
create index if not exists sm8_company_contacts_org_company_idx
  on public.sm8_company_contacts (org_id, company_uuid);
create index if not exists sm8_job_contacts_org_job_idx
  on public.sm8_job_contacts (org_id, job_uuid);

-- ── deny-all, house-wide ───────────────────────────────────────────────────
alter table public.sm8_vendor           enable row level security;
alter table public.sm8_companies        enable row level security;
alter table public.sm8_company_contacts enable row level security;
alter table public.sm8_jobs             enable row level security;
alter table public.sm8_job_contacts     enable row level security;
alter table public.sm8_job_activities   enable row level security;
alter table public.sm8_job_checklists   enable row level security;
alter table public.sm8_staff            enable row level security;
alter table public.sm8_categories       enable row level security;
alter table public.sm8_queues           enable row level security;
alter table public.sm8_sync_state       enable row level security;
alter table public.sm8_sync_runs        enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)
