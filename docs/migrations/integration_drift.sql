-- Scheduled drift check — remembering what the last sweep found.
--
-- WHY THIS EXISTS: Xero has no payroll webhook (their event catalogue is
-- Contact, Invoice, Subscription and Credit Note — nothing for employees or pay
-- templates), so nobody is told when a wage changes. Everyone who does this
-- polls, and these two columns are what a poll leaves behind.
--
-- A COUNT, DELIBERATELY, AND NOT THE AMOUNTS. It would be easy to cache the
-- drifting rates here so the screen could render them without a call. That
-- would put wages at rest in a row that is read outside the `financials` gate
-- (getConnectionView feeds the Integrations screen), and the whole wage design
-- so far has been about money never travelling further than it must. So the
-- sweep stores "2 differ, last looked on Tuesday" and the actual figures come
-- from the live, gated read behind the Check pay rates button.
--
-- drift_checked_at IS ALSO THE POLLING CURSOR. It is passed to Xero as
-- If-Modified-Since, so a quiet week costs ONE call for the whole organisation
-- rather than one per employee — the cheap gate that makes a schedule
-- affordable at all.
--
-- Both nullable: a connection that has never been swept is not the same as one
-- swept and found clean, and the screen says so differently.
--
-- APPLY THIS BEFORE MERGING THE PR. Nothing breaks without it — the sweep
-- treats a missing column as "never checked" — but nothing is remembered either.

alter table public.integration_connections
  add column if not exists drift_count      integer,
  add column if not exists drift_checked_at timestamptz;
