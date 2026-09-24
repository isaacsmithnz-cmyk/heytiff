-- Linking a person to a ServiceM8 staff member, or to a Xero employee, failed
-- every time with "Couldn't save that link."
--
-- THE CAUSE. Every link is written by one upsert (lib/integrations/links.ts)
-- whose ON CONFLICT names the subject columns (org, provider, kind, tenant,
-- staff_profile_id), so re-linking a person moves their link instead of
-- adding a second. The unique index on those columns was PARTIAL (`where
-- staff_profile_id is not null`), and Postgres only takes a partial index as
-- the conflict arbiter when the statement repeats its predicate, which
-- PostgREST's on_conflict has no way to say. So Postgres refused the
-- statement before it touched a row:
--
--   42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- (postgres log, 2026-09-24 06:25 UTC: Isaac linking Luke Ingold from the
-- People in ServiceM8 card. Reproduced with an EXPLAIN of the same upsert.)
--
-- THE FIX IS THE SAME RULE WITHOUT THE PREDICATE. A unique index treats NULLs
-- as distinct, so the partial clause never allowed or refused anything a
-- plain index doesn't: rows with no staff_profile_id (a later kind that links
-- the org itself) may still repeat, and a person still has one link per kind
-- per tenant. Dropped and recreated in one transaction, under the same name.
--
-- Applied to production 2026-09-24 as Supabase migration
-- `integration_links_subject_index`; the EXPLAIN now plans with
-- "Conflict Arbiter Indexes: integration_links_subject_uniq".

drop index if exists public.integration_links_subject_uniq;

create unique index integration_links_subject_uniq
  on public.integration_links (org_id, provider, kind, tenant_id, staff_profile_id);
