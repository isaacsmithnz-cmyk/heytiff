-- The name the file arrived with.
--
-- WHY IT ISN'T `source`. `source` is a human field the uploader types —
-- "Brand or author (optional)" on the drawer — and it is usually blank. The
-- library's search matches title OR source, so on a library where nobody fills
-- that field in, half the search has nothing to match against and the most
-- natural thing to search by (the file you dragged in) was never captured at
-- all: `storage_ref` is a synthetic path, `kb/<org>/<document-id>`, so the
-- original name was thrown away at the door.
--
-- It is also the evidence that would have settled how "daikin vrv diagnosis
-- manual.pdf" became the title "Daikin Vrv Diagnosis Manual" — with the
-- filename dropped, the title-caser's input was unrecoverable.
--
-- Nullable and never backfilled: every row that predates this genuinely has
-- no filename on record, and inventing one from the title would be fabricating
-- provenance.

alter table public.kb_documents
  add column if not exists file_name text;

comment on column public.kb_documents.file_name is
  'The name the uploaded file arrived with. Null for rows created before this was captured.';
