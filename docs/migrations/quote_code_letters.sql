-- ── a business's code letters, read from a maker's own document (2026-10-06) ──
-- What a letter in a maker's model codes means, as its brochure or trade
-- price book explains it (Mitsubishi's K is "WiFi Built-in"), read by Tiff
-- and kept by a person (lib/quotes/code-letters.ts). Each rule carries the
-- document's own example — a code with the letter and without — which is
-- where the letter sits. A unit priced through a code with the letter says
-- what it means; a near match that adds it says so. One business's own:
-- read from a document it uploaded, never anyone else's.
create table if not exists public.quote_code_letters (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  supplier_key    text not null,
  rule_key        text not null,
  family          text not null,
  letter          text not null,
  meaning         text not null,
  example_with    text not null,
  example_without text not null,
  source          text,
  added_by        text,
  added_at        timestamptz not null default now(),
  unique (org_id, rule_key)
);
alter table public.quote_code_letters enable row level security;
