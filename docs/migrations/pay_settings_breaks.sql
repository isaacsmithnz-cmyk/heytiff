-- Org-level break setting for Time & Pay.
--
-- APPLY BEFORE MERGE. The app tolerates the columns being absent (getPaySettings
-- reads `*` and falls back to the defaults below), so nothing breaks if this
-- lands late — but until it is applied, a break configured in the settings gear
-- silently fails to persist.
--
-- The defaults are chosen so EVERY EXISTING ORG SEES ZERO BEHAVIOUR CHANGE:
-- 0 minutes means "no break configured", so the break line never renders and
-- derived hours equal the full span. An org opts in from Time & Pay → settings
-- gear → Breaks.

alter table public.pay_settings
  add column if not exists break_minutes int not null default 0,
  add column if not exists break_paid boolean not null default true;
