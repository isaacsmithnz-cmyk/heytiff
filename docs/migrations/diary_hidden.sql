-- The conversations a person has hidden from their own diary on the new
-- Home (Isaac, 2026-09-26: "you should only be able to delete your own
-- entries or edit. with the option to hide/archive other peoples").
--
-- WHAT A ROW IS. One person putting one conversation out of their sight:
-- somebody's ServiceM8 job note that @mentioned them, and every message
-- either way after it, as the diary threads them (src/lib/dashboard/
-- diary-feed.ts, keyed `${jobUuid}:${askerUuid}`). Nothing in ServiceM8
-- changes, nobody else's diary changes, and the task the ask made (H18,
-- mention_asks) stays where it is.
--
-- IT COMES BACK WHEN THEY WRITE AGAIN. The diary's read (src/lib/dashboard/
-- diary-query.ts) leaves a hidden conversation out only while the asker's
-- newest message is no newer than hidden_at: an answer, or a new ask on
-- the same job, brings it back into the diary, where it sorts by that
-- message as ever. Hiding it again moves hidden_at on.
--
-- WHAT WRITES IT. src/app/actions/diary.ts: hideConversation upserts the
-- row (hidden_at = now), and its Undo, showConversation, deletes it. Only
-- ever the viewer's own rows.
--
-- NO NOTE TEXT IS STORED: the key names the job and the asker, and the
-- words stay in the mirror.
--
-- POSTURE: RLS on, no policies; enforcement app-layer, like every other
-- table here. The staff key is composite with org_id, so a row can never
-- name another workspace's person.
--
-- APPLY BEFORE MERGING the diary's edit, delete and hide (Home walk,
-- part 3). Additive and idempotent: one new table, nothing altered;
-- running it twice changes nothing. The code runs without it: the diary
-- reads no hidden rows and shows every conversation, and Hide says it
-- couldn't.
--
-- READ-ONLY CHECKS, BEFORE:
--   select to_regclass('public.diary_hidden');                     -- expect null
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.staff_profiles'::regclass and contype in ('p', 'u');
--     -- the staff key needs staff_profiles unique on (id, org_id)
-- AND AFTER:
--   select count(*) from public.diary_hidden;                       -- expect 0
--   select relrowsecurity from pg_class where oid = 'public.diary_hidden'::regclass;  -- t
--   select count(*) from pg_policies where tablename = 'diary_hidden';                -- 0
--
-- ROLLBACK: drop table if exists public.diary_hidden;
--           (every hidden conversation is back in its diary)

create table if not exists public.diary_hidden (
  org_id            uuid not null references public.organizations (id) on delete cascade,
  staff_id          uuid not null,
  conversation_key  text not null
                      constraint diary_hidden_key_check
                      check (char_length(conversation_key) between 3 and 200),
  hidden_at         timestamptz not null default now(),
  primary key (org_id, staff_id, conversation_key),
  constraint diary_hidden_staff_fkey foreign key (staff_id, org_id)
    references public.staff_profiles (id, org_id) on delete cascade
);

alter table public.diary_hidden enable row level security;

comment on table public.diary_hidden is
  'Conversations a person has hidden from their own diary on the new Home. One row per person per conversation (job:asker); it comes back when the asker writes after hidden_at. No note text.';
