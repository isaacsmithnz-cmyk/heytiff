-- HOW A VISIT ENDED (Isaac, 11 November 2026: "The wrap-up should also have
-- something that allows you to complete the job or like mark it ready to
-- invoice along with another trip needed ... just so that the office knows
-- the clear end result"; the mock https://claude.ai/artifact/ESTib5qakLMfgTXmUW9vCy,
-- then "Build from mocks approved"). The last step of a job's wrap-up: one
-- answer a job a day, said by the first person to wrap it up and changeable
-- by anyone on it, each change kept in `history`.
--
-- answer: finished | coming_back | quote_first | cant
-- detail: what that answer asks, as said:
--   finished:    {quoteToo: bool, quoteWords}
--   coming_back: {waiting: more_time|parts|access|someone_else, needed, howLong, booked}
--   quote_first: {quoteWords, quoteWho}
--   cant:        {reason: cancelled|not_ours|unsafe|said_no}
-- charge: {kind: job|none, reason: site_meeting|quote_visit|goodwill|warranty|callback, words}

create table if not exists public.visit_endings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  sm8_job_uuid text not null,
  -- the day wrapped up, on the account's own clock
  day date not null,
  answer text not null check (answer in ('finished', 'coming_back', 'quote_first', 'cant')),
  detail jsonb not null default '{}'::jsonb,
  charge jsonb not null default '{"kind": "job"}'::jsonb,
  -- who said it: their auth user id, and their staff card when they have one
  said_by text not null,
  said_by_staff uuid references public.staff_profiles (id) on delete set null,
  -- the answers before this one, oldest first: [{at, by, staff, answer, detail, charge}]
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visit_endings_one unique (org_id, sm8_job_uuid, day)
);

comment on table public.visit_endings is
  'How each visit ended, one answer a job a day: Finished, Coming back, Quote needed first or Can''t go ahead, with what it asked and how it''s charged.';

create index if not exists visit_endings_open_idx on public.visit_endings (org_id, answer, day);

-- RLS deny-all, enforcement app-layer, same as every other table here.
alter table public.visit_endings enable row level security;
