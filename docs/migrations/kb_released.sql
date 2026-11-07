-- When a Library manual came out: the year on its cover on the phone (Isaac,
-- 30 October 2026: "can we have year of release to show edition?").
--
-- Read once, in ingest's first batch (lib/tiff/released): the date printed on
-- its title, its file's name or its edition, else the date the PDF itself was
-- made. Never a date out of its pages: the zone controller manuals' only one
-- is a reprinted software licence's "January 2004". Stored as the first of
-- its month; a year alone is the first of January. Null until read.

alter table public.kb_documents
  add column if not exists released date;

comment on column public.kb_documents.released is
  'When the manual came out, the first of its month: printed on its title, file name or edition, else the PDF''s own date. Null until ingest reads it.';
