-- THE PROFIT TARGET (Isaac, 2026-10-07: "Just have a profit target, if it's
-- over then great, if it's under it needs a warning"; "profit will be part
-- of quoting setting").
--
-- The share of a quote's price the business means to keep, and what an hour
-- of labour costs it. Both empty for every business until it sets them: an
-- empty target checks nothing, an empty hour's cost is the charge-out rate
-- less the target (the rate already carries the profit). Nothing reads
-- either to change a price.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: two new nullable columns that nothing
-- reads yet. Apply BEFORE the code deploys: the Quoting page's save writes
-- both.

alter table public.quote_settings add column if not exists profit_target_pct numeric;
alter table public.quote_settings add column if not exists labour_cost_cents integer;

comment on column public.quote_settings.profit_target_pct is
  'The share of a quote''s price the business means to keep as profit, percent; null: no target, no check.';
comment on column public.quote_settings.labour_cost_cents is
  'What an hour of labour costs the business, cents; null: the charge-out rate less the profit target.';
