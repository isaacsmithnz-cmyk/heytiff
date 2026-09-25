-- The Tiff modal: a note is a conversation, and a filed note can be taken back.
--
-- WHAT CHANGED. The review card showed a proposal and filed only what a person
-- confirmed. The Tiff modal (the new Home, behind HOME_DESK) talks instead:
-- you say it, Tiff answers with what she will file and asks what she cannot
-- work out, you reply, and she files the moment nothing is left to ask (Isaac,
-- 2026-09-25: filing live, with Undo as the safety net). Two things the table
-- could not hold:
--
--   turns      the conversation, in order: [{who: you|tiff, text, at, room?}].
--              Tiff's last turn is the line the diary shows under the words.
--              Written only by the modal's actions (routeNote with
--              `conversation`, continueNote, fileNote, undoNote, keepWords);
--              the review card's door never names it.
--   undone_at  when Undo took back what the note filed. Undo sets status
--              'undone' with it; the words stay, and `applied` keeps the
--              record of what existed.
--
-- The status check gains 'undone'. `workboard_notes_status_check` is the name
-- Postgres gave the inline check in workboard_notes.sql, which is why it is
-- dropped by that name here.
--
-- POSTURE unchanged: RLS on, no policies; enforcement app-layer in
-- src/app/actions/workboard-notes.ts.
--
-- APPLY THIS BEFORE MERGING THE PR (H6, the Tiff server). Additive and
-- idempotent: two new columns with defaults, a widened status check and two
-- new checks, each dropped by name before it is added, so running it twice
-- changes nothing. The review card's capture names neither column, so the
-- crew's capture works with or without it; the modal's actions need it.
--
-- READ-ONLY CHECKS, BEFORE. The status check below fails to add if any row
-- holds a status it does not list, so the lead runs the first one and expects
-- only pending, clarifying, applied and dismissed:
--   select status, count(*) from public.workboard_notes group by 1;
--   -- the inline check's name, and that no check of these names exists yet:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.workboard_notes'::regclass and contype = 'c';
--   -- expect workboard_notes_status_check among them, and neither of
--   -- workboard_notes_turns_array / workboard_notes_undone_consistent
--   select column_name from information_schema.columns
--     where table_schema = 'public' and table_name = 'workboard_notes'
--       and column_name in ('turns', 'undone_at');            -- expect none
--
-- READ-ONLY CHECKS, AFTER:
--   select count(*) from public.workboard_notes where turns <> '[]'::jsonb;   -- expect 0
--   select count(*) from public.workboard_notes where undone_at is not null;  -- expect 0

alter table public.workboard_notes
  add column if not exists turns jsonb not null default '[]'::jsonb,
  add column if not exists undone_at timestamptz;

-- The server writes at most 16 turns (six replies, Done and Undo);
-- 40 is lib/workboard/note-turns.ts's TURNS_MAX, a test holds the two equal.
alter table public.workboard_notes drop constraint if exists workboard_notes_turns_array;
alter table public.workboard_notes add constraint workboard_notes_turns_array
  check (jsonb_typeof(turns) = 'array' and jsonb_array_length(turns) <= 40);

alter table public.workboard_notes drop constraint if exists workboard_notes_status_check;
alter table public.workboard_notes add constraint workboard_notes_status_check
  check (status in ('pending', 'clarifying', 'applied', 'dismissed', 'undone'));

alter table public.workboard_notes drop constraint if exists workboard_notes_undone_consistent;
alter table public.workboard_notes add constraint workboard_notes_undone_consistent
  check ((status = 'undone') = (undone_at is not null));

comment on column public.workboard_notes.turns is
  'The conversation in the Tiff modal: [{who: you|tiff, text, at, room?}]. Tiff''s last turn is the diary entry''s line. Written only by the modal''s actions.';
comment on column public.workboard_notes.undone_at is
  'When Undo took back what this note filed. The words stay; applied keeps the record of what existed.';
