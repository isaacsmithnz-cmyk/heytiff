-- Bookings in the ServiceM8 queue (two-way phase 3, PR A).
--
-- WHEN TO APPLY: BEFORE THE DEPLOY OF PR A, and after phase 2's three files
-- (sm8_notes_queue.sql, sm8_notes_job_card.sql, task_done_sm8.sql), which
-- are applied. Additive and idempotent. Old code runs on it unchanged: every
-- new column is nullable, the kind checks only widen, and the shape check
-- is exactly phase 2's rule for file and note rows.
--
-- AFTER THIS FILE, NEVER RE-RUN sm8_notes_queue.sql. It would narrow the
-- kind check back to files and notes, re-add the note-only shape check
-- (which refuses every booking create), and replace sm8_set_write_kind with
-- its two-kind form. That file's header says the same (PR A).
--
-- AND AFTER sm8_leave_queue.sql, NEVER RE-RUN THIS ONE: it would narrow the
-- kind check back to three kinds, drop leave's branch from the shape check
-- (refusing every leave row), and replace sm8_set_write_kind with its
-- three-kind form.
--
-- NOTHING ABOUT BOOKINGS CHANGES IN PRODUCTION until SM8_WRITES names
-- `booking`. Until then no booking row is ever inserted.
--
-- READ-ONLY, BEFORE:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('sm8_writes_kind_check', 'sm8_writes_note_shape_check',
--                      'integration_connections_write_kinds_check');
--     -- kind in ('attachment','note'); the note shape CASE; write_kinds <@ {attachment,note}
--   select kind, op, status, count(*) from public.sm8_writes group by 1, 2, 3;   -- note this
--   select write_kinds, write_mode from public.integration_connections where provider = 'servicem8';
--   select position('''booking''' in pg_get_functiondef(
--     'public.sm8_set_write_kind(uuid,text,boolean,timestamptz)'::regprocedure)) > 0;  -- false
-- AFTER:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('sm8_writes_kind_check', 'sm8_writes_note_shape_check',
--                      'sm8_writes_shape_check', 'integration_connections_write_kinds_check');
--     -- kind lists 'booking'; sm8_writes_note_shape_check is gone;
--     -- sm8_writes_shape_check is present; write_kinds allows 'booking'
--   select kind, op, status, count(*) from public.sm8_writes group by 1, 2, 3;   -- as BEFORE
--   select count(*) from public.sm8_writes where kind = 'booking';              -- 0
--   select count(*) from information_schema.columns where table_schema = 'public'
--    and table_name = 'sm8_writes' and column_name in ('verb_id', 'booking_staff_uuid',
--    'booking_start', 'booking_end', 'booking_zone', 'job_status_from', 'job_status_to');  -- 7
--   select position('''booking''' in pg_get_functiondef(
--     'public.sm8_set_write_kind(uuid,text,boolean,timestamptz)'::regprocedure)) > 0;  -- true
--
-- ROLLING BACK THE CODE: DEPLOY.md's "Bookings to ServiceM8" rollback.
-- Old code never sends a booking row: its kind list has no 'booking'.

begin;

-- ── the queue: a third kind ──
alter table public.sm8_writes drop constraint if exists sm8_writes_kind_check;
alter table public.sm8_writes
  add constraint sm8_writes_kind_check check (kind in ('attachment', 'note', 'booking'));

alter table public.sm8_writes
  -- the press a row belongs to; a status row keeps the first press's for good
  add column if not exists verb_id            uuid,
  add column if not exists booking_staff_uuid text,
  -- the account's wall-clock time, 'YYYY-MM-DD HH:MM:00', never converted
  add column if not exists booking_start      text,
  add column if not exists booking_end        text,
  -- the zone the times were chosen in; a different zone at send cancels
  add column if not exists booking_zone       text,
  add column if not exists job_status_from    text,
  add column if not exists job_status_to      text;

-- ── one shape rule for every kind ──
-- Phase 2's rule reads "when op = 'create' then note_id is not null", which
-- a booking create would fail. It is replaced by one CASE per kind. The
-- attachment and note branches are phase 2's, word for word, plus the new
-- columns being null. A CHECK passes when its expression is NULL, so every
-- column a branch needs is named "is not null", and the whole CASE sits in
-- coalesce(…, false).
alter table public.sm8_writes drop constraint if exists sm8_writes_note_shape_check;
alter table public.sm8_writes drop constraint if exists sm8_writes_shape_check;
alter table public.sm8_writes add constraint sm8_writes_shape_check check (coalesce(
  case
    when kind = 'attachment' then
      op = 'create' and note_id is null and depends_on is null and target_uuid is null
      and flag_done is null and note_text is null and taken_back_at is null
      and verb_id is null and booking_staff_uuid is null and booking_start is null
      and booking_end is null and booking_zone is null
      and job_status_from is null and job_status_to is null
    when kind = 'note' then
      verb_id is null and booking_staff_uuid is null and booking_start is null
      and booking_end is null and booking_zone is null
      and job_status_from is null and job_status_to is null
      and case
        when op = 'create' then
          note_id is not null and depends_on is null and target_uuid is null and flag_done is null
          and requested_by is not null
        when op = 'update' then
          note_id is null and target_uuid is not null and flag_done is not null and depends_on is null
          and note_text is null and taken_back_at is null and requested_by is not null
        when op = 'delete' then
          note_id is not null and depends_on is not null and flag_done is null and note_text is null
          and taken_back_at is null and requested_by is not null
        else false
      end
    when kind = 'booking' then
      note_id is null and flag_done is null and note_text is null
      and sm8_job_uuid is not null and verb_id is not null
      and case
        when op = 'create' then
          target_uuid is null and job_status_from is null and job_status_to is null
          and booking_staff_uuid is not null and booking_zone is not null
          and booking_start is not null and booking_end is not null
          and booking_start ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:00$'
          and booking_end   ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:00$'
          and left(booking_start, 10) = left(booking_end, 10)
          and booking_start collate "C" < booking_end collate "C"
        when op = 'update' then
          target_uuid is not null and target_uuid = sm8_job_uuid and depends_on is null
          and job_status_from is not null and job_status_to is not null
          and job_status_from = 'Quote' and job_status_to = 'Work Order'
          and seen_edit_date is not null
          and booking_staff_uuid is null and booking_start is null and booking_end is null
          and booking_zone is null
        when op = 'delete' then
          taken_back_at is null and job_status_from is null and job_status_to is null
          and booking_zone is null
          -- an Undo names its create (which holds the booking); a Clear names the
          -- activity and keeps the booking as the person saw it
          and ((depends_on is not null
                and booking_staff_uuid is null and booking_start is null and booking_end is null)
               or (depends_on is null and target_uuid is not null
                and booking_staff_uuid is not null and booking_start is not null
                and booking_end is not null))
        else false
      end
    else false
  end, false));

-- the overlay's day read (the Schedule) and a verb's rows (half done, Undo)
create index if not exists sm8_writes_booking_start_idx
  on public.sm8_writes (org_id, booking_start) where kind = 'booking';
create index if not exists sm8_writes_verb_idx
  on public.sm8_writes (org_id, verb_id) where verb_id is not null;

-- ── the owner's switch per kind: a third kind ──
alter table public.integration_connections
  drop constraint if exists integration_connections_write_kinds_check;
alter table public.integration_connections
  add constraint integration_connections_write_kinds_check
  check (write_kinds <@ array['attachment', 'note', 'booking']::text[]);

create or replace function public.sm8_set_write_kind(p_org uuid, p_kind text, p_on boolean, p_at timestamptz)
returns text[] language sql volatile set search_path = public
as $$
  update public.integration_connections
     set write_kinds = case
           when p_on then (select array_agg(distinct k order by k) from unnest(write_kinds || array[p_kind]) as k)
           else array_remove(write_kinds, p_kind) end,
         updated_at = p_at
   where org_id = p_org and provider = 'servicem8' and p_kind in ('attachment', 'note', 'booking')
  returning write_kinds;
$$;
revoke execute on function public.sm8_set_write_kind(uuid, text, boolean, timestamptz) from public, anon, authenticated;
grant  execute on function public.sm8_set_write_kind(uuid, text, boolean, timestamptz) to service_role;

commit;
