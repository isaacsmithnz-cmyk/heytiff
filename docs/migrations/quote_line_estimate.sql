-- A LINE'S PRICE AN ESTIMATE, TO CONFIRM (Isaac, 2026-10-10: "I notice
-- you've got to check consumables not known yet. That could be an estimate.
-- And we can confirm that").
--
-- quote_lines.estimate: the line's price is an estimate (consumables priced
-- from the business's own book when Quoting has no allowance set), shown on
-- the line and in To confirm until a person confirms it or sets their own.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: one column with a default every
-- existing row takes (false). Additive and idempotent.

alter table public.quote_lines add column if not exists estimate boolean not null default false;

comment on column public.quote_lines.estimate is
  'The line''s price is an estimate to confirm (consumables from the book); false once a person confirms or sets it. See src/lib/quotes/lines.ts.';
