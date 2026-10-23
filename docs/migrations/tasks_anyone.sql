-- A task for a job and nobody in particular (Isaac, 24 October 2026: "You
-- should be able to assign a task to just a job without having to select a
-- person. It can just say anyone"). Its assignee is empty; it stays open on
-- the job's card for whoever is there to tick off. The composite foreign key
-- (assigned_to, org_id) skips a null assignee, so only the NOT NULL goes.
alter table public.tasks alter column assigned_to drop not null;
