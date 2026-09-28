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
-- kind 'job_file' AND source 'servicem8'. The column means nothing on any
-- other kind and is never read there.
--
-- THE BACKFILL IS created_at, so the first night takes only what was cached
-- more than 30 days ago (at most 200 objects a night), and nothing cached in
-- the last 30 days goes early. New rows take now() by default: a copy made
-- today counts as opened today.
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
--    where kind = 'job_file' and source = 'servicem8' and created_at < now() - interval '30 days';
--     -- 435, 373.3   (2026-09-28; 434 / 372.6 once the one starred photo is left out)
--
-- AFTER:
--   select column_default, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'documents' and column_name = 'last_opened_at';  -- now(), YES
--   select count(*) from public.documents
--    where kind = 'job_file' and source = 'servicem8' and last_opened_at is null;                   -- 0
--   select count(*) from public.documents
--    where kind = 'job_file' and source = 'servicem8' and last_opened_at <> created_at;             -- 0 (until the first open)
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

-- Only the cached ServiceM8 files, and only rows not yet stamped: safe to run twice.
update public.documents
   set last_opened_at = created_at
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
