-- ── the business's ranges that come in sizes (2026-10-05) ──
-- A product line a business buys in every size, kept so a quote takes the
-- size its kit needs (lib/quotes/ranges.ts): its isolators by amps, its
-- wall brackets by what they hold, its zone dampers, flexible duct and
-- diffusers by Ø, its grilles by face, its Ys and BTOs by their sizes, its
-- supply plenums by their spigots. One row an item in a range, at the size
-- a person confirmed when it went in (read off its name; a bracket may
-- carry the widest outdoor it takes). One business's own; nothing is
-- shared. Refs are the price book's own: supplier_key + code.
create table if not exists public.quote_range_items (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  kind          text not null,
  supplier_key  text not null,
  code          text not null,
  size          jsonb not null,
  added_by      text,
  added_at      timestamptz not null default now(),
  primary key (org_id, kind, supplier_key, code)
);
alter table public.quote_range_items enable row level security;
