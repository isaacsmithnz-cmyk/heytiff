-- Deleting a staff card that was added by mistake — and only such a card.
--
-- Isaac, 2026-09-02: delete is for "people added by mistake who never
-- worked", not anyone. 2026-09-28, with two test cards on Team: "I can't
-- delete the test staff, only deactivate".
--
-- THE TEST IS "NOTHING POINTS AT IT", ASKED OF THE CATALOGUE, NOT A LIST.
-- Thirty-odd tables reference staff_profiles (timesheets, time entries, leave,
-- tasks, notices, documents, vehicles, expense claims…), several of them
-- ON DELETE CASCADE, so deleting a card with history would silently take
-- somebody's work records with it — and Fair Work wants employee records kept
-- for seven years. Both functions below walk pg_constraint for every foreign
-- key onto staff_profiles(id) at CALL time, so a table added next month is
-- covered the day it exists, with nobody remembering to add it here.
--
-- INVITATIONS ARE THE ONE EXCEPTION. An open invitation that names the card
-- is not history, it is a claim on it: delete takes an unaccepted one with it
-- (it would otherwise claim nothing), and an accepted one's pointer is set
-- null by its own FK.
--
-- WHEN TO APPLY: BEFORE the deploy that calls these. Additive and idempotent
-- (create or replace); old code never calls them.
--
-- POSTURE: service-role only, like every table (RLS deny-all).
--
-- READ-ONLY CHECK, AFTER:
--   select * from public.staff_cards_in_use('91e33ca2-…');  -- the owner's card, luke's if he has worked

create or replace function public.staff_card_refs()
returns table (tbl text, col text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct c.conrelid::regclass::text, a.attname::text
  from pg_constraint c
  cross join lateral unnest(c.conkey, c.confkey) as k(src, dst)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.src
  join pg_attribute f on f.attrelid = c.confrelid and f.attnum = k.dst
  where c.contype = 'f'
    and c.confrelid = 'public.staff_profiles'::regclass
    and f.attname = 'id'
    and c.conrelid <> 'public.invitations'::regclass
$$;

-- The org's cards that something points at. Team reads this once per load to
-- decide which rows may offer Delete — one call, a query per referencing
-- table, each over a team-sized id list.
create or replace function public.staff_cards_in_use(p_org uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ids uuid[];
  r record;
begin
  select array_agg(id) into ids from staff_profiles where org_id = p_org;
  if ids is null then
    return;
  end if;
  for r in select * from public.staff_card_refs() loop
    return query execute format('select distinct %I from %s where %I = any($1)', r.col, r.tbl, r.col) using ids;
  end loop;
end;
$$;

-- Delete one card, if and only if nothing points at it — decided and done in
-- one transaction. The card row is locked FOR UPDATE first, and every FK insert
-- takes FOR KEY SHARE on the row it references, so a timesheet cannot land
-- between the check and the delete.
--
-- Returns: 'deleted' | 'not_found' | 'owner' | 'in_use'.
-- An owner's card is never deleted here (that is a change of ownership). The
-- card's login loses its seat in this org with it: a card is how a member
-- exists here, and a seat with no card is the "No staff card" warning row.
create or replace function public.delete_staff_card(p_org uuid, p_staff uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  card record;
  seat_role text;
  owner_id text;
  hit boolean;
  r record;
begin
  select id, user_id into card
  from staff_profiles
  where id = p_staff and org_id = p_org
  for update;
  if not found then
    return 'not_found';
  end if;

  if card.user_id is not null then
    select primary_owner_user_id into owner_id from organizations where id = p_org;
    select role into seat_role from memberships where org_id = p_org and user_id = card.user_id;
    if seat_role = 'owner' or card.user_id = owner_id then
      return 'owner';
    end if;
  end if;

  for r in select * from public.staff_card_refs() loop
    execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col) into hit using p_staff;
    if hit then
      return 'in_use';
    end if;
  end loop;

  delete from invitations where org_id = p_org and staff_profile_id = p_staff and accepted_at is null;
  if card.user_id is not null then
    delete from memberships where org_id = p_org and user_id = card.user_id;
  end if;
  delete from staff_profiles where id = p_staff and org_id = p_org;
  return 'deleted';
end;
$$;

revoke execute on function public.staff_card_refs() from public, anon, authenticated;
revoke execute on function public.staff_cards_in_use(uuid) from public, anon, authenticated;
revoke execute on function public.delete_staff_card(uuid, uuid) from public, anon, authenticated;
grant execute on function public.staff_card_refs() to service_role;
grant execute on function public.staff_cards_in_use(uuid) to service_role;
grant execute on function public.delete_staff_card(uuid, uuid) to service_role;
