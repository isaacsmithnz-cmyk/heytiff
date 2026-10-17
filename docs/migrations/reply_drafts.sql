-- ── words typed in a reply box and not sent yet (2026-10-18) ──
-- Isaac, 18 October: "How can we make it save? The text in the reply box.
-- Before sending." He chose the server copy over the browser's, because a
-- quote started on the phone on site is finished on the laptop.
--
-- One row per person, per box, per thing the box is about: today the quote's
-- reply box (box 'quote', ref the job's ServiceM8 uuid). Written about a
-- second after the typing stops, removed when the words are sent or the box
-- is emptied. Private to the person who typed them: the app reads and writes
-- it with the service role, by org and sign-in; nobody else may.
--
-- Adds a table and nothing else, so version 1 still runs on this data.
create table if not exists public.reply_drafts (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_sub    text not null,
  box         text not null check (box in ('quote')),
  ref         text not null check (char_length(ref) between 1 and 80),
  body        text not null check (char_length(body) between 1 and 20000),
  updated_at  timestamptz not null default now(),
  primary key (org_id, user_sub, box, ref)
);
alter table public.reply_drafts enable row level security;
