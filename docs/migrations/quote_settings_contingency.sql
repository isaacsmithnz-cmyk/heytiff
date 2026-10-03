-- THE DUCT CONTINGENCY, THE BUSINESS'S OWN (Isaac, 2026-10-04: "then give
-- the contingency a home").
--
-- A ducted layout almost always changes on site, so a quote can carry a
-- share of its ductwork and grilles, and some hours on top at the
-- charge-out rate. The build-up has priced one since #951, but the 15% and
-- 2 hours lived only in its tests. Now each business sets its own on the
-- Quoting page; both blank, a quote carries none.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: two new nullable columns nothing
-- reads yet.

alter table public.quote_settings
  add column if not exists contingency_pct numeric,
  add column if not exists contingency_hours numeric;

alter table public.quote_settings drop constraint if exists quote_settings_contingency_pct_check;
alter table public.quote_settings
  add constraint quote_settings_contingency_pct_check check (contingency_pct is null or (contingency_pct >= 0 and contingency_pct <= 100));
alter table public.quote_settings drop constraint if exists quote_settings_contingency_hours_check;
alter table public.quote_settings
  add constraint quote_settings_contingency_hours_check check (contingency_hours is null or (contingency_hours >= 0 and contingency_hours <= 80));

comment on column public.quote_settings.contingency_pct is
  'Duct contingency: the share of a quote''s ductwork and grilles added on, %. Null with contingency_hours null: none.';
comment on column public.quote_settings.contingency_hours is
  'Duct contingency: hours added on at the charge-out rate when a quote has ductwork. Null: none.';
