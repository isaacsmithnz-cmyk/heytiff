-- VISIT TASKS (Isaac, 2026-10-06: "create a task list from the TIFF quote,
-- which can then be allocated to visits, or they can just be viewed as a
-- whole list… tasks can move across visits as they are not completed on
-- that day").
--
-- job_tasks: one row a task on a job — made by Tiff from the accepted quote
-- option, or added by a person. `visit` is the visit it is planned for
-- (the job's days on site counted from 1), null until it has one. A task
-- not finished on its visit is shown on the next one; nothing is rewritten
-- to move it. `unit` is the quote's unit a unit task is for, as it stood
-- when the task was made; `serial` and `model_read` are read from its
-- rating-plate photo.
--
-- job_task_updates: what each day did to a task — how far it went (from,
-- to) and the note. A visit's card shows the updates made on its day, so
-- the card is the record of what was done on that visit.
--
-- sm8_job_uuid is the mirror's job uuid, not a foreign key: the mirror is
-- disposable, the tasks are ours. RLS deny-all; the service role is the
-- only way in, and the route gates. SAFE TO APPLY BEFORE THE PR MERGES:
-- nothing reads these tables until it ships.

create table if not exists public.job_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  sm8_job_uuid text not null,
  name text not null,
  stage text not null,
  kind text not null,
  unit jsonb,
  visit integer,
  sort integer not null default 0,
  progress integer not null default 0,
  done_at timestamptz,
  done_by text,
  serial text,
  model_read text,
  source text not null default 'quote',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_tasks_name_len check (char_length(name) between 1 and 200),
  constraint job_tasks_stage check (stage in ('Site measure', 'Rough-in', 'Install', 'Fit-off', 'Commissioning', 'Return')),
  constraint job_tasks_kind check (kind in ('tick', 'progress', 'unit')),
  constraint job_tasks_visit check (visit is null or visit between 1 and 99),
  constraint job_tasks_progress check (progress between 0 and 100),
  constraint job_tasks_source check (source in ('quote', 'person'))
);
create index if not exists job_tasks_job_idx on public.job_tasks (org_id, sm8_job_uuid, sort);
comment on table public.job_tasks is 'A job''s tasks, from the accepted quote or added by a person, each planned for a visit (days on site counted from 1). See docs/migrations/job_tasks.sql.';
alter table public.job_tasks enable row level security;

create table if not exists public.job_task_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.job_tasks (id) on delete cascade,
  sm8_job_uuid text not null,
  day date not null,
  pct_from integer not null,
  pct_to integer not null,
  note text not null default '',
  by_user text,
  by_name text,
  created_at timestamptz not null default now(),
  constraint job_task_updates_pct check (pct_from between 0 and 100 and pct_to between 0 and 100),
  constraint job_task_updates_note_len check (char_length(note) <= 500)
);
create index if not exists job_task_updates_job_idx on public.job_task_updates (org_id, sm8_job_uuid, created_at);
create index if not exists job_task_updates_task_idx on public.job_task_updates (task_id);
comment on table public.job_task_updates is 'What each day did to a job task: how far it went and the note. A visit''s card shows its day''s updates.';
alter table public.job_task_updates enable row level security;
