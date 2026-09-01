-- "At four" and "by four" are not the same instruction.
--
-- THE PROBLEM. `tasks.remind_at` is the only time-bearing column on a task,
-- and it carries exactly one meaning: a moment. That is right for the car
-- service booked at 7:30 — you are meant to be there then. It is wrong for
-- "the crane truck has to be back in the yard by four", which is the same
-- shape of data and the opposite instruction: four o'clock is the moment you
-- have RUN OUT of time, not the moment to start.
--
-- The two read identically today, so the Home day rail could only draw both
-- the same way, as a thing happening at a time. A deadline drawn as an
-- appointment tells you to begin when you should already be finished (Isaac,
-- 2026-08-31, asking for the deadline row on the rail).
--
-- WHAT THIS ADDS. One word beside the time.
--
--   'at' — be doing it then. A booking, a call, an appointment.
--   'by' — have it finished by then. A deadline.
--
-- NULLABLE, AND NULL MEANS 'at'. Every reminder written before today came
-- from a note asking to be nudged — "remind me Monday morning" — which is an
-- 'at'. So the absence of a word already means the right thing, and a
-- backfill would be writing down what the reader can already work out. Reads
-- go through `remindKindOf` in src/lib/dashboard/reminders.ts, which is the
-- one place that turns null into 'at'; nothing else should do that coalesce
-- for itself or the default becomes four opinions.
--
-- THE SECOND CONSTRAINT IS THE ONE WORTH READING. A kind without a time is
-- not a weaker fact, it is a meaningless one — "by" what? Letting it exist
-- would mean every reader has to decide what to do with a deadline that names
-- no moment, and they would not all decide the same. The database refuses it
-- instead.
--
-- POSTURE: RLS on with no policies, unchanged. Enforcement stays app-layer in
-- src/app/actions/workboard-notes.ts and src/app/actions/reminders.ts.
--
-- APPLY THIS BEFORE MERGING THE PR.

-- ── 1. the word beside the time ───────────────────────────────────────────
alter table public.tasks
  add column if not exists remind_kind text;

comment on column public.tasks.remind_kind is
  'How to read remind_at: ''at'' = be doing it then, ''by'' = have it finished by then. NULL reads as ''at'' (see remindKindOf).';

-- ── 2. the two things it may say, and nothing else ────────────────────────
alter table public.tasks
  drop constraint if exists tasks_remind_kind_check;
alter table public.tasks
  add constraint tasks_remind_kind_check
  check (remind_kind is null or remind_kind in ('at', 'by'));

-- ── 3. a kind is only meaningful with a moment to qualify ─────────────────
alter table public.tasks
  drop constraint if exists tasks_remind_kind_needs_time;
alter table public.tasks
  add constraint tasks_remind_kind_needs_time
  check (remind_kind is null or remind_at is not null);
