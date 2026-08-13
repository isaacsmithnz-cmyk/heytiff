-- A cached copy of a ServiceM8 job file, in the documents table that already
-- knows how to hold bytes safely.
--
-- WHY HERE AND NOT IN AN sm8_* TABLE. Mirrors are a disposable cache and
-- disconnect WIPES them (sm8_mirror.sql). Bytes cannot live somewhere that
-- gets truncated, or the bucket fills with objects no row remembers. The
-- documents table is the opposite by design: private bucket, signed per
-- render, org-scoped path, delete-the-object-before-the-row. It also already
-- signs a page of files in ONE round trip (signMany), which is what makes a
-- twenty-photo job cost one call rather than twenty.
--
-- THE HOUSE NAMES, deliberately. `source` and `remote_ref` are what
-- project_claims and maintenance_visits.completed_source already call these,
-- so a reader who knows one knows all of them: source says who owns the row's
-- truth, remote_ref is that owner's id for it.
--
-- sm8_job_uuid IS NOT A FOREIGN KEY, and can't be: nothing may FK into a
-- mirror table. It is a plain text copy of the job's ServiceM8 uuid so the
-- grid reads one table, and so a cached photo can still say which job it
-- belongs to after a disconnect has emptied the mirror underneath it.
--
-- THE INDEX IS NOT PARTIAL, on purpose. PostgREST emits `ON CONFLICT (cols)`
-- with no predicate, and Postgres will not infer a partial index from that —
-- an upsert against a partial index fails outright (learned in #366). A full
-- index is safe here because NULLs are distinct by default: every manual
-- upload has remote_ref NULL and so collides with nothing. Do NOT "tidy" this
-- to NULLS NOT DISTINCT, which would allow exactly one manual document per
-- org.

alter table public.documents
  add column if not exists source text not null default 'manual',
  add column if not exists remote_ref text,
  add column if not exists sm8_job_uuid text;

-- One cached copy per remote file. The dedupe key for the byte cache, and the
-- reason re-opening a job doesn't re-download it.
create unique index if not exists documents_remote_uniq
  on public.documents (org_id, source, remote_ref);

-- The grid's read: every cached file for one job.
create index if not exists documents_sm8_job_idx
  on public.documents (org_id, sm8_job_uuid);
