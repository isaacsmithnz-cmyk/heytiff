-- Ingestion gets an owner, so a document is read once and only once.
--
-- THE BUG THIS CLOSES IS NOT HYPOTHETICAL. The ingest loop lives in the
-- browser (Vercel Hobby allows one cron a day, so there is no server queue),
-- and every open library tab drives it. Two tabs on the same library both read
-- `next_page`, both read the same twenty pages, both insert their chunks, and
-- both advance the bookmark to the same place. Measured on prod 2026-08-11:
-- 122 of 2,256 chunks were byte-identical duplicates — `PUMY-SP80-140VYKMD2-A
-- IM` had its whole 32 pages ingested twice, `PUMY-P250-300YBMD SM` one batch.
-- Duplicates are not merely waste: the same passage can win several slots in
-- retrieval, crowding out the other documents that should have been cited.
--
-- A LEASE, NOT A LOCK. A row-level lock would die with the connection and tell
-- a second worker nothing useful; a lease is a timestamp anyone can read and
-- reason about. Claiming is one conditional UPDATE — atomic in Postgres, so of
-- two simultaneous claims exactly one updates a row and the loser gets nothing
-- back. It EXPIRES rather than being held, because the holder is a serverless
-- invocation that can vanish without ever releasing anything; the next caller
-- simply takes over once the lease goes stale.
--
-- Nullable and with no default: a document nobody is reading has no lease, and
-- every row that predates this column reads as free, which is correct.

alter table kb_documents
  add column if not exists lease_until timestamptz;

comment on column kb_documents.lease_until is
  'While in the future, an ingest or OCR worker owns this document; nobody else may process it. Expires so a dead worker frees it.';

-- Claiming reads this on every ingest call for the org's processing rows.
create index if not exists kb_documents_lease_idx
  on kb_documents (org_id, lease_until);

-- ── one-off repair, safe to re-run ────────────────────────────────────────
--
-- The duplicates the race already made. Keeping the lowest id per
-- (document_id, chunk_index) is arbitrary but total: the rows are
-- byte-identical, so which survives cannot matter — only that one does.
-- `chunk_count` is then re-derived rather than decremented, because it is a
-- count of rows and the rows are what just changed.

delete from kb_chunks c
using kb_chunks keep
where c.document_id = keep.document_id
  and c.chunk_index = keep.chunk_index
  and c.id > keep.id;

update kb_documents d
set chunk_count = coalesce(x.n, 0)
from (select document_id, count(*) as n from kb_chunks group by document_id) x
where x.document_id = d.id
  and d.chunk_count <> x.n;
