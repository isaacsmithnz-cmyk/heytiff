-- Leave in the ServiceM8 queue (leave to ServiceM8).
--
-- Approved leave, and a casual's day off, go onto the person's day on
-- ServiceM8's dispatch board as ServiceM8's own staff leave
-- (availability.json), and come off again when the leave is cancelled or
-- the day off taken down. A fourth kind, `leave`, beside files, notes and
-- bookings: the same queue, the same claim, the same account check.
--
-- WHEN TO APPLY: BEFORE THE DEPLOY, and after sm8_bookings_queue.sql, which
-- is applied. Additive and idempotent. Old code runs on it unchanged: the
-- three new columns are nullable, the kind checks only widen, and the shape
-- check is exactly the bookings file's rule for file, note and booking rows
-- with the new columns null (every existing row's are).
--
-- AFTER THIS FILE, NEVER RE-RUN sm8_bookings_queue.sql (or
-- sm8_notes_queue.sql): it would narrow the kind check back and replace the
-- shape check and sm8_set_write_kind with forms that refuse every leave row.
--
-- NOTHING ABOUT LEAVE CHANGES IN PRODUCTION until SM8_WRITES names `leave`
-- and the owner switches Leave on. Until then no leave row is ever inserted.
--
-- READ-ONLY, BEFORE:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('sm8_writes_kind_check', 'sm8_writes_shape_check',
--                      'integration_connections_write_kinds_check');
--     -- kind in ('attachment','note','booking'); write_kinds <@ {attachment,note,booking}
--   select kind, op, status, count(*) from public.sm8_writes group by 1, 2, 3;   -- note this
--   select position('''leave''' in pg_get_functiondef(
--     'public.sm8_set_write_kind(uuid,text,boolean,timestamptz)'::regprocedure)) > 0;  -- false
-- AFTER:
--   the same constraint query: kind lists 'leave'; write_kinds allows 'leave'
--   select kind, op, status, count(*) from public.sm8_writes group by 1, 2, 3;   -- as BEFORE
--   select count(*) from information_schema.columns where table_schema = 'public'
--    and table_name = 'sm8_writes' and column_name in ('leave_staff_uuid', 'leave_start', 'leave_end');  -- 3
--   select position('''leave''' in pg_get_functiondef(
--     'public.sm8_set_write_kind(uuid,text,boolean,timestamptz)'::regprocedure)) > 0;  -- true
--
-- ROLLING BACK THE CODE: DEPLOY.md's "Leave to ServiceM8" rollback. Old code
-- never sends a leave row: its kind list has no 'leave'.

begin;

-- ── the queue: a fourth kind ──
alter table public.sm8_writes drop constraint if exists sm8_writes_kind_check;
alter table public.sm8_writes
  add constraint sm8_writes_kind_check check (kind in ('attachment', 'note', 'booking', 'leave'));

alter table public.sm8_writes
  -- the person's ServiceM8 staff uuid (a create)
  add column if not exists leave_staff_uuid text,
  -- the first day's start and the last day's end, the account's wall
  -- clock, 'YYYY-MM-DD 00:00:00' and 'YYYY-MM-DD 23:59:59', never converted
  add column if not exists leave_start      text,
  add column if not exists leave_end        text;

-- ── one shape rule for every kind ──
-- The bookings file's rule, word for word, with the new columns null in
-- every branch it had, and a branch for leave: a create carries the person
-- and the whole-day span; a delete names only its create (depends_on). No
-- leave row names a job, a note, a flag, a press's verb or a booking.
alter table public.sm8_writes drop constraint if exists sm8_writes_shape_check;
alter table public.sm8_writes add constraint sm8_writes_shape_check check (coalesce(
  case
    when kind = 'attachment' then
      op = 'create' and note_id is null and depends_on is null and target_uuid is null
      and flag_done is null and note_text is null and taken_back_at is null
      and verb_id is null and booking_staff_uuid is null and booking_start is null
      and booking_end is null and booking_zone is null
      and job_status_from is null and job_status_to is null
      and leave_staff_uuid is null and leave_start is null and leave_end is null
    when kind = 'note' then
      verb_id is null and booking_staff_uuid is null and booking_start is null
      and booking_end is null and booking_zone is null
      and job_status_from is null and job_status_to is null
      and leave_staff_uuid is null and leave_start is null and leave_end is null
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
      and leave_staff_uuid is null and leave_start is null and leave_end is null
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
          and ((depends_on is not null
                and booking_staff_uuid is null and booking_start is null and booking_end is null)
               or (depends_on is null and target_uuid is not null
                and booking_staff_uuid is not null and booking_start is not null
                and booking_end is not null))
        else false
      end
    when kind = 'leave' then
      sm8_job_uuid is null and note_id is null and flag_done is null and note_text is null
      and target_uuid is null and verb_id is null
      and booking_staff_uuid is null and booking_start is null and booking_end is null
      and booking_zone is null and job_status_from is null and job_status_to is null
      and case
        when op = 'create' then
          depends_on is null
          and leave_staff_uuid is not null and leave_start is not null and leave_end is not null
          and leave_start ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} 00:00:00$'
          and leave_end   ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} 23:59:59$'
          and leave_start collate "C" < leave_end collate "C"
        when op = 'delete' then
          depends_on is not null and taken_back_at is null
          and leave_staff_uuid is null and leave_start is null and leave_end is null
        else false
      end
    else false
  end, false));

-- ── the owner's switch per kind: a fourth kind ──
alter table public.integration_connections
  drop constraint if exists integration_connections_write_kinds_check;
alter table public.integration_connections
  add constraint integration_connections_write_kinds_check
  check (write_kinds <@ array['attachment', 'note', 'booking', 'leave']::text[]);

create or replace function public.sm8_set_write_kind(p_org uuid, p_kind text, p_on boolean, p_at timestamptz)
returns text[] language sql volatile set search_path = public
as $$
  update public.integration_connections
     set write_kinds = case
           when p_on then (select array_agg(distinct k order by k) from unnest(write_kinds || array[p_kind]) as k)
           else array_remove(write_kinds, p_kind) end,
         updated_at = p_at
   where org_id = p_org and provider = 'servicem8' and p_kind in ('attachment', 'note', 'booking', 'leave')
  returning write_kinds;
$$;
revoke execute on function public.sm8_set_write_kind(uuid, text, boolean, timestamptz) from public, anon, authenticated;
grant  execute on function public.sm8_set_write_kind(uuid, text, boolean, timestamptz) to service_role;

commit;
