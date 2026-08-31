-- transfer_org_ownership — handing the account over, as ONE transaction.
--
-- WHY A FUNCTION. Two rows have to move together: the new owner's
-- memberships.role (a master IS an owner by definition — see isMasterOwner in
-- lib/permissions.ts) and organizations.primary_owner_user_id. PostgREST cannot
-- span a transaction, and both half-states are bad: point the org at a
-- non-owner and the org has NO master at all — nobody can transfer, bill or
-- delete it, and canRemoveMember stops protecting them — while promoting first
-- and failing second leaves a co-owner nobody asked for.
--
-- The FK organizations_primary_owner_fkey (primary_owner_user_id, id) →
-- memberships (user_id, org_id) already refuses a target who is not a member of
-- the org. This function refuses the rest, in words the action can translate.
--
-- THE ACTOR CHECK IS A CONCURRENCY GUARD, not the user-facing gate — that is
-- isMaster() in actions/org-ownership.ts. The org row is locked before it is
-- read, so two masters cannot exist and two transfers cannot race one another
-- into a fork.
--
-- POSTURE: service-role only, same as create_org_for_owner. EXECUTE is revoked
-- from the public keys, so this adds no reachable surface to anon/authenticated.
--
-- APPLY THIS BEFORE MERGING THE PR — actions/org-ownership.ts calls the RPC.

-- permission_audit logs role and capability changes; ownership is the third
-- kind, and the one most worth having six months later. (The CHECK is dropped
-- and re-added rather than altered — Postgres has no ALTER CONSTRAINT for a
-- check expression.)
alter table public.permission_audit
  drop constraint if exists permission_audit_change_type_check;
alter table public.permission_audit
  add constraint permission_audit_change_type_check
  check (change_type = any (array['role'::text, 'capability'::text, 'ownership'::text]));

create or replace function public.transfer_org_ownership(
  p_org_id uuid,
  p_actor_user_id text,
  p_new_owner_user_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_master text;
  v_role text;
begin
  -- FOR UPDATE before the check, not after: reading the master unlocked lets
  -- two concurrent transfers both pass it.
  select primary_owner_user_id into v_master
    from public.organizations where id = p_org_id for update;

  if v_master is null then raise exception 'org_not_found'; end if;
  if v_master <> p_actor_user_id then raise exception 'not_master'; end if;
  if p_new_owner_user_id = p_actor_user_id then raise exception 'already_master'; end if;

  select role into v_role
    from public.memberships
    where org_id = p_org_id and user_id = p_new_owner_user_id;

  if v_role is null then raise exception 'not_a_member'; end if;

  -- Promoting clears the capability overrides, the same bargain a role change
  -- makes on the Team card: the role means what it says, with no invisible
  -- leftovers from the position they used to hold. A co-owner already holds
  -- every capability, so theirs are left exactly as they are.
  if v_role <> 'owner' then
    update public.memberships
       set role = 'owner', permissions = '{}'::jsonb
     where org_id = p_org_id and user_id = p_new_owner_user_id;
  end if;

  update public.organizations
     set primary_owner_user_id = p_new_owner_user_id
   where id = p_org_id;

  -- The outgoing master KEEPS role='owner' and becomes a co-owner: handing the
  -- account over is not resigning from the business. Any owner can demote them
  -- afterwards from Team — which they could not while they were the master.
  insert into public.permission_audit
    (org_id, actor_user_id, target_user_id, change_type, detail)
  values
    (p_org_id, p_actor_user_id, p_new_owner_user_id, 'ownership',
     jsonb_build_object(
       'from_user_id', p_actor_user_id,
       'to_user_id', p_new_owner_user_id,
       'previous_role', v_role
     ));
end;
$$;

revoke execute on function public.transfer_org_ownership(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.transfer_org_ownership(uuid, text, text) to service_role;
