-- integration_connections.org_id gets the foreign key every sibling has.
-- APPLY THIS BEFORE MERGING THE PR (schema-as-code).
--
-- The audit's B5: this was the one org_id in the schema with no FK. Deleting
-- an organisation would have orphaned a row still holding SEALED OAUTH TOKENS
-- and a live Xero grant — invisible to every org-scoped query, uncounted by
-- nothing except the HQ capacity KPI, and revocable by nobody. CASCADE is
-- right here for the same reason it is on integration_links: a connection
-- belongs to its workspace. (The upstream revoke should still be called by
-- whatever deletes an org, but the row must not outlive it either way.)

alter table public.integration_connections
  add constraint integration_connections_org_fkey
    foreign key (org_id) references public.organizations (id) on delete cascade;
