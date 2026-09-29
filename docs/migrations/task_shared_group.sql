-- One job for two people: a note that tags Luke AND Isaac on one task.
--
-- Until now that filed two unrelated rows, one per person, so Isaac ticking
-- his left Luke's open with nobody telling him it was done. `group_id` ties the
-- rows filed together from one request: ticking (or reopening) any of them
-- moves every one. NULL is the ordinary single-person task, and every task
-- written before this column.

alter table public.tasks
  add column if not exists group_id uuid;

comment on column public.tasks.group_id is
  'Rows sharing a group_id are ONE task given to several people; completing or reopening any of them does the same to all. NULL = an ordinary one-person task.';

create index if not exists tasks_group_idx
  on public.tasks (org_id, group_id)
  where group_id is not null;
