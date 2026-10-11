-- WHAT EVERY JOB STARTS WITH (Isaac, 2026-10-10: "the tasks can be
-- auto-populated for basic things, so protection, check site for damages
-- that we could be blamed for").
--
-- quote_settings.starter_tasks: the business's own list, [{ name, when:
-- first|every|last, photos }]; null until it saves one, when the starter set
-- applies (src/lib/quotes/settings.ts STARTER_TASKS). An empty list is none.
--
-- job_tasks.kind gains 'photos': a task done by taking photos (the damage
-- before the work, the work after).
--
-- SAFE TO APPLY BEFORE THE PR MERGES: one nullable column, and a check
-- widened. Additive and idempotent.

alter table public.quote_settings add column if not exists starter_tasks jsonb;

comment on column public.quote_settings.starter_tasks is
  'What every new job''s task list starts with: [{ name, when: first|every|last, photos }]; null is the starter set. See src/lib/quotes/settings.ts.';

alter table public.job_tasks drop constraint if exists job_tasks_kind;
alter table public.job_tasks add constraint job_tasks_kind check (kind in ('tick', 'progress', 'unit', 'photos'));
