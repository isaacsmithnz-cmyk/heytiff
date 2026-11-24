-- The book's printed page numbers beside the file's (bug 85, 24 November 2026:
-- Tiff cited a Daikin RZA service manual's "CHECK 9 on p. 274", the number
-- printed in the book's header, and the viewer opened the file's page 274,
-- CHECK 2 and 3. CHECK 9 is on the file's page 280: the book's numbering
-- starts six pages in.)
--
-- kb_documents.page_offset is the file page less the printed page: 6 for that
-- manual, 0 for a book numbered as its file is, null where the book doesn't
-- say clearly. kb_search gives it to Tiff beside the file's pages, and new
-- documents get it when their last page is read (src/lib/tiff/ingest.ts).
--
-- The backfill below is the same count as src/lib/tiff/printed-pages.ts, in
-- SQL, over the documents already read: on each single-page chunk, every
-- number standing on its own votes for (page - number); the difference with
-- the most pages wins if it has 8 pages at least, a quarter of the pages read,
-- and twice the runner-up's. Safe to run again: it only fills nulls.

alter table public.kb_documents add column if not exists page_offset integer;

with nums as (
  select c.document_id, c.page_from as page,
         (regexp_matches(c.content, '(?:^|\s)(\d{1,4})(?=\s|$)', 'g'))[1]::int as n
  from public.kb_chunks c
  where c.page_from = c.page_to
),
votes as (
  select document_id, page - n as off, count(distinct page) as pages
  from nums
  where n >= 1 and page - n between -20 and 100
  group by document_id, page - n
),
ranked as (
  select document_id, off, pages,
         row_number() over (partition by document_id order by pages desc, off) as rk
  from votes
),
read as (
  select document_id, count(distinct page_from) as pages
  from public.kb_chunks
  where page_from = page_to
  group by document_id
),
best as (
  select b.document_id, b.off, b.pages, coalesce(r2.pages, 0) as next_pages, rd.pages as read_pages
  from ranked b
  join read rd on rd.document_id = b.document_id
  left join ranked r2 on r2.document_id = b.document_id and r2.rk = 2
  where b.rk = 1
)
update public.kb_documents d
set page_offset = best.off
from best
where d.id = best.document_id
  and d.page_offset is null
  and best.pages >= 8
  and best.pages >= best.read_pages * 0.25
  and best.pages >= best.next_pages * 2;
