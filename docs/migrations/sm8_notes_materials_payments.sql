-- The three objects #377 bought consent for and left unbuilt: what was
-- written on a job, what went onto it, and what has been paid for it.
--
-- Inherits sm8_mirror.sql whole: disposable cache, natural key (org_id, uuid),
-- every ServiceM8-native field TEXT (dates especially — they are naive local
-- strings with a '0000-00-00' null sentinel), integer flags the one exception,
-- no CHECK constraints on mirrored values, RLS on with no policies, wiped on
-- disconnect by SM8_WIPE_TABLES mapping over SM8_OBJECTS.
--
-- MONEY IS MIRRORED AND GATED AT READ, exactly as sm8_jobs_money.sql decided
-- for the job's own total. Materials and payments ARE money; they arrive on
-- the page whether we keep them or not, and what protects them is the
-- capability `workboard_money`, enforced by loaders that never SELECT these
-- tables without it. Absence was never the safeguard it looked like — it
-- protected the numbers from the business that owns them.
--
-- AMOUNTS STAY TEXT, exactly as sent ("1234.5600"). parseSm8AmountToCents
-- does the reading, the same parser the job total already uses. A numeric
-- column here would invent a precision ServiceM8 never promised.

-- ── what was written on the job ────────────────────────────────────────────
-- Notes hang off related_object/related_object_uuid like attachments do, NOT
-- a job_uuid — so the index and every read filter on the pair. `note` is the
-- body text; ServiceM8's own diary shows these as the written record.
create table if not exists public.sm8_job_notes (
  org_id                         uuid not null references public.organizations(id) on delete cascade,
  uuid                           text not null,
  related_object                 text,
  related_object_uuid            text,
  note                           text,
  action_required                text,
  action_completed_by_staff_uuid text,
  edit_by_staff_uuid             text,
  create_date                    text,
  active                         integer,
  edit_date                      text,
  synced_at                      timestamptz not null default now(),
  primary key (org_id, uuid)
);
create index if not exists sm8_job_notes_related_idx
  on public.sm8_job_notes (org_id, related_object_uuid);

-- ── what went onto the job ─────────────────────────────────────────────────
-- DELIBERATELY ABSENT: material_uuid (the catalogue item behind the line) and
-- job_material_bundle_uuid. Neither has a reader, and the catalogue is a
-- second object we have not adopted; the line's own name is what an invoice
-- shows and what a person recognises.
--
-- displayed_amount is what ServiceM8 PRINTS; price is ex-tax. They differ
-- whenever displayed_amount_is_tax_inclusive is set, which is why that flag
-- is mirrored beside them rather than folded away — GST is never derived.
create table if not exists public.sm8_job_materials (
  org_id                             uuid not null references public.organizations(id) on delete cascade,
  uuid                               text not null,
  job_uuid                           text,
  name                               text,
  quantity                           text,
  price                              text,
  cost                               text,
  displayed_amount                   text,
  displayed_amount_is_tax_inclusive  integer,
  tax_rate_uuid                      text,
  sort_order                         integer,
  active                             integer,
  edit_date                          text,
  synced_at                          timestamptz not null default now(),
  primary key (org_id, uuid)
);
create index if not exists sm8_job_materials_org_job_idx
  on public.sm8_job_materials (org_id, job_uuid);

-- ── what has been paid ─────────────────────────────────────────────────────
-- `payment_received` on sm8_jobs answers paid-or-not; THIS answers how much,
-- when, by what method, and how many times — which is the question a part-paid
-- job actually raises. attachment_uuid points at a receipt in sm8_attachments
-- when one exists, so the media cache already knows how to show it.
create table if not exists public.sm8_job_payments (
  org_id           uuid not null references public.organizations(id) on delete cascade,
  uuid             text not null,
  job_uuid         text,
  amount           text,
  method           text,
  note             text,
  actioned_by_uuid text,
  attachment_uuid  text,
  is_deposit       integer,
  "timestamp"      text,
  active           integer,
  edit_date        text,
  synced_at        timestamptz not null default now(),
  primary key (org_id, uuid)
);
create index if not exists sm8_job_payments_org_job_idx
  on public.sm8_job_payments (org_id, job_uuid);

alter table public.sm8_job_notes enable row level security;
alter table public.sm8_job_materials enable row level security;
alter table public.sm8_job_payments enable row level security;
