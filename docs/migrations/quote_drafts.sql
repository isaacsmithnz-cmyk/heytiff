-- A proposal draft on a job card: what the Quote tab shows and Tiff writes.
--
-- ONE DRAFT PER JOB. The tab holds the proposal being worked on, not a
-- history of them: a new draft from the brief replaces the old one, and a
-- change rewrites it in place. What it was written from (`brief`) and every
-- change asked for since (`changes`) ride along, so a change can never lose
-- the words the draft came from.
--
-- `draft` IS DATA, NOT PROSE: intro, options (name, lines, pros, cons),
-- pricing mode, extra-note keys and open questions. The page is drawn from
-- it by src/lib/quotes/proposal.ts, which is what keeps every proposal in the
-- same layout. Every write passes normaliseDraft first.
--
-- KEYED BY sm8_job_uuid, NOT A FOREIGN KEY, for the reason job_picklist.sql
-- gives: sm8_jobs is a disposable cache and nothing may FK into it. A draft
-- outlives its mirror row being re-walked.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: a new table nothing reads yet.

create table if not exists public.quote_drafts (
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- the job card's own uuid (a claim's drafts land on its parent)
  sm8_job_uuid text not null,
  draft jsonb not null,
  -- what was said about the job, that the first draft was written from
  brief text not null default '',
  -- the changes asked for since, oldest first
  changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- auth id of whoever wrote or last changed it
  updated_by text not null,
  primary key (org_id, sm8_job_uuid)
);

comment on table public.quote_drafts is
  'The proposal draft on a job card''s Quote tab, as fields (see src/lib/quotes/proposal.ts). One per job; replaced by a new draft, rewritten by a change.';
comment on column public.quote_drafts.sm8_job_uuid is
  'sm8_jobs.uuid of the job card. Deliberately NOT a foreign key: the mirror is disposable.';

-- RLS deny-all, enforcement app-layer, same as every other table here: the
-- service role is the only path in, and every action and route re-checks the
-- org and workboard_manage for itself.
alter table public.quote_drafts enable row level security;
