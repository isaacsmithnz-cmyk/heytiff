-- HeyTiff's own price book: the business's suppliers, how each prices, and
-- every item from their latest files, with the price it replaced.
--
-- Built from the suppliers' files (AAD's CSV of net prices, Mitsubishi
-- Electric's PDF trade book of list prices) rather than from ServiceM8's
-- catalogue, so duplicates and items nobody sells any more never get in.
--
-- PRICES ARE STORED AS THE FILE STATES THEM, in cents: a net price for a
-- `net` supplier, a list price for a `list_less` one. What the business
-- pays is worked out at read (lib/quotes/price-book.ts netCents), so a
-- change of discount reprices every item without an import.
--
-- An item missing from a supplier's newest file stays, with `current` off,
-- so a quote that used it still reads and the page can say it's gone.
--
-- RLS on with no policies: the service role reads these for people with
-- `financials` (buy prices are the business's money).

create table if not exists public.quote_suppliers (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  key           text not null,
  name          text not null,
  pricing       text not null default 'net',
  discount_pct  numeric not null default 0,
  rules         jsonb not null default '[]'::jsonb,
  file_name     text,
  imported_at   timestamptz,
  item_count    integer,
  updated_at    timestamptz not null default now(),
  primary key (org_id, key)
);

create table if not exists public.quote_price_items (
  org_id            uuid not null references public.organizations(id) on delete cascade,
  supplier_key      text not null,
  code              text not null,
  name              text not null,
  cents             integer not null,
  previous_cents    integer,
  price_changed_at  timestamptz,
  first_seen_at     timestamptz not null default now(),
  last_import_at    timestamptz not null default now(),
  current           boolean not null default true,
  primary key (org_id, supplier_key, code)
);
-- the same model at every supplier: found by its code
create index if not exists quote_price_items_org_code_idx on public.quote_price_items (org_id, code);

alter table public.quote_suppliers enable row level security;
alter table public.quote_price_items enable row level security;

-- ── what an invoice says (2026-09-30) ─────────────────────────────────────
-- The "Mitsubishi Electric, invoiced" supplier's items carry the date the
-- price was charged and how often the business bought them: the price for a
-- model the trade book doesn't list is only as good as its date.
alter table public.quote_price_items add column if not exists priced_on date;
alter table public.quote_price_items add column if not exists times_bought integer;
alter table public.quote_price_items add column if not exists qty_bought numeric;

-- ── the equipment pack's models, linked to their order codes ──────────────
-- An exact or tag-only match links without asking (lib/quotes/code-links.ts);
-- a near one (K for Wi-Fi, a newer build) waits for a person. Their answer is
-- kept here, a rejection as much as a confirmation, so nothing is proposed
-- twice.
create table if not exists public.quote_code_links (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  model       text not null,
  code        text not null,
  decision    text not null check (decision in ('confirmed', 'rejected')),
  decided_by  text,
  decided_at  timestamptz not null default now(),
  primary key (org_id, model, code)
);
alter table public.quote_code_links enable row level security;

-- ── a unit bought from a supplier other than the lowest (2026-09-30) ──────
-- A unit is priced from its lowest supplier unless a person overrides it;
-- the override is kept here, per pack model, until they go back to lowest.
create table if not exists public.quote_unit_choices (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  model         text not null,
  supplier_key  text not null,
  decided_by    text,
  decided_at    timestamptz not null default now(),
  primary key (org_id, model)
);
alter table public.quote_unit_choices enable row level security;

-- ── the unit an item is sold by (2026-09-30, Reece) ───────────────────────
-- EA, MTR, COIL, LEN as the file says it: a price "per MTR" is a metre's.
alter table public.quote_price_items add column if not exists uom text;
