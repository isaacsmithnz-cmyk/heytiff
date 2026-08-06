-- Field notes — the knowledge base learns from the crew, not just the manuals.
--
-- THE FEATURE (Isaac, 2026-08-06): a fix that isn't in the service manual —
-- "got the E6 clear by powering the outdoor board separately" — can be spoken
-- into the note widget anywhere in the app. The note brain offers it as a
-- "Worth teaching everyone" row on the review card; TICKING IT publishes it
-- into the KB as a one-chunk document, embedded and keyword-indexed exactly
-- like a manual page, so the next person asking Tiff about an E6 gets the
-- manual's answer AND the crew's.
--
-- PUBLISH FIRST, CURATE AFTER (Isaac's call): entries go live on tick, and
-- the Admin section shows a "N new entries" queue where they can be marked
-- reviewed or removed. `reviewed_at` null = still in that queue. Nothing is
-- gated on approval — a five-person crew's knowledge shouldn't wait on a
-- manager's inbox — but a bad entry is one click from gone.
--
-- SHAPE: a field note is a kb_documents row with kind 'NOTE', category
-- 'field', status 'ready' from birth (there is no ingestion walk — the text
-- IS the document), and exactly one kb_chunks row at page 1/1. Author rides
-- the existing uploaded_by column; the job it was learned on rides the
-- chunk's heading, where retrieval already surfaces it.
--
-- APPLY THIS BEFORE MERGING THE PR.

-- The category check gains 'field'; the kind check gains 'NOTE'. Postgres has
-- no ALTER CHECK, so drop-and-recreate — safe: both are widenings, and every
-- existing row still passes.
alter table public.kb_documents
  drop constraint if exists kb_documents_category_check;
alter table public.kb_documents
  add constraint kb_documents_category_check
    check (category in ('install', 'faults', 'specs', 'sops', 'field'));

alter table public.kb_documents
  drop constraint if exists kb_documents_kind_check;
alter table public.kb_documents
  add constraint kb_documents_kind_check
    check (kind in ('PDF', 'NOTE'));

-- The curation queue. Null reviewed_at = "new", what Admin counts.
alter table public.kb_documents
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid;

-- The queue read: this org's unreviewed field notes. Partial, so the common
-- case (everything reviewed) costs a lookup in an empty index.
create index if not exists kb_documents_field_queue_idx
  on public.kb_documents (org_id, created_at desc)
  where category = 'field' and reviewed_at is null;
