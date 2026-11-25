-- A person deleting their own HeyTiff account, from the phone (More, Delete
-- account). The App Store asks that an app which makes accounts can delete
-- them in the app (guideline 5.1.1(v); Isaac, 26 November 2026: "1, add both").
--
-- WHAT GOES: what is only theirs. Their seats in every workspace, their
-- profile (name, email, picture), their phones' push tokens, the last place
-- their phone was seen, their conversations with Tiff, their drafts, pins,
-- stars and skips. Their login goes too, but that is Auth0's, and the route
-- deletes it before calling this (lib/integrations/auth0-management).
--
-- WHAT STAYS: the business's records. Their staff card is set Inactive, not
-- deleted: timesheets, leave, job notes, check-ins and the rest hang off it,
-- and an employer keeps employee records for seven years (staff_card_delete.sql
-- says the same). The card keeps its user_id, an opaque id nobody can sign in
-- as once the login is gone, so those records still join to it.
--
-- NEVER AN OWNER. An owner's seat is the business's, and organizations'
-- primary_owner_user_id points at it; that is a change of ownership, done on
-- the web or by writing to us. Returns 'owner' and touches nothing.
--
-- Returns: 'deleted' | 'owner'. Idempotent: a second call finds nothing and
-- says 'deleted'.
--
-- WHEN TO APPLY: BEFORE the deploy that calls it. Additive (create or
-- replace); old code never calls it.
--
-- POSTURE: service-role only, like every table (RLS deny-all).

create or replace function public.delete_account(p_user text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null or p_user = '' then
    raise exception 'delete_account needs a user';
  end if;

  perform 1 from memberships where user_id = p_user for update;
  if exists (select 1 from memberships where user_id = p_user and role = 'owner')
     or exists (select 1 from organizations where primary_owner_user_id = p_user) then
    return 'owner';
  end if;

  delete from mobile_push_devices where user_sub = p_user;
  delete from staff_positions where user_id = p_user;
  delete from tiff_threads where user_sub = p_user;
  delete from reply_drafts where user_sub = p_user;
  delete from nav_pins where user_sub = p_user;
  delete from job_stars where user_id = p_user;
  delete from staff_job_skips where user_id = p_user;
  update staff_profiles set status = 'Inactive', updated_at = now() where user_id = p_user;
  delete from memberships where user_id = p_user;
  delete from profiles where user_id = p_user;
  return 'deleted';
end;
$$;

revoke execute on function public.delete_account(text) from public, anon, authenticated;
grant execute on function public.delete_account(text) to service_role;
