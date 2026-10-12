-- Live records — who else has a job open, and word when they write in its
-- diary — over Supabase Realtime PRIVATE channels.
--
-- Each record has its own topic, `record:<org_id>:<kind>:<id>`. The browser
-- joins it with a ticket the server signs (app/actions/realtime,
-- lib/realtime/token): HS256 with SUPABASE_JWT_SECRET, role
-- `authenticated`, an hour long, its workspace in the claim `heytiff_org`.
--
-- WHY `heytiff_org` AND NOT `org_id`: five tables already have tenant_select
-- policies reading `auth.jwt() ->> 'org_id'` (invitations, memberships,
-- organizations, studio_designs, studio_design_contributors). A ticket that
-- carried `org_id` would open those rows to every member's browser through
-- the REST API. This one opens nothing but its own workspace's channels.
--
-- POSTURE: every public table keeps RLS on with the policies it has; these
-- are the first on realtime.messages, and the only thing they allow is
-- hearing (select) and speaking (insert: presence and broadcast) on a topic
-- whose second part is the ticket's own workspace.
--
-- APPLY THIS BEFORE SETTING NEXT_PUBLIC_LIVE_RECORDS=1. Without it a private
-- channel refuses every join, and the cards simply say nothing about who
-- else is there.

create policy "heytiff live records: hear own workspace"
  on realtime.messages
  for select
  to authenticated
  using (
    split_part((select realtime.topic()), ':', 1) = 'record'
    and split_part((select realtime.topic()), ':', 2) = (auth.jwt() ->> 'heytiff_org')
  );

create policy "heytiff live records: speak in own workspace"
  on realtime.messages
  for insert
  to authenticated
  with check (
    split_part((select realtime.topic()), ':', 1) = 'record'
    and split_part((select realtime.topic()), ':', 2) = (auth.jwt() ->> 'heytiff_org')
  );

-- Read-only checks, before and after:
--   select policyname, cmd, roles from pg_policies where schemaname = 'realtime';
-- Rollback:
--   drop policy "heytiff live records: hear own workspace" on realtime.messages;
--   drop policy "heytiff live records: speak in own workspace" on realtime.messages;
