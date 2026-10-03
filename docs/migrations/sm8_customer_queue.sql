-- Customer changes in the ServiceM8 queue (customer details to ServiceM8).
--
-- The job card's customer dialog saves as one row per record changed, a
-- sixth kind, `customer`: a job contact added (under our uuid), changed or
-- removed; the client's name and address changed; the job's billing address
-- changed. The same queue, the same claim, the same account check.
--
-- WHEN TO APPLY: BEFORE THE DEPLOY, and after sm8_new_job_queue.sql, which
-- is applied. Additive and idempotent. Old code runs on it unchanged: the
-- two new columns are nullable, the kind checks only widen, and the shape
-- check is exactly the new-job file's rule for every existing kind with the
-- new columns null (every existing row's are).
--
-- AFTER THIS FILE, NEVER RE-RUN sm8_new_job_queue.sql (or an earlier queue
-- file): it would narrow the kind check back and refuse every customer row.
--
-- NOTHING ABOUT CUSTOMERS CHANGES IN PRODUCTION until SM8_WRITES names
-- `customer` and the owner switches Customer details on.
--
-- READ-ONLY, AFTER:
--   select count(*) from information_schema.columns where table_schema = 'public'
--    and table_name = 'sm8_writes' and column_name in ('cust_object', 'cust_fields');  -- 2
--   select kind, op, status, count(*) from public.sm8_writes group by 1, 2, 3;   -- as before
--
-- ROLLING BACK THE CODE: DEPLOY.md's "Customer details to ServiceM8".

begin;

-- ── the queue: a sixth kind ──
alter table public.sm8_writes drop constraint if exists sm8_writes_kind_check;
alter table public.sm8_writes
  add constraint sm8_writes_kind_check check (kind in ('attachment', 'note', 'booking', 'leave', 'job', 'customer'));

alter table public.sm8_writes
  -- which record a customer change is to: 'jobcontact', 'company' or 'job'
  add column if not exists cust_object text,
  -- only the fields that changed, by ServiceM8's own names
  add column if not exists cust_fields jsonb;

-- ── one shape rule for every kind ──
-- The new-job file's rule, word for word, with the new columns null in
-- every branch it had, and a branch for a customer change: which record and
-- the fields that changed; a contact added names its job; a change or a
-- removal names its record (target_uuid). No customer row names a note, a
-- flag, a press's verb, a booking, leave or a new job.
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
      and cust_object is null and cust_fields is null
    when kind = 'note' then
      verb_id is null and booking_staff_uuid is null and booking_start is null
      and booking_end is null and booking_zone is null
      and job_status_from is null and job_status_to is null
      and leave_staff_uuid is null and leave_start is null and leave_end is null
      and job_company_uuid is null and job_company_new is null and job_parent_uuid is null
      and job_contact_uuid is null and job_category_uuid is null and job_draft is null
      and job_done is null and job_number is null
      and cust_object is null and cust_fields is null
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
      and cust_object is null and cust_fields is null
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
      and cust_object is null and cust_fields is null
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
      and cust_object is null and cust_fields is null
    when kind = 'customer' then
      note_id is null and depends_on is null and flag_done is null and note_text is null
      and verb_id is null and booking_staff_uuid is null and booking_start is null
      and booking_end is null and booking_zone is null
      and job_status_from is null and job_status_to is null
      and leave_staff_uuid is null and leave_start is null and leave_end is null
      and job_company_uuid is null and job_company_new is null and job_parent_uuid is null
      and job_contact_uuid is null and job_category_uuid is null and job_draft is null
      and job_done is null and job_number is null
      and cust_object in ('jobcontact', 'company', 'job')
      and jsonb_typeof(cust_fields) = 'object'
      and case
        when op = 'create' then cust_object = 'jobcontact' and sm8_job_uuid is not null and target_uuid is null
        when op = 'update' then target_uuid is not null
        when op = 'delete' then cust_object = 'jobcontact' and target_uuid is not null and taken_back_at is null
        else false
      end
    else false
  end, false));

-- ── the owner's switch per kind: a sixth kind ──
alter table public.integration_connections
  drop constraint if exists integration_connections_write_kinds_check;
alter table public.integration_connections
  add constraint integration_connections_write_kinds_check
  check (write_kinds <@ array['attachment', 'note', 'booking', 'leave', 'job', 'customer']::text[]);

create or replace function public.sm8_set_write_kind(p_org uuid, p_kind text, p_on boolean, p_at timestamptz)
returns text[] language sql volatile set search_path = public
as $$
  update public.integration_connections
     set write_kinds = case
           when p_on then (select array_agg(distinct k order by k) from unnest(write_kinds || array[p_kind]) as k)
           else array_remove(write_kinds, p_kind) end,
         updated_at = p_at
   where org_id = p_org and provider = 'servicem8' and p_kind in ('attachment', 'note', 'booking', 'leave', 'job', 'customer')
  returning write_kinds;
$$;
revoke execute on function public.sm8_set_write_kind(uuid, text, boolean, timestamptz) from public, anon, authenticated;
grant  execute on function public.sm8_set_write_kind(uuid, text, boolean, timestamptz) to service_role;

commit;
