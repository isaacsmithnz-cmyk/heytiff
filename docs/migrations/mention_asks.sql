-- One task per ask: Tiff's reading of a ServiceM8 job note that @mentions a
-- linked person, and the ONE task it made them.
--
-- WHAT WRITES IT. The settle (src/lib/dashboard/mention-settle.ts,
-- settleMentionAsks), which runs after a ServiceM8 sync, behind the response
-- on a page load (src/lib/integrations/sm8-freshness.ts) and in the nightly
-- cron (src/app/api/cron/sm8-sync/route.ts). For each person integration_links
-- names, whom the HOME_DESK flag gives the new Home, it reads the notes of the
-- last 30 days that ask them something (src/lib/workboard/mention-brain.ts,
-- readAsk), at most 5 reads a run, and files each ask as one task for them.
-- A later reply of theirs to the asker, written in ServiceM8, can move that
-- task or tick it off (readReply); it never makes a second one. Nothing here
-- is ever sent to ServiceM8: no sm8_writes row, no write of any kind. The
-- task goes on the person's OWN list (created_by = assigned_to): nobody gave
-- it to them, so it is nobody's delegated work, and no manager's team list
-- shows it.
--
-- A NOTE THE JOB CARD'S STRIP ALREADY ANSWERED (job_note_actions: somebody
-- pressed its suggestion, or dismissed it) is never read: its row is written
-- straight as 'read', naming the strip's task (kind 'do') or none (a
-- dismissal), so one ask is still one task.
--
-- WHAT READS IT. The new Home's diary (mentions-query.ts: "1 task for you"
-- under the conversation, and "Luke asked you" on the list's row), the
-- job card's strip (job-notes-query.ts), which stops suggesting a task for a
-- note that already made one, and shows that task instead, and the new
-- Home's Tasks tab (task-record-query.ts), which says the task came from
-- the asker's note, and opens its conversation, by mention_asks_by_task.
--
-- ONE ROW PER (NOTE, PERSON). Unlike job_note_actions (one row per note per
-- workspace, written when somebody presses the strip's suggestion), a note
-- that asks two people is two asks. The unique index is also the LEASE: a
-- run claims an ask by inserting its row as 'reading'; a second run's insert
-- fails and it moves on. A 'reading' row whose claim is more than five
-- minutes old (claimed_at), or was let go after a failed read (claimed_at
-- null), can be claimed again; the third failed read sets 'failed'.
--
-- NO NOTE TEXT IS STORED. The words stay in the mirror (sm8_job_notes); this
-- keeps the note's uuid, the job's, and who asked (asker_sm8_uuid: the
-- editor ServiceM8 named when the ask was first read, since ServiceM8 keeps
-- only the LAST editor). due_said is the reply's own words for when ("this
-- afternoon"), in Australian English, as the task door says them; words
-- like that are only true on the day they were written, so due_said_on is
-- that day (on the account's clock) and due_said_for the day they named,
-- and the door says them only on due_said_on, and only while the task is
-- still due on due_said_for (a task moved by hand since keeps no stale
-- "this afternoon").
--
-- YOUR REPLIES. last_reply_note is the newest reply of yours already read
-- for this ask; reply_attempts counts reads of the replies after it that
-- failed, and the MAX-th sets them aside (last_reply_note moves past them).
-- A refusal is final at once; an outage (rate limit, the reader down) is
-- never counted against an ask or a reply. A read that runs out of time is
-- counted, unless the run's next read runs out of time too: then it was
-- the reader, and neither is.
--
-- A deleted task sets task_id null and the row stays: the ask was read, the
-- strip stays quiet, and the diary says "1 task removed.". A disconnect
-- leaves the rows alone: they are HeyTiff's own.
--
-- POSTURE: RLS on, no policies; enforcement app-layer, like every other
-- table here. The staff key is composite with org_id, so an ask can never
-- name another workspace's person.
--
-- APPLY BEFORE MERGING the one-task-per-ask pull request (H18). Additive and
-- idempotent: one new table and three indexes, nothing altered; running it
-- twice changes nothing. The code runs without it: the settle finds no
-- table and makes nothing, the diary shows no task door, and the strip is
-- as it was.
--
-- READ-ONLY CHECKS, BEFORE:
--   select to_regclass('public.mention_asks');                     -- expect null
--   select to_regclass('public.tasks'), to_regclass('public.staff_profiles');
--   -- the staff key needs staff_profiles unique on (id, org_id) (task_events
--   -- already relies on it):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.staff_profiles'::regclass and contype in ('p', 'u');
--   select indexname, indexdef from pg_indexes
--     where schemaname = 'public' and tablename = 'staff_profiles';
--   -- how many asks the first runs will read: the linked people's
--   -- mentions in the last 30 days (expect a handful; a run reads 5):
--   select count(*) from public.sm8_job_notes
--     where org_id = '<org uuid>' and active = 1
--       and note ilike '%@<handle>%'
--       and create_date >= '<today - 30 days, yyyy-mm-dd>';
-- AND AFTER:
--   select count(*) from public.mention_asks;                       -- expect 0
--   select relrowsecurity from pg_class where oid = 'public.mention_asks'::regclass;  -- t
--   select count(*) from pg_policies where tablename = 'mention_asks';                -- 0
--   select column_name, data_type from information_schema.columns
--     where table_schema = 'public' and table_name = 'mention_asks' order by ordinal_position;
--     -- 19 columns, reply_attempts integer, due_said_on and due_said_for date
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.mention_asks'::regclass order by 1;
--   select indexname, indexdef from pg_indexes
--     where schemaname = 'public' and tablename = 'mention_asks' order by 1;
--
-- ROLLBACK: drop table if exists public.mention_asks;
--           (the tasks it made stay, as the person's own tasks)

create table if not exists public.mention_asks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  sm8_note_uuid    text not null,
  sm8_job_uuid     text not null,
  staff_id         uuid not null,
  asker_sm8_uuid   text,
  status           text not null default 'reading'
                     constraint mention_asks_status_check
                     check (status in ('reading', 'read', 'failed')),
  kind             text
                     constraint mention_asks_kind_check
                     check (kind in ('do', 'question', 'none')),
  task_id          uuid references public.tasks (id) on delete set null,
  due_said         text,
  due_said_on      date,
  due_said_for     date,
  last_reply_note  text,
  reply_attempts   integer not null default 0,
  attempts         integer not null default 0,
  error            text,
  claimed_at       timestamptz default now(),
  read_at          timestamptz,
  created_at       timestamptz not null default now(),
  constraint mention_asks_read_kind
    check (status <> 'read' or kind is not null),
  constraint mention_asks_staff_fkey foreign key (staff_id, org_id)
    references public.staff_profiles (id, org_id) on delete cascade
);

-- One ask per note per person: the lease, and what makes a second run a no-op.
create unique index if not exists mention_asks_one_per_person
  on public.mention_asks (org_id, sm8_note_uuid, staff_id);

-- The job card's strip: the asks on one job.
create index if not exists mention_asks_by_job
  on public.mention_asks (org_id, sm8_job_uuid);

-- A task back to the ask that made it.
create index if not exists mention_asks_by_task
  on public.mention_asks (org_id, task_id) where task_id is not null;

alter table public.mention_asks enable row level security;

comment on table public.mention_asks is
  'Tiff''s reading of a ServiceM8 note that @mentions a linked person, and the ONE task it made. Keyed per person, unlike job_note_actions (one per note per org). No note text. HeyTiff''s own: survives a disconnect.';
