-- The ServiceM8 job a design was started from — document schema v8's `jobLink`,
-- mirrored out to a column so it can be QUERIED.
--
-- WHY A COLUMN AT ALL, when the link is already inside `doc`. The document is
-- and stays the source of truth; this table has always kept a handful of its
-- fields alongside it (name, mode, floor_count, system_count) for exactly the
-- reads that must not parse 1,500 jsonb blobs. "Which designs are for this
-- job?" is that kind of read, and it is the whole reason the link exists —
-- a link nothing can ask about is a comment, not a link.
--
-- WRITTEN ON EVERY SAVE by saveStudioDesign, from doc.jobLink, so the column
-- can never drift from the document: unlink in the document and the next save
-- nulls the column. Never write it from anywhere else.
--
-- NOT A FOREIGN KEY, and this is doctrine rather than laziness. sm8_jobs is a
-- DISPOSABLE CACHE of somebody else's system — it is wiped and re-walked, and
-- nothing may FK into it (see sm8_mirror.sql). A design must survive its
-- mirror row disappearing: the job still exists in ServiceM8, and the design
-- is still for it. Resolve the uuid at read time and show the link as
-- unresolved when the mirror hasn't got it yet, exactly as All jobs already
-- does for absorption.
--
-- NOT UNIQUE either: one job can have several designs (Option 1/2/3 are
-- separate documents by design — see DesignVariantRef), and one design can
-- only ever name one job.
--
-- SAFE TO APPLY BEFORE THE PR MERGES. The column is nullable with no default;
-- every existing row stays null, which is the truth — nothing was linked
-- before there was a way to link it.

alter table public.studio_designs
  add column if not exists sm8_job_uuid text;

comment on column public.studio_designs.sm8_job_uuid is
  'sm8_jobs.uuid of the ServiceM8 job this design was started from, mirrored from doc->jobLink->remoteId on every save. Deliberately NOT a foreign key: the mirror is disposable and a design outlives it.';

-- The read this exists for: every design for a given job, newest first.
-- Partial, because the overwhelming majority of designs are named by hand and
-- an index over their nulls buys nothing.
create index if not exists studio_designs_sm8_job_idx
  on public.studio_designs (org_id, sm8_job_uuid, updated_at desc)
  where sm8_job_uuid is not null;
