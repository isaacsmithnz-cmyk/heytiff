-- The names people go by (Isaac, 2026-09-29).
--
-- Crews call each other by nicknames all the time — "Bobo" is Leonardo
-- Martins. When Tiff hears a name nobody on the team has, she asks who it
-- is; the answer is kept here against that person, so the next time ANYONE
-- says "Bobo" she already knows. The staff card lists them under "Also
-- called", where they can be added or taken off by hand.
--
-- ONE PERSON PER NAME IN A WORKSPACE: (org_id, alias_norm) is unique, so a
-- nickname can never quietly point at two people. The preferred name on the
-- card stays where it is (staff_profiles.preferred_name) and counts as one
-- more name without being copied here.
--
-- WHEN TO APPLY: before the deploy. Additive and idempotent; old code never
-- names the table, and new code reads nothing from it where it is missing.
--
-- READ-ONLY, BEFORE:
--   select to_regclass('public.staff_aliases');                       -- null
-- AFTER:
--   select to_regclass('public.staff_aliases');                       -- staff_aliases
--   select relrowsecurity from pg_class where relname = 'staff_aliases';     -- true
--   select count(*) from pg_policies where tablename = 'staff_aliases';      -- 0
--
-- ROLLING BACK THE CODE: nothing to do; `drop table public.staff_aliases`
-- if the names are to go too.

create table if not exists public.staff_aliases (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  -- deleting a card (delete_staff_card) takes its names with it
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  -- as it was said or typed: "Bobo"
  alias            text not null check (length(alias) between 1 and 40),
  -- lib/staff/aliases.ts's normAlias: lower case, one space between words
  alias_norm       text not null check (length(alias_norm) between 1 and 40),
  -- 'tiff' — learned from somebody's answer to "Who's Bobo?"; 'card' — typed
  source           text not null check (source in ('tiff', 'card')),
  -- the staff card of whoever taught it or typed it
  added_by         uuid references public.staff_profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (org_id, alias_norm)
);

comment on table public.staff_aliases is
  'Nicknames staff call each other by, one person per name per workspace. Learned by Tiff when somebody answers who a name is, or typed on the staff card.';

-- the card's read: one person's names
create index if not exists staff_aliases_staff_idx
  on public.staff_aliases (org_id, staff_profile_id);

alter table public.staff_aliases enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)
