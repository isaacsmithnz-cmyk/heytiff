-- How far a plan's read has got, for the bar under it while Tiff reads
-- (Isaac, 20 November 2026: "put progress bar on reading"). Written as the
-- read goes: { step, done, total, at }, the step one of drawing (the pages
-- drawn small), finding (which pages are floors), floors (the floors drawn
-- in full) or reading (each floor read, with the roof and the site). Null
-- before a read starts and kept as the last step it reached.
alter table public.job_plans add column if not exists progress jsonb;
