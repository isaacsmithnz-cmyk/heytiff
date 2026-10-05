-- A UNIT'S PHOTOS (Isaac, 2026-10-06: "on each unit, like where it says
-- install the living room unit, that's on that task somewhere that you can
-- snap the photo of that particular unit, and serial numbers etc. can be
-- read from there using photos").
--
-- job_task_photos: a photo taken on a job task — the unit in place, its
-- rating plate, or anything else — linking the task to the document the
-- photo was uploaded as (kind job_document, on the same job). The plate's
-- model and serial are read into job_tasks.model_read / serial.
--
-- RLS deny-all; the service role is the only way in, and the route gates.
-- SAFE TO APPLY BEFORE THE PR MERGES: nothing reads it until it ships.

create table if not exists public.job_task_photos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.job_tasks (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  role text not null default 'other',
  created_by text,
  created_at timestamptz not null default now(),
  constraint job_task_photos_role check (role in ('unit', 'plate', 'other')),
  constraint job_task_photos_once unique (task_id, document_id)
);
create index if not exists job_task_photos_task_idx on public.job_task_photos (org_id, task_id);
comment on table public.job_task_photos is 'Photos taken on a job task (the unit in place, its rating plate), each a job document. See docs/migrations/job_task_photos.sql.';
alter table public.job_task_photos enable row level security;
