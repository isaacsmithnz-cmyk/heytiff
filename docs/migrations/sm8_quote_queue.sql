-- Accepted quotes in the ServiceM8 queue (quotes to ServiceM8, Isaac,
-- 2026-10-05: "if a quote is accepted, then it can turn that into the work
-- order for service mate… copy the scope and line items to service mate").
--
-- One press on the job card's Quote section queues one row per ServiceM8
-- record, a seventh kind, `quote`: the job's invoice description and its
-- status to Work Order (update); each of the quote's lines added under our
-- uuid (create); each line that was on the job taken off (delete, a soft
-- delete). The same queue, the same claim, the same account check.
--
-- NO NEW COLUMNS. A quote row keeps which record and its fields in the
-- customer change's two columns, cust_object ('job' or 'jobmaterial') and
-- cust_fields, under the shape rule below.
--
-- WHEN TO APPLY: BEFORE THE DEPLOY, and after sm8_customer_queue.sql, which
-- is applied. Additive and idempotent. Old code runs on it unchanged: the
-- kind checks only widen, and the shape check is exactly the customer
-- file's rule for every existing kind, with a branch for a quote row.
--
-- AFTER THIS FILE, NEVER RE-RUN sm8_customer_queue.sql (or an earlier queue
-- file): it would narrow the kind check back and refuse every quote row.
--
-- NOTHING ABOUT QUOTES CHANGES IN PRODUCTION until SM8_WRITES names `quote`
-- and the owner switches Accepted quotes on. A live send also needs
-- ServiceM8 reconnected for manage_job_materials.
--
-- READ-ONLY, AFTER:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'sm8_writes_kind_check';  -- names 'quote'
--   select kind, op, status, count(*) from public.sm8_writes group by 1, 2, 3;   -- as before
--
-- ROLLING BACK THE CODE: DEPLOY.md's "Accepted quotes to ServiceM8".

begin;

-- ── the queue: a seventh kind ──
alter table public.sm8_writes drop constraint if exists sm8_writes_kind_check;
alter table public.sm8_writes
  add constraint sm8_writes_kind_check check (kind in ('attachment', 'note', 'booking', 'leave', 'job', 'customer', 'quote'));

-- ── one shape rule for every kind ──
-- The customer file's rule, word for word, and a branch for a quote row:
-- every row names its job; the job's own row is an update to that job;
-- a line added names no target (its uuid is the row's own); a line taken
-- off names its line. No quote row names a note, a flag, a press's verb, a
-- booking, leave or a new job.
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
    when kind = 'quote' then
      note_id is null and depends_on is null and flag_done is null and note_text is null
      and verb_id is null and booking_staff_uuid is null and booking_start is null
      and booking_end is null and booking_zone is null
      and job_status_from is null and job_status_to is null
      and leave_staff_uuid is null and leave_start is null and leave_end is null
      and job_company_uuid is null and job_company_new is null and job_parent_uuid is null
      and job_contact_uuid is null and job_category_uuid is null and job_draft is null
      and job_done is null and job_number is null
      and cust_object in ('job', 'jobmaterial')
      and jsonb_typeof(cust_fields) = 'object'
      and sm8_job_uuid is not null
      and case
        when op = 'update' then cust_object = 'job' and target_uuid = sm8_job_uuid
        when op = 'create' then cust_object = 'jobmaterial' and target_uuid is null
        when op = 'delete' then cust_object = 'jobmaterial' and target_uuid is not null and taken_back_at is null
        else false
      end
    else false
  end, false));

-- ── the owner's switch per kind: a seventh kind ──
alter table public.integration_connections
  drop constraint if exists integration_connections_write_kinds_check;
alter table public.integration_connections
  add constraint integration_connections_write_kinds_check
  check (write_kinds <@ array['attachment', 'note', 'booking', 'leave', 'job', 'customer', 'quote']::text[]);

create or replace function public.sm8_set_write_kind(p_org uuid, p_kind text, p_on boolean, p_at timestamptz)
returns text[] language sql volatile set search_path = public
as $$
  update public.integration_connections
     set write_kinds = case
           when p_on then (select array_agg(distinct k order by k) from unnest(write_kinds || array[p_kind]) as k)
           else array_remove(write_kinds, p_kind) end,
         updated_at = p_at
   where org_id = p_org and provider = 'servicem8' and p_kind in ('attachment', 'note', 'booking', 'leave', 'job', 'customer', 'quote')
  returning write_kinds;
$$;
revoke execute on function public.sm8_set_write_kind(uuid, text, boolean, timestamptz) from public, anon, authenticated;
grant  execute on function public.sm8_set_write_kind(uuid, text, boolean, timestamptz) to service_role;

commit;
