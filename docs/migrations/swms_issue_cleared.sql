-- SWMS: an issue raised at sign-on, sorted on site.
--
-- A worker who raises "no anchor on the rear ridge" tells the person in
-- charge, and it sits in their bell until it is answered. The answer is
-- usually a new version of the SWMS — but often it is fixed on the spot, and
-- there was nowhere to say so, so the item nagged until the job closed.
--
-- Two columns on the sign-on that carried the issue: who said it was sorted,
-- and when. The issue itself is never erased — the printed register keeps
-- what was raised and adds who sorted it.
--
-- APPLY BEFORE DEPLOYING the code that reads them: `loadChains` selects these
-- columns by name.

alter table public.swms_signons
  add column if not exists issue_cleared_at timestamptz,
  add column if not exists issue_cleared_by_staff_id uuid;
