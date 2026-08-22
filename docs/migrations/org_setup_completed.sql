-- org_setup_completed — the fact the welcome flow pivots on.
--
-- WHY A COLUMN AND NOT AN INFERENCE: "the org has no trading name" cannot
-- tell a brand-new company apart from an owner who looked at the setup screen
-- and chose "skip for now". Inference would re-prompt the skipper on every
-- visit to Home forever, which turns a courtesy into a nag. A timestamp
-- records the one thing the flow actually needs to know — this org has been
-- through the door once — and when.
--
-- NULL means "never offered or never finished": exactly the state
-- create_org_for_owner leaves a fresh org in, so new signups get the flow
-- with no change to that RPC. The backfill stamps every EXISTING org as done —
-- the live orgs predate the flow and their owners should not sign in to a
-- setup wizard for a company that is already set up.
--
-- The code fails soft in both directions: before this is applied, the reads
-- error, resolve to "nothing pending", and the app behaves exactly as today.
--
-- APPLY THIS BEFORE MERGING THE PR — until it lands the welcome screen is
-- simply unreachable.

alter table public.organizations
  add column if not exists setup_completed_at timestamptz;

update public.organizations
  set setup_completed_at = now()
  where setup_completed_at is null;
