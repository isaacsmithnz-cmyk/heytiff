-- The ServiceM8 price book (material.json, read_inventory), and the link from
-- a job's line to the price-book item it was picked from.
--
-- Inherits sm8_mirror.sql whole: disposable cache, natural key (org_id, uuid),
-- every ServiceM8-native field TEXT (amounts exactly as sent, dates naive
-- local strings), integer flags the one exception, no CHECK constraints on
-- mirrored values, RLS on with no policies, wiped on disconnect by
-- SM8_WIPE_TABLES mapping over SM8_OBJECTS.
--
-- WHY NOW. Quotes are to be itemised from the price book (units by model
-- code, materials per metre from roll prices, parts like zone motors as
-- listed), and Tiff ranks the items a job is likely to need by how often the
-- business has actually used them. That is the reader both halves were
-- waiting for.
--
-- MONEY IS MIRRORED AND GATED AT READ, as sm8_notes_materials_payments.sql
-- decided: `cost` especially is the business's buying price, and loaders
-- never SELECT it without the capability that shows money.
--
-- NOT MIRRORED: barcode (no reader). Bundles are the same scope's second
-- endpoint and come with their own reader.

create table if not exists public.sm8_materials (
  org_id                         uuid not null references public.organizations(id) on delete cascade,
  uuid                           text not null,
  name                           text,
  item_number                    text,
  item_description               text,
  price                          text,
  cost                           text,
  price_includes_taxes           integer,
  tax_rate_uuid                  text,
  item_is_inventoried            integer,
  quantity_in_stock              text,
  use_description_for_invoicing  text,
  active                         integer,
  edit_date                      text,
  synced_at                      timestamptz not null default now(),
  primary key (org_id, uuid)
);
-- units are found by their model code, which is the item number
create index if not exists sm8_materials_org_item_idx
  on public.sm8_materials (org_id, item_number);

alter table public.sm8_materials enable row level security;

-- the same keep-newer guard every mirror table has (sm8_calls_echo_freshness.sql)
drop trigger if exists sm8_keep_newer on public.sm8_materials;
create trigger sm8_keep_newer before update on public.sm8_materials
  for each row execute function public.sm8_mirror_keep_newer();

-- ── the job line's price-book item ─────────────────────────────────────────
-- Left out when the job-line mirror was built ("no reader"); the price book
-- is its reader. Rows already mirrored fill in as their jobs are next pulled.
alter table public.sm8_job_materials add column if not exists material_uuid text;
create index if not exists sm8_job_materials_org_material_idx
  on public.sm8_job_materials (org_id, material_uuid);
