-- Deleting a workspace from HQ — a test sign-up's, and only such a one.
--
-- Isaac, 2026-10-05: Grok signed up through the public form to test the app,
-- which made a workspace of its own with Grok as owner. Nothing in the app
-- could remove it (Team acts on your own members, never an owner), so it was
-- deleted by hand in SQL. This is that by-hand delete, with the checks it
-- needed, behind a button on /hq/orgs/[id].
--
-- THE TEST IS "NOTHING BUT SETUP", ASKED OF THE CATALOGUE, NOT A LIST.
-- A hundred-odd tables carry org_id, most ON DELETE CASCADE, and nineteen
-- carry it with no foreign key at all (certificates, SWMS, the Library's
-- chunks…), so a delete that trusted the cascade would take a customer's
-- records with it, or leave orphans the cascade never saw. Both functions
-- walk pg_attribute for every public table with an org_id column at CALL time,
-- so a table added next month is covered the day it exists.
--
-- WHAT COUNTS AS SETUP is the short list below: what signing up makes (the
-- workspace, the owner's seat and card), what a first look round makes
-- (holidays, settings, template choices, the job counter), and the seats,
-- invitations and permission changes of people added to try the team.
-- A row anywhere else is a record, and the workspace is not deletable here.
-- There is no point-in-time restore on this project.
--
-- WHEN TO APPLY: BEFORE the deploy that calls these. Additive and idempotent.
--
-- POSTURE: service-role only, like every table (RLS deny-all).
--
-- READ-ONLY CHECK, AFTER:
--   select * from public.hq_workspace_records('91e33ca2-…');  -- the real workspace: many rows

create table if not exists public.hq_deleted_workspaces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  signed_up_at timestamptz,
  logins jsonb not null default '[]'::jsonb,
  deleted_by text not null,
  deleted_at timestamptz not null default now()
);
alter table public.hq_deleted_workspaces enable row level security;

create or replace function public.hq_workspace_setup_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'memberships', 'invitations', 'staff_profiles', 'permission_audit',
    'public_holidays', 'pay_settings', 'quote_settings', 'rate_calc_state',
    'org_templates', 'workboard_job_counters'
  ]
$$;

-- The tables in which this workspace has anything beyond setup. Empty means
-- deletable. HQ reads it once per workspace page.
create or replace function public.hq_workspace_records(p_org uuid)
returns table (tbl text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  hit boolean;
begin
  for r in
    select c.relname::text as t
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and a.attname = 'org_id'
      and a.attnum > 0
      and not a.attisdropped
      and c.relname <> all (public.hq_workspace_setup_tables())
    order by 1
  loop
    -- %L, not $1: org_id is uuid in most tables and text in a few, and an
    -- untyped literal takes whichever the column is
    execute format('select exists (select 1 from public.%I where org_id = %L)', r.t, p_org) into hit;
    if hit then
      tbl := r.t;
      return next;
    end if;
  end loop;

  -- a card something points at from a table with no org_id of its own
  if exists (select 1 from public.staff_cards_in_use(p_org)) then
    tbl := 'staff_profiles';
    return next;
  end if;
end;
$$;

-- Delete one workspace, if and only if it holds nothing but setup — decided
-- and done in one transaction. The organizations row is locked FOR UPDATE
-- first, and every insert into a table with a foreign key onto it takes FOR
-- KEY SHARE on that row, so a job or a timesheet cannot land between the
-- check and the delete. The nineteen tables with no foreign key are not
-- covered by that lock; for them the window is the length of this call.
--
-- Returns: 'deleted' | 'not_found' | 'own' | 'in_use'.
-- Never a workspace the person deleting belongs to — that is how you lock
-- yourself out. The logins are NOT touched: they are Auth0's. A login whose
-- only seat was here loses its profile row (the sync re-creates it on its
-- next sign-in, which then lands on /start), so HQ stops counting it.
create or replace function public.hq_delete_workspace(p_org uuid, p_actor text, p_actor_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  org record;
  seats jsonb;
begin
  select id, name, created_at, primary_owner_user_id into org
  from organizations
  where id = p_org
  for update;
  if not found then
    return 'not_found';
  end if;

  if org.primary_owner_user_id = p_actor
     or exists (select 1 from memberships where org_id = p_org and user_id = p_actor) then
    return 'own';
  end if;

  if exists (select 1 from public.hq_workspace_records(p_org)) then
    return 'in_use';
  end if;

  select coalesce(
           jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', p.email, 'role', m.role)
                     order by m.created_at),
           '[]'::jsonb)
    into seats
  from memberships m
  left join profiles p on p.user_id = m.user_id
  where m.org_id = p_org;

  insert into hq_deleted_workspaces (workspace_id, name, signed_up_at, logins, deleted_by)
  values (p_org, org.name, org.created_at, seats, p_actor_email);

  -- the two setup tables with no foreign key, which the cascade cannot see
  delete from org_templates where org_id = p_org;
  delete from workboard_job_counters where org_id = p_org;
  delete from organizations where id = p_org;

  delete from profiles p
  where p.user_id in (select s->>'user_id' from jsonb_array_elements(seats) s)
    and not exists (select 1 from memberships x where x.user_id = p.user_id);

  return 'deleted';
end;
$$;

revoke execute on function public.hq_workspace_setup_tables() from public, anon, authenticated;
revoke execute on function public.hq_workspace_records(uuid) from public, anon, authenticated;
revoke execute on function public.hq_delete_workspace(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_workspace_records(uuid) to service_role;
grant execute on function public.hq_delete_workspace(uuid, text, text) to service_role;
