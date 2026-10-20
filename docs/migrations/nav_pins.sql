-- ── what each person keeps pinned in the sidebar (v2, rule 6; 2026-10-18) ──
-- docs/design.md rule 6: "Pinned and Recents stay in the sidebar under the
-- places." Recents are the records you opened lately and need no table;
-- what you pin is yours to keep between visits and devices, so it lives
-- here. One row per person, per record; the sidebar shows them newest first.
-- The title and second line are kept as they were when pinned, so the
-- sidebar draws without reading each record; opening one reads it fresh.
--
-- Private to the person who pinned: the app reads and writes it with the
-- service role, by org and sign-in. Adds a table and nothing else, so
-- version 1 still runs on this data. NOT YET APPLIED: apply before v2 merges.
create table if not exists public.nav_pins (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_sub    text not null,
  kind        text not null check (kind in ('job', 'visit', 'agreement')),
  ref_id      text not null check (char_length(ref_id) between 1 and 80),
  title       text not null check (char_length(title) between 1 and 120),
  sub         text check (sub is null or char_length(sub) <= 160),
  pinned_at   timestamptz not null default now(),
  primary key (org_id, user_sub, kind, ref_id)
);
alter table public.nav_pins enable row level security;
