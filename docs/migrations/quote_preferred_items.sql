-- ── the business's preferred items (2026-10-05) ──
-- An item a person put forward in the price book: AAD's PC1412 over
-- Reece's same coil, the Go isolator over the other four. One business's
-- own; a quote takes a preferred item over a cheaper one, and every list
-- shows it first. A product (one part, every supplier's code for it) has at
-- most one; the app clears the others when one is chosen. Refs are the
-- price book's own: supplier_key + code.
create table if not exists public.quote_preferred_items (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  supplier_key  text not null,
  code          text not null,
  chosen_by     text,
  chosen_at     timestamptz not null default now(),
  primary key (org_id, supplier_key, code)
);
alter table public.quote_preferred_items enable row level security;
