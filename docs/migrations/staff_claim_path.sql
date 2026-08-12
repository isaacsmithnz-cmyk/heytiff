-- staff_claim_path — a staff card can exist BEFORE its person, and the invite
-- is what binds the two.
--
-- WHY: cards are about to be creatable ahead of their people — imported from
-- ServiceM8 or Xero, or pre-seeded by hand — with user_id null until someone
-- arrives. Until now the only card-writer was ensureStaffCard at first
-- arrival, so "one human, one card" held because there was a single writer.
-- Once a card can be waiting, acceptance must ADOPT it (invite/accept/route.ts)
-- or every import turns into a duplicate on the person's first day.
--
-- staff_profiles.contact_email — the address we hold for someone with no
-- account yet. It prefills their invite and feeds the email matcher (match.ts)
-- the same way the profiles join does once they've signed in; after they
-- arrive, the account email supersedes it for display. NOT unique: the world
-- contains shared addresses, and the matcher treats a duplicate as ambiguous
-- rather than letting a constraint pretend otherwise.
--
-- invitations.staff_profile_id — the card this invite claims on acceptance.
-- Nullable: a plain email invite stays exactly what it was. ON DELETE SET
-- NULL: deleting the card demotes the invite to a plain one instead of
-- breaking a link somebody already sent.
--
-- ONE OPEN INVITE PER CARD — the same backstop addresses already have
-- (invitations_one_open_per_email): the app refuses the duplicate with a
-- friendly message, and the partial index wins the race two concurrent
-- inviters can still tie. Accepted invites are history and never block.
--
-- POSTURE: RLS unchanged — both tables stay deny-all, all access through the
-- service-role client behind app-layer gates.
--
-- APPLY THIS BEFORE MERGING THE PR. Re-runnable; both columns are additive
-- and nullable, so live code is indifferent until the PR lands.

alter table public.staff_profiles
  add column if not exists contact_email text;

alter table public.invitations
  add column if not exists staff_profile_id uuid
    references public.staff_profiles(id) on delete set null;

create unique index if not exists invitations_one_open_per_card
  on public.invitations (org_id, staff_profile_id)
  where accepted_at is null and staff_profile_id is not null;
