-- A ServiceM8 job becomes something a note can be written ON
-- (job-card redesign, slice 5).
--
-- Until now `NoteTarget` knew three things: a project, a maintenance visit
-- and an agreement. All three are HeyTiff's own rows, so "keep it on the
-- job" could append to a `notes` column they each own. A ServiceM8 job has
-- no such column and never will — the mirror is READ-ONLY by charter — so
-- the job's written record is its DIARY, and a note written on a job lives
-- in `workboard_notes` itself, where the card reads it back beside
-- ServiceM8's own notes.
--
-- Which is why this migration is three check constraints and no new column
-- on the notes table: `target_id` is already `uuid`, and every one of the
-- 3,517 mirrored jobs carries a uuid-shaped `sm8_jobs.uuid` (verified live
-- before this was written), so a job target fits the shape the table has
-- always had.

alter table public.workboard_notes
  drop constraint if exists workboard_notes_target_kind_check;
alter table public.workboard_notes
  add constraint workboard_notes_target_kind_check
    check (target_kind in ('none', 'project', 'visit', 'agreement', 'job'));

alter table public.workboard_flags
  drop constraint if exists workboard_flags_target_kind_check;
alter table public.workboard_flags
  add constraint workboard_flags_target_kind_check
    check (target_kind in ('none', 'project', 'visit', 'agreement', 'job'));

alter table public.workboard_issues
  drop constraint if exists workboard_issues_target_kind_check;
alter table public.workboard_issues
  add constraint workboard_issues_target_kind_check
    check (target_kind in ('none', 'project', 'visit', 'agreement', 'job'));


-- What was DONE about one of ServiceM8's own notes.
--
-- The attention strip suggests work off two ServiceM8 signals: a note marked
-- "action required", and a note that @mentions one of the crew. Both are
-- read-only rows in a mirror we may not write, so the record of having dealt
-- with one has to live on our side of the fence — and it has to be keyed by
-- the note's own uuid, because that is the only stable name the mirror gives
-- us. Two outcomes, one row each:
--
--   task       somebody made a task out of it. `task_id` is the join the
--              `tasks` table deliberately doesn't carry ("a task from a note
--              stands alone"), recorded here where it is about a specific
--              mirrored note rather than about tasks in general.
--   dismissed  somebody looked and decided it wasn't work. Dismissed stays
--              dismissed — the strip must never re-suggest something a
--              person has already answered.
--
-- One row per note per org: answering a note twice is answering it once, and
-- the unique index is what makes "dismissed stays dismissed" a fact about
-- the data rather than a rule the reader has to remember.

create table if not exists public.job_note_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- the ServiceM8 note this answers, and the job it was filed against; the
  -- job is denormalised so the card can read its own answers in one query
  -- without joining back through the mirror.
  sm8_note_uuid text not null,
  sm8_job_uuid text not null,
  action text not null
    constraint job_note_actions_action_check check (action in ('task', 'dismissed')),
  task_id uuid references public.tasks(id) on delete set null,
  acted_by uuid references public.staff_profiles(id) on delete set null,
  acted_at timestamptz not null default now()
);

create unique index if not exists job_note_actions_one_per_note
  on public.job_note_actions (org_id, sm8_note_uuid);

create index if not exists job_note_actions_by_job
  on public.job_note_actions (org_id, sm8_job_uuid);

alter table public.job_note_actions enable row level security;

comment on table public.job_note_actions is
  'What was DONE about one of ServiceM8''s own job notes — a task made from it, or a decision that it was not work. Keyed by the mirror note''s uuid because that is the only stable name a read-only mirror gives us; deliberately NOT a foreign key into sm8_job_notes, which is a disposable cache.';
comment on column public.job_note_actions.task_id is
  'The job↔task join the tasks table deliberately does not carry. Recorded here because it is a fact about one mirrored note, not a new column on tasks.';
