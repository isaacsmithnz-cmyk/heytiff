-- invitations — one OPEN invite per address per org.
--
-- WHY: createInvite had no duplicate check and the table no unique constraint,
-- so inviting the same address twice minted two live links for one person and
-- doubled them up on the Pending tab. The app now refuses the duplicate with a
-- friendly message (app/actions/invite.ts); this index is the backstop for the
-- race two concurrent inviters can still win.
--
-- Partial on accepted_at IS NULL: an ACCEPTED invite is history (the membership
-- it created is real), and it must never block re-inviting someone who left and
-- is coming back. lower(email) is belt-and-braces — createInvite lowercases on
-- write, but the index shouldn't trust every future writer to remember.
--
-- APPLY THIS BEFORE MERGING THE PR. Re-runnable.

-- Existing duplicates would fail the index build: keep only the newest open
-- invite for each (org, address), delete the older ones. Ties on created_at
-- (batch inserts) break on id so exactly one row survives.
delete from public.invitations a
using public.invitations b
where a.org_id = b.org_id
  and lower(a.email) = lower(b.email)
  and a.accepted_at is null
  and b.accepted_at is null
  and (b.created_at > a.created_at
       or (b.created_at = a.created_at and b.id > a.id));

create unique index if not exists invitations_one_open_per_email
  on public.invitations (org_id, lower(email))
  where accepted_at is null;
