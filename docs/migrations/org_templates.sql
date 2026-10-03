-- A business's own templates (2026-10-03).
--
-- The wording a business sends that is its own to change: the quote's notes,
-- its payment terms, the checklist every new project starts with, and the
-- documents email. One row per template a business has changed; no row means
-- the standard wording (lib/templates/settings), and going back to it
-- deletes the row. The certificate and the SWMS are not here: their wording
-- is approved, never edited.
--
-- Additive: a new table, read and written only by the server (service role),
-- like every other org-scoped table here; RLS on with no policies.

create table if not exists public.org_templates (
  org_id uuid not null,
  key text not null check (key in ('quote_notes', 'payment_terms', 'project_checklist', 'documents_email')),
  value jsonb not null,
  updated_by_staff_id uuid,
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);
comment on table public.org_templates is
  'A business''s own version of one template (lib/templates/settings). No row: the standard wording.';
alter table public.org_templates enable row level security;
