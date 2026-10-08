-- TIFF'S SESSION, ONE PER QUOTE (the engine rebuild, slice 4.1).
--
-- Tiff works a quote in one conversation kept for the quote's whole life:
-- Update quote and a variation carry on in the same session rather than
-- starting again. Two things are kept, for two readers:
--
--   quote_sessions.messages — the conversation as the model reads it: every
--   turn's text, her tool calls and their results, saved after every round
--   so a reload, a closed tab or a deploy mid-turn loses nothing. Older
--   turns are folded into `summary` when it gets long; the person still sees
--   every one of them in the thread.
--
--   quote_session_events — the thread as a person reads it: who said what,
--   what Tiff did, each question she asked, each milestone (approved, sent,
--   updated), and what each turn cost. Never folded.
--
-- ONE TURN AT A TIME: a turn holds the session (turn_id, turn_since) until
-- it ends; a second message while one runs is refused. A turn that died
-- (its function stopped) is let go once its hold is older than any turn can
-- run.
--
-- KEYED BY sm8_job_uuid, NOT A FOREIGN KEY, for quote_drafts.sql's reason:
-- the ServiceM8 mirror is disposable.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: two new tables nothing reads yet.
-- Additive and idempotent.

create table if not exists public.quote_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  sm8_job_uuid text not null,
  -- the conversation as the model reads it (Messages API shape)
  messages jsonb not null default '[]'::jsonb,
  -- the turns folded out of `messages`, in Tiff's own words
  summary text not null default '',
  -- the turn running now, and since when; both null between turns
  turn_id uuid,
  turn_since timestamptz,
  -- what the session has cost, US dollars, as the price table reads it
  spent_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, sm8_job_uuid)
);

comment on table public.quote_sessions is
  'Tiff''s session on one quote: the conversation as the model reads it, saved every round. See src/lib/quotes/session/.';
comment on column public.quote_sessions.sm8_job_uuid is
  'sm8_jobs.uuid of the job card. Deliberately NOT a foreign key: the mirror is disposable.';

create table if not exists public.quote_session_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null references public.quote_sessions (id) on delete cascade,
  -- the turn it belongs to
  turn_id uuid,
  -- message: a person's words; reply: Tiff's; tool: something she did;
  -- question: an Unknown she asked, with its answers; milestone: approved,
  -- sent, updated; usage: a turn's cost; error: a turn that couldn't finish
  kind text not null check (kind in ('message', 'reply', 'tool', 'question', 'milestone', 'usage', 'error')),
  -- auth id of the person, or 'tiff'
  author text not null,
  body jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create index if not exists quote_session_events_session on public.quote_session_events (session_id, id);

comment on table public.quote_session_events is
  'The thread of Tiff''s session as a person reads it: who said what, what she did, what it cost. Never folded.';

-- RLS deny-all, enforcement app-layer, as every other table here.
alter table public.quote_sessions enable row level security;
alter table public.quote_session_events enable row level security;
