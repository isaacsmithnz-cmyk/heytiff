-- The Tiff modal's record of a filed note, merged in the database rather than
-- written back from a copy.
--
-- WHY. Two of the modal's actions write `workboard_notes.applied`:
--   fileNote       the v2 record of everything a note filed, which Undo reads
--   publishNoteKb  a library entry, added to the record so Undo takes it back
-- Each read the column, waited on slow work (the rows being written, the entry
-- being embedded), then wrote the whole column back from its own copy. A
-- Library press that landed while the note was filing wrote its stale copy
-- over the finished record: the tasks stayed filed, the diary lost its chips
-- and Undo said the note was filed before Undo existed. The other way round,
-- the entry dropped out of the record and Undo left it in the Library.
--
-- Here each of those writes is ONE statement that merges into the row as it
-- stands when the write lands. Two updates of one row wait for each other and
-- the second is worked out from the first's result, so neither can lose the
-- other's keys.
--
--   workboard_note_file_record  lays what a note filed over whatever the
--                               Library press already put there; only on a
--                               note fileNote has claimed ('applied')
--   workboard_note_add_kb       appends one entry id and title; not on a note
--                               set aside or taken back, and never the same
--                               title twice, so two presses add one entry
--
-- POSTURE. SECURITY INVOKER (the default) and the org is a parameter, never
-- inferred: the service role is the only caller and the actions check the
-- session first, as every other read and write here does. EXECUTE is revoked
-- from the public keys, the same as create_org_for_owner.
--
-- APPLY THIS BEFORE MERGING THE PR (H6, the Tiff server), with or after
-- tiff_modal_turns.sql: the modal's fileNote and publishNoteKb call these from
-- then on. Additive and idempotent: two new functions, `create or replace`,
-- which touch no row until the modal calls them. The review card's capture
-- never calls either.
--
-- READ-ONLY CHECKS, BEFORE (expect no rows):
--   select proname from pg_proc
--     where pronamespace = 'public'::regnamespace
--       and proname in ('workboard_note_file_record', 'workboard_note_add_kb');
-- AFTER: the same query returns both, and this returns false for each:
--   select has_function_privilege('anon',
--     'public.workboard_note_file_record(uuid, uuid, jsonb)', 'execute');
--   select has_function_privilege('anon',
--     'public.workboard_note_add_kb(uuid, uuid, text, text)', 'execute');

create or replace function public.workboard_note_file_record(
  p_org uuid,
  p_note uuid,
  p_applied jsonb
) returns boolean
language sql
volatile
set search_path = public, pg_temp
as $$
  with filed as (
    update public.workboard_notes
       set applied =
             (case when jsonb_typeof(applied) = 'object' then applied else '{}'::jsonb end)
             || p_applied
     where org_id = p_org
       and id = p_note
       and status = 'applied'
       and jsonb_typeof(p_applied) = 'object'
    returning 1
  )
  select exists (select 1 from filed);
$$;

create or replace function public.workboard_note_add_kb(
  p_org uuid,
  p_note uuid,
  p_kb_id text,
  p_title text
) returns boolean
language sql
volatile
set search_path = public, pg_temp
as $$
  with added as (
    update public.workboard_notes
       set applied =
             (case when jsonb_typeof(applied) = 'object' then applied else '{}'::jsonb end)
             || jsonb_build_object(
                  'kbIds',
                  (case when jsonb_typeof(applied -> 'kbIds') = 'array'
                        then applied -> 'kbIds' else '[]'::jsonb end)
                  || to_jsonb(p_kb_id),
                  'kbTitles',
                  (case when jsonb_typeof(applied -> 'kbTitles') = 'array'
                        then applied -> 'kbTitles' else '[]'::jsonb end)
                  || to_jsonb(p_title)
                )
     where org_id = p_org
       and id = p_note
       and status in ('pending', 'clarifying', 'applied')
       and not coalesce((applied -> 'kbTitles') ? p_title, false)
    returning 1
  )
  select exists (select 1 from added);
$$;

revoke execute on function public.workboard_note_file_record(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.workboard_note_file_record(uuid, uuid, jsonb) to service_role;

revoke execute on function public.workboard_note_add_kb(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.workboard_note_add_kb(uuid, uuid, text, text) to service_role;
