-- A document row takes up to 50 MB (Isaac, 11 November 2026: "Yes, start",
-- on the builder's package). documents_50mb.sql raised the bucket and the
-- app (src/lib/documents/files.ts MAX_BYTES) to 50 MB on 21 October, but the
-- table's own check still held 10 MB, so 7 Cutler Rd's 16.8 MB tender set
-- was refused at the row's insert ("Couldn't start that upload") before a
-- byte moved. The three places now hold one number.

alter table public.documents drop constraint if exists documents_size_check;
alter table public.documents
  add constraint documents_size_check check (size_bytes > 0 and size_bytes <= 52428800);
