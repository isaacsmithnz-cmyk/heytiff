-- Letters on the business's own letterhead (2026-10-09): an employment
-- confirmation for a visa, a letter for a car loan, anything somebody asks
-- to have "on company letterhead". Written in Admin → Letters, printed on the
-- letterhead set in Admin → Templates (org_templates "letterhead").
--
-- ADDITIVE, and safe to apply BEFORE the deploy: one new table nothing reads
-- yet. RLS on with no policies, like every table here: the app reads and
-- writes through the service role and scopes every query by org_id.
--
-- THE BODY IS THE EDITOR'S DOCUMENT, NOT HTML. `body` holds the editor's
-- JSON (paragraphs, headings, lists, tables, bold/italic/underline, each
-- paragraph's alignment), read back through lib/letters/body's normaliser on
-- every save and every render, so nothing typed can reach the page as markup.
--
-- WHO SEES ONE: whoever wrote it, whoever signs it, and the owner. A letter
-- about a staff member's employment holds their personal details.

create table if not exists public.letters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  /* what the list calls it; the "Re:" line when empty */
  title text not null default '',
  letter_date date,
  /* who it is to, a line each */
  recipient text not null default '',
  subject text not null default '',
  body jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  signer_staff_id uuid,
  /* the signer's drawn signature goes on: only ever set by the signer */
  with_signature boolean not null default false,
  created_by_staff_id uuid,
  updated_by_staff_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists letters_org_updated_idx on public.letters (org_id, updated_at desc);
alter table public.letters enable row level security;
