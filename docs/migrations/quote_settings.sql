-- Quoting settings: the markup on what a quote buys, the length of an install
-- day, and the price-book item each common component is priced from.
--
-- One row per business, like pay_settings: the Quoting page in Admin writes
-- it and the quote's price build-up reads it. RLS on with no policies — the
-- service role reads it for people with `financials`, because it is the
-- business's buying price and margin.
--
-- MARKUP, NOT MARGIN. 20 means a $1,000 unit sells at $1,200 (16.7% of the
-- sell price is profit). The page shows both so the difference stays seen.
--
-- `preferred` maps a component key (lib/quotes/components.ts) to the chosen
-- price-book item: {"pair_coil_14_12": {"material_uuid": "…", "roll_m": 20}}.
-- roll_m is set only when the person corrected the length read off the
-- item's name.

create table if not exists public.quote_settings (
  org_id               uuid primary key references public.organizations(id) on delete cascade,
  unit_markup_pct      numeric not null default 20,
  material_markup_pct  numeric not null default 40,
  day_hours            numeric not null default 8,
  preferred            jsonb not null default '{}'::jsonb,
  updated_by           text,
  updated_at           timestamptz not null default now()
);

alter table public.quote_settings enable row level security;
