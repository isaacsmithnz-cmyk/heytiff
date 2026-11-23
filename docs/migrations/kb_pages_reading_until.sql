-- A manual photographed on the phone says it is still being read until Tiff
-- has read its pages (Isaac, 23 November 2026: "Fix" to the Library showing
-- it Ready while its photographed pages were still unread).
--
-- Set by the phone's Add (lib/mobile/library-pages) to a quarter of an hour
-- ahead, cleared by the read of its pages (lib/tiff/after-ready) whatever
-- that read comes to. Non-null is "its pages are still to be read", which is
-- what starts that read; a time still ahead is what the Library shows as
-- Reading, so a read that died says Ready again on its own.
alter table public.kb_documents add column if not exists pages_reading_until timestamptz;
comment on column public.kb_documents.pages_reading_until is 'A manual photographed on the phone: its pages are being read with vision until this time, or until the read clears it. Non-null means its pages are still to be read.';
