-- KEPT OPEN AS A TENDER (Isaac, 2026-10-08: "Do 60 days with option to
-- extend if it's a tender etc"). A quote counts as lost 60 days after its job
-- was raised, and a quote kept open as a tender only after the tender days.
--
-- 1. A sixth question on job_analytics_decisions, `extend`, whose one answer
--    is `tender`: Analytics, Quotes, "Tender, keep open". Undo deletes the
--    row. Widens the question check job_analytics_void.sql made.
-- 2. The tender days on analytics_settings, null being 180
--    (src/lib/analytics/settings.ts).
--
-- SAFE TO APPLY BEFORE THE PR MERGES: the code before it never writes
-- `extend` or the new column, and every row it wrote still passes.

alter table public.job_analytics_decisions
  drop constraint if exists job_analytics_decisions_question_check;

alter table public.job_analytics_decisions
  add constraint job_analytics_decisions_question_check
  check (question in ('quote', 'kind', 'price', 'outcome', 'void', 'extend'));

alter table public.analytics_settings
  add column if not exists tender_after_days integer;
