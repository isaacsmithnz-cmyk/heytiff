-- The 30-day cap on HeyTiff's copies of ServiceM8's job files.
--
-- WHY. Supabase storage went over the free plan's 1 GB on 2026-09-28. The
-- `documents` bucket held 970 objects (906 MB); 954 of them (889 MB) were
-- kind `job_file`, source `servicem8`: copies of ServiceM8 attachments made
-- when somebody opened a job (app/actions/workboard-media.ts). Every one of
-- them still lives in ServiceM8 and comes back on the next open, so a copy
-- nobody has looked at in 30 days is evicted by the nightly cron
-- (lib/integrations/sm8-file-cache.ts, run from /api/cron/sm8-sync).
--
-- WHAT THIS ADDS. `last_opened_at`: when the bytes were last shown to
-- somebody — the job card's files, the showcase, a photo search's hits —
-- stamped at most once a day per row. The cron evicts on
-- coalesce(last_opened_at, created_at) < now() - 30 days, and only rows of
-- kind 'job_file' AND source 'servicem8' in a workspace whose ServiceM8
-- connection is 'connected' (one that can fetch the copy back). The column means nothing on any
-- other kind and is never read there.
--
-- THE BACKFILL IS greatest(created_at, now() - 23 days): A WEEK'S GRACE.
-- Nobody's opens were recorded before this column, so a copy cached two
-- months ago and viewed yesterday would otherwise look two months unopened
-- and go on the first night. Instead every existing copy counts as opened no
-- earlier than 23 days before the apply, so NOTHING is evicted for the first
-- 7 nights, and a copy somebody opens in that week is stamped fresh before
-- its turn comes. A copy cached in the last 23 days keeps its created_at.
-- New rows take now() by default: a copy made today counts as opened today.
--
-- THE FIRST NIGHTS (measured 2026-09-28 07:11 UTC, before the apply): 810
-- copies (761.6 MB) were cached more than 23 days ago and take the grace;
-- 809 of them (760.9 MB) aren't starred. Every one is in a workspace whose
-- ServiceM8 is connected. Nights 1-7 take none. From night 8, those of the
-- 809 nobody opened in the week are due together, at most 200 objects and
-- 20 s a night (the cron's EVICT_MAX and EVICT_BUDGET_MS), so they leave
-- over five nights or more; after that each copy goes 30 days after it was
-- last shown. (For comparison: 495 copies, 430.3 MB, were over 30 days old
-- that day — what a created_at backfill would have made due on night one.)
--
-- WHEN TO APPLY: BEFORE THE DEPLOY. Additive and idempotent: a nullable
-- column, a backfill of only the cached ServiceM8 rows, a default, a partial
-- index. Old code runs on it unchanged (no reader or writer names the
-- column). The new code copes without it (the stamp and the eviction both
-- stand down on a missing column), but evicts nothing until it lands.
--
-- READ-ONLY, BEFORE:
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'documents' and column_name = 'last_opened_at';   -- 0
--   select kind, source, count(*), count(uploaded_at) from public.documents group by 1, 2 order by 1, 2;
--     -- job_document/manual 7 7, job_file/servicem8 956 954, licence/manual 2 2,
--     -- org_insurance/manual 2 2, org_logo/manual 3 3, staff_photo/manual 1 1   (2026-09-28)
--   select count(*), round(sum(size_bytes) / 1048576.0, 1) from public.documents
--    where kind = 'job_file' and source = 'servicem8' and created_at < now() - interval '23 days';
--     -- 810, 761.6   (2026-09-28 07:11 UTC; 809 / 760.9 once the one starred photo is left out)
--
-- AFTER:
--   select column_default, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'documents' and column_name = 'last_opened_at';  -- now(), YES
--   select count(*) from public.documents
--    where kind = 'job_file' and source = 'servicem8' and last_opened_at is null;                   -- 0
--   select count(*) from public.documents
--    where kind = 'job_file' and source = 'servicem8' and last_opened_at < created_at;              -- 0
--   select count(*) from public.documents
--    where kind = 'job_file' and source = 'servicem8' and last_opened_at > created_at;              -- ~810, the graced (and every copy opened since)
--   select count(*) from public.documents
--    where kind = 'job_file' and source = 'servicem8' and last_opened_at < now() - interval '30 days';  -- 0 (for the next 7 days: nothing is due)
--   select count(*) from public.documents
--    where not (kind = 'job_file' and source = 'servicem8') and last_opened_at is not null;         -- 0 (until the next upload)
--   select indexname from pg_indexes where tablename = 'documents' and indexname = 'documents_sm8_cache_age_idx';  -- 1 row
--
-- ROLLING BACK: revert the code; the column and index can stay (nothing old
-- reads them). To drop them afterwards:
--   drop index if exists public.documents_sm8_cache_age_idx;
--   alter table public.documents drop column if exists last_opened_at;

begin;

alter table public.documents
  add column if not exists last_opened_at timestamptz;

-- Only the cached ServiceM8 files, and only rows not yet stamped: safe to run
-- twice. The week's grace: see THE BACKFILL above.
update public.documents
   set last_opened_at = greatest(created_at, now() - interval '23 days')
 where kind = 'job_file'
   and source = 'servicem8'
   and last_opened_at is null;

-- AFTER the backfill, so the other kinds' existing rows stay null.
alter table public.documents
  alter column last_opened_at set default now();

-- The nightly read: the oldest cached ServiceM8 files first.
create index if not exists documents_sm8_cache_age_idx
  on public.documents (last_opened_at)
  where kind = 'job_file' and source = 'servicem8';

commit;
