-- A new staff member's first run: when they finished it, or waved it away.
--
-- The staff mirror of organizations.setup_completed_at. Home sends a member
-- whose card has no stamp to /welcome/details once; "Save details" and "Skip
-- for now" both write it, so the screen is a welcome and never a nag. What
-- keeps reminding them afterwards is the completeness model, through Home's
-- attention count, not this column.
--
-- NULLABLE AND ADDITIVE, so it is safe to apply before the deploy that reads
-- it: until then nothing selects it, and the gate that does fails open on a
-- read error rather than blocking Home.
--
-- NO BACKFILL, ON PURPOSE. Every existing card starts unstamped, so members
-- already in a workspace meet the screen once on their next visit to Home.
-- That is the point: the cards this was built for (a first name that is an
-- email address, a first name that is an email prefix) belong to people who
-- have already accepted. Owners never see it — they have /welcome.

alter table public.staff_profiles
  add column if not exists onboarded_at timestamptz;
