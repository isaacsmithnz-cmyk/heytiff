-- create_org_for_owner — first-login org creation as ONE transaction.
--
-- WHY: organizations.primary_owner_user_id is text NOT NULL with no default,
-- and organizations_primary_owner_fkey (primary_owner_user_id, id) →
-- memberships (user_id, org_id) is DEFERRABLE INITIALLY DEFERRED. That shape
-- admits exactly one write pattern: the org row and the owner's membership row
-- land in the SAME transaction, with the owner named at org-insert time.
-- lib/auth0.ts was doing two separate PostgREST inserts — the org insert failed
-- the NOT NULL, the error branch returned a session with no orgId, and an
-- uninvited first login ended on an empty dashboard. All four live orgs predate
-- the constraint (migration primary_owner_and_co_owners), which is why it never
-- fired in production. This RPC is that single transaction.
--
-- POSTURE: service-role only, same as every table. EXECUTE is revoked from the
-- public keys, so the function adds no reachable surface to anon/authenticated.
--
-- APPLY THIS BEFORE MERGING THE PR — lib/auth0.ts calls the RPC from then on.

create or replace function public.create_org_for_owner(p_user_id text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  insert into public.organizations (name, primary_owner_user_id)
  values (p_name, p_user_id)
  returning id into v_org_id;

  insert into public.memberships (user_id, org_id, role)
  values (p_user_id, v_org_id, 'owner');

  return v_org_id;
end;
$$;

revoke execute on function public.create_org_for_owner(text, text) from public, anon, authenticated;
grant execute on function public.create_org_for_owner(text, text) to service_role;
