-- New jobs in the ServiceM8 queue (new jobs to ServiceM8).
--
-- The New job form queues ONE row of a fifth kind, `job`, and its sender
-- makes in order, each under a uuid HeyTiff chose when the row was queued:
-- a new client or a site under a builder (company.json), the job as a
-- Quote (job.json), and its contact (jobcontact.json). The same queue, the
-- same claim, the same account check. ServiceM8 may charge for jobs.
--
-- WHEN TO APPLY: BEFORE THE DEPLOY, and after sm8_leave_queue.sql, which is
-- applied. Additive and idempotent. Old code runs on it unchanged: the new
-- columns are nullable, the kind checks only widen, and the shape check is
-- exactly the leave file's rule for every existing kind with the new
-- columns null (every existing row's are).
--
-- AFTER THIS FILE, NEVER RE-RUN sm8_leave_queue.sql (or an earlier queue
-- file): it would narrow the kind check back and replace the shape check
-- and sm8_set_write_kind with forms that refuse every job row.
--
-- NOTHING ABOUT NEW JOBS CHANGES IN PRODUCTION until SM8_WRITES names `job`
-- and the owner switches New jobs on. Until then no job row is inserted.
--
-- READ-ONLY, BEFORE:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('sm8_writes_kind_check', 'sm8_writes_shape_check',
--                      'integration_connections_write_kinds_check');
--     -- kind in (... 'leave'); write_kinds <@ {attachment,note,booking,leave}
--   select kind, op, status, count(*) from public.sm8_writes group by 1, 2, 3;   -- note this
-- AFTER:
--   the same constraint query: kind lists 'job'; write_kinds allows 'job'
--   select kind, op, status, count(*) from public.sm8_writes group by 1, 2, 3;   -- as BEFORE
--   select count(*) from information_schema.columns where table_schema = 'public'
--    and table_name = 'sm8_writes' and column_name in ('job_company_uuid', 'job_company_new',
--    'job_parent_uuid', 'job_contact_uuid', 'job_category_uuid', 'job_draft', 'job_done', 'job_number');  -- 8
--   select position('''job''' in pg_get_functiondef(
--     'public.sm8_set_write_kind(uuid,text,boolean,timestamptz)'::regprocedure)) > 0;  -- true
--
-- ROLLING BACK THE CODE: DEPLOY.md's "New jobs to ServiceM8" rollback. Old
-- code never sends a job row: its kind list has no 'job'.

begin;

-- ── the queue: a fifth kind ──
alter table public.sm8_writes drop constraint if exists sm8_writes_kind_check;
alter table public.sm8_writes
  add constraint sm8_writes_kind_check check (kind in ('attachment', 'note', 'booking', 'leave', 'job'));

alter table public.sm8_writes
  -- the client or site the job goes under: an existing one's uuid, or ours
  add column if not exists job_company_uuid  text,
  -- null for an existing client; 'client' or 'site' when the job makes one
  add column if not exists job_company_new   text,
  -- the builder a new site goes under
  add column if not exists job_parent_uuid   text,
  -- our uuid for the job's contact; null when none was given
  add column if not exists job_contact_uuid  text,
  add column if not exists job_category_uuid text,
  -- the form's words: the client's name and address, the job's address and
  -- description, the contact's details
  add column if not exists job_draft         jsonb,
  -- the steps confirmed in ServiceM8, a subset of {company, job, contact}
  add column if not exists job_done          text[],
  -- ServiceM8's own number for the job, read back after it was made
  add column if not exists job_number        text;

-- ── one shape rule for every kind ──
-- The leave file's rule, word for word, with the new columns null in every
-- branch it had, and a branch for a new job: a create only, naming its
-- client or site (ours or theirs), with the form's words; a site names its
-- builder. No job row names a job (it makes one), a note, a flag, a press's
-- verb, a booking or leave.
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
      and job_company_uuid is null and job_company_new is null and job_parent_uuid is null
      and job_contact_uuid is null and job_category_uuid is null and job_draft is null
      and job_done is null and job_number is null
    when kind = 'note' then
      verb_id is null and booking_staff_uuid is null and booking_start is null
      and booking_end is null and booking_zone is null
      and job_status_from is null and job_status_to is null
      and leave_staff_uuid is null and leave_start is null and leave_end is null
      and job_company_uuid is null and job_company_new is null and job_parent_uuid is null
      and job_contact_uuid is null and job_category_uuid is null and job_draft is null
      and job_done is null and job_number is null
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
      and job_company_uuid is null and job_company_new is null and job_parent_uuid is null
      and job_contact_uuid is null and job_category_uuid is null and job_draft is null
      and job_done is null and job_number is null
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
      and job_company_uuid is null and job_company_new is null and job_parent_uuid is null
      and job_contact_uuid is null and job_category_uuid is null and job_draft is null
      and job_done is null and job_number is null
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
    when kind = 'job' then
      op = 'create' and sm8_job_uuid is null and note_id is null and depends_on is null
      and target_uuid is null and flag_done is null and note_text is null and verb_id is null
      and booking_staff_uuid is null and booking_start is null and booking_end is null
      and booking_zone is null and job_status_from is null and job_status_to is null
      and leave_staff_uuid is null and leave_start is null and leave_end is null
      and job_company_uuid is not null
      and (job_company_new is null or job_company_new in ('client', 'site'))
      and ((job_company_new = 'site') = (job_parent_uuid is not null))
      and jsonb_typeof(job_draft) = 'object' and job_draft ? 'address' and job_draft ? 'description'
      and (job_done is null or job_done <@ array['company', 'job', 'contact']::text[])
    else false
  end, false));

-- ── the owner's switch per kind: a fifth kind ──
alter table public.integration_connections
  drop constraint if exists integration_connections_write_kinds_check;
alter table public.integration_connections
  add constraint integration_connections_write_kinds_check
  check (write_kinds <@ array['attachment', 'note', 'booking', 'leave', 'job']::text[]);

create or replace function public.sm8_set_write_kind(p_org uuid, p_kind text, p_on boolean, p_at timestamptz)
returns text[] language sql volatile set search_path = public
as $$
  update public.integration_connections
     set write_kinds = case
           when p_on then (select array_agg(distinct k order by k) from unnest(write_kinds || array[p_kind]) as k)
           else array_remove(write_kinds, p_kind) end,
         updated_at = p_at
   where org_id = p_org and provider = 'servicem8' and p_kind in ('attachment', 'note', 'booking', 'leave', 'job')
  returning write_kinds;
$$;
revoke execute on function public.sm8_set_write_kind(uuid, text, boolean, timestamptz) from public, anon, authenticated;
grant  execute on function public.sm8_set_write_kind(uuid, text, boolean, timestamptz) to service_role;

commit;
