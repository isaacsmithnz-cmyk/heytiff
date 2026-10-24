-- NEW › NOTE (Isaac, 24 October 2026: "Yes to new note"; a note with no job
-- goes to the people you name, or to the office if you name nobody, and a
-- note is for note taking, not the task part). A note and its replies are
-- one thread: the first note is the thread, and a reply names it. Who is in
-- a thread, and whether they've said Done to it, is shared_note_people.
-- (My notes, private to their writer, are staff_notes: a different table.)
-- Additive: two new tables, deny-all RLS like every other table here
-- (enforcement is the app's, through the service role).

create table if not exists public.shared_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- null on the note that opens a thread; a reply names that note
  thread_id uuid references public.shared_notes(id) on delete cascade,
  author_id uuid not null,
  body text not null check (char_length(body) between 1 and 4000),
  -- the job it is about, when it is about one, and the job's own note it
  -- was kept as (workboard_notes), so the job's conversation holds it too
  job_uuid text,
  job_note_id uuid,
  -- written to the office (the workspace's owners and admins) rather than
  -- to people by name
  to_office boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (author_id, org_id) references public.staff_profiles(id, org_id)
);

create index if not exists shared_notes_thread on public.shared_notes (org_id, thread_id, created_at);

create table if not exists public.shared_note_people (
  thread_id uuid not null references public.shared_notes(id) on delete cascade,
  staff_id uuid not null,
  org_id uuid not null,
  -- in it as one of the office, so one of them saying Done says it for all
  via_office boolean not null default false,
  -- said Done, or wrote the last word; cleared when someone else writes
  done_at timestamptz,
  primary key (thread_id, staff_id),
  foreign key (staff_id, org_id) references public.staff_profiles(id, org_id) on delete cascade
);

create index if not exists shared_note_people_open on public.shared_note_people (org_id, staff_id) where done_at is null;

alter table public.shared_notes enable row level security;
alter table public.shared_note_people enable row level security;
