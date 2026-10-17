-- ── a person's conversations with Tiff (2026-10-18) ──
-- NOT YET APPLIED. Written with v2's Conversations place on the branch
-- v2-layout; nobody has run it against the database. Until it is applied the
-- app keeps the threads where they always were, in the browser's
-- localStorage, and /api/tiff/threads answers "not kept" (503), which the
-- page reads as "stay on this device".
--
-- Why it exists: Tiff's threads lived only in localStorage under
-- `heytiff.tiff.threads.v2` (src/components/tiff/assistant.tsx), so they
-- were lost at the cutover and never followed a person from the phone to the
-- laptop (docs/plans/layout-2026-10/4-review.md, "Data the new frame needs
-- that does not exist"; the feature checklist's F-132, "Conversations, kept
-- on the server").
--
-- One row per thread, per person. `id` is the thread's own id, made in the
-- browser (`t-<time>-<dice>`), so a thread written on one device and opened
-- on another is the same row. `messages` is the thread as the browser holds
-- it: each turn's words, its time, where the answer came from and its
-- sources. `updated_at` is when the conversation last moved, as the browser
-- said it, which orders the list. On first open after this is applied the
-- page sends up whatever that browser already held, once.
--
-- Private to the person who had the conversation: the app reads and writes
-- it with the service role, by org and sign-in; nobody else may.
--
-- Adds a table and nothing else, so version 1 still runs on this data.
create table if not exists public.tiff_threads (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_sub    text not null,
  id          text not null check (char_length(id) between 1 and 80),
  title       text not null check (char_length(title) between 1 and 200),
  messages    jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  updated_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  primary key (org_id, user_sub, id)
);
create index if not exists tiff_threads_recent
  on public.tiff_threads (org_id, user_sub, updated_at desc);
alter table public.tiff_threads enable row level security;
