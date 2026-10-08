-- THE BUSINESS'S OWN TASK HOURS (the engine rebuild, slice 8.1).
--
-- Hours for a zone, an outlet or grille, a metre of pipe and a visit, set
-- in Quoting. Empty for every business until it sets them. A quote's lines
-- are counted for each and what the hours come to is shown beside the hours
-- the quote carries: a check, never a price.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: one new column with an empty default.
-- Apply BEFORE the code deploys: the Quoting page's save writes it.

alter table public.quote_settings add column if not exists task_hours jsonb not null default '{}'::jsonb;

comment on column public.quote_settings.task_hours is
  'The business''s own hours for a task: {zone, grille, metre, visit}, each hours or absent. A check beside a quote''s labour, never a price. See src/lib/quotes/task-hours.ts.';
