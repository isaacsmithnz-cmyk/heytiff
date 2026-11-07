-- A MANUAL ADDED FROM A FILE ALREADY HANDED TO TIFF: which file it came from, so the
-- chat can say it's in the Library, and the same file can't go in twice. Empty for
-- anything uploaded directly, and emptied if that file is ever removed, as the manual
-- has its own copy (Isaac, 1 November 2026: "Yes, that looks fine"; the mock
-- https://claude.ai/artifact/MnGDRUVvNSbWMueKi2PLVP).

alter table public.kb_documents
  add column if not exists source_document uuid references public.documents(id) on delete set null;

create unique index if not exists kb_documents_source_document_key
  on public.kb_documents (org_id, source_document)
  where source_document is not null;
