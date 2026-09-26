-- Notes in the ServiceM8 queue (two-way phase 2, PR A).
--
-- WHEN TO APPLY: BEFORE THE DEPLOY OF PR A — a hard rule. The code falls
-- back where it can (links without the confirm columns, state without
-- write_kinds, the queue read without the note columns), but a note row
-- can't exist without this file. Additive and idempotent: safe to run twice,
-- and old code runs on it unchanged (every new column has a default or is
-- nullable, the kind check only widens, and the trigger never meets a file
-- row).
-- Every workboard_notes column PR A's code reads is added HERE, including
-- the reply and Done columns PR B and PR C draw: each migration goes before
-- the deploy that reads it.
--
-- NOTHING ABOUT NOTES CHANGES IN PRODUCTION until SM8_WRITES names `note`
-- (Isaac's order: only after phase 1's live walk). Until then no note row is
-- ever inserted, and this file's columns sit empty.
--
-- READ-ONLY, BEFORE:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'sm8_writes_kind_check';
--     -- CHECK ((kind = 'attachment'::text))
--   select kind, status, count(*) from public.sm8_writes group by 1, 2;       -- attachment/sent 1
--   select count(*) from public.integration_links where provider = 'servicem8' and kind = 'staff';  -- 2
-- AFTER:
--   select write_kinds, count(*) from public.integration_connections where provider = 'servicem8' group by 1;  -- {attachment}
--   select op, count(*) from public.sm8_writes group by 1;                    -- create 1
--   select count(*) from public.sm8_writes where taken_back_at is not null;   -- 0
--   select count(*) from public.integration_links where confirmed_answer is not null;  -- 0
--   select count(*) from public.workboard_notes
--    where removed_at is not null or task_id is not null or reply_to_sm8_note_uuid is not null;  -- 0
--
-- ROLLING BACK THE CODE: follow DEPLOY.md's rollback (spec A.6): Notes Off,
-- then SM8_WRITES=1 and a redeploy, then its SQL, then revert. Old code
-- never sends a note row (its kind list drops 'note'). Its Retry can't
-- re-queue one either: the trigger below refuses ANY update of a note row
-- (the kind filter) that names requested_by or requested_by_user, at any
-- value, and old code's againPatch names both on every row it touches. New
-- code never names them on a note row. Old code's Remove can't delete a
-- note that any queue row names: the note_id key is NO ACTION, so the
-- database refuses, and main's removeJobNote ignores the error.

begin;

-- ── the queue: a second kind ──
alter table public.sm8_writes drop constraint if exists sm8_writes_kind_check;
alter table public.sm8_writes
  add constraint sm8_writes_kind_check check (kind in ('attachment', 'note'));

alter table public.sm8_writes
  add column if not exists op               text not null default 'create',
  add column if not exists note_id          uuid,
  add column if not exists depends_on       uuid,
  add column if not exists target_uuid      text,
  add column if not exists flag_done        boolean,
  add column if not exists seen_edit_date   text,
  add column if not exists seen_edit_by     text,
  add column if not exists landed_edit_date text,
  add column if not exists as_staff_uuid    text,
  add column if not exists note_text        text,
  add column if not exists text_cleared_at  timestamptz,
  -- set when whoever pressed a note takes it back: that create is never
  -- claimed again, and a sender holding it stops before its POST
  add column if not exists taken_back_at    timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sm8_writes_op_check') then
    alter table public.sm8_writes add constraint sm8_writes_op_check
      check (op in ('create', 'update', 'delete'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sm8_writes_note_shape_check') then
    alter table public.sm8_writes add constraint sm8_writes_note_shape_check check (
      case
        when kind = 'attachment' then
          op = 'create' and note_id is null and depends_on is null and target_uuid is null
          and flag_done is null and note_text is null and taken_back_at is null
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
      end);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sm8_writes_note_text_check') then
    alter table public.sm8_writes add constraint sm8_writes_note_text_check
      check (note_text is null or char_length(note_text) between 1 and 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sm8_writes_depends_on_fkey') then
    alter table public.sm8_writes add constraint sm8_writes_depends_on_fkey
      foreign key (depends_on) references public.sm8_writes (id) on delete cascade;
  end if;
  -- NO ACTION, not cascade and not set null: HeyTiff's row can't be deleted
  -- while any queue row names it, so nothing that may be in ServiceM8 loses
  -- its record, and a Remove racing a Send loses (23503) instead of pulling
  -- a create out from under its sender. NO ACTION (not RESTRICT) is checked
  -- at the end of the statement, so deleting a whole organization still
  -- cascades through both tables in one statement.
  if not exists (select 1 from pg_constraint where conname = 'sm8_writes_note_id_fkey') then
    alter table public.sm8_writes add constraint sm8_writes_note_id_fkey
      foreign key (note_id, org_id) references public.workboard_notes (id, org_id)
      on delete no action;
  end if;
end $$;

-- one create per note, whatever job a press names
create unique index if not exists sm8_writes_one_create_per_note
  on public.sm8_writes (org_id, note_id) where kind = 'note' and op = 'create';
create index if not exists sm8_writes_note_idx
  on public.sm8_writes (org_id, note_id) where note_id is not null;
create index if not exists sm8_writes_depends_idx
  on public.sm8_writes (depends_on) where depends_on is not null;
create index if not exists sm8_writes_target_idx
  on public.sm8_writes (org_id, target_uuid) where target_uuid is not null;
create index if not exists sm8_writes_note_text_idx
  on public.sm8_writes (org_id, updated_at) where kind = 'note' and note_text is not null;

-- A note goes as the person who pressed it, and never becomes anyone else's.
-- A column-list trigger fires whenever a listed column is a SET target, even
-- at the same value; PostgREST sets exactly the keys of the body it is sent.
-- So this refuses old code's againPatch (Retry, re-press) on every note row,
-- including one whose presser pressed Retry, and never meets new code. The
-- kind filter leaves every file row exactly as today.
create or replace function public.sm8_writes_note_sender_fixed()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.kind = 'note' then
    raise exception 'a note row never changes who pressed it' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists sm8_writes_note_sender_fixed on public.sm8_writes;
create trigger sm8_writes_note_sender_fixed
  before update of requested_by, requested_by_user on public.sm8_writes
  for each row execute function public.sm8_writes_note_sender_fixed();

-- ── HeyTiff's own row: the tombstone, why a press didn't queue, what it
--    answers, and the Done mark ──
alter table public.workboard_notes
  add column if not exists removed_at             timestamptz,
  add column if not exists sm8_refusal            text,
  -- the ServiceM8 note a reply or a Done answers (PR B draws it)
  add column if not exists reply_to_sm8_note_uuid text,
  -- the task a Done, or a reply that closed it, stands for (PR C draws it)
  add column if not exists task_id                uuid,
  -- a Done: set only by a tick, so Reopen never takes a reply back
  add column if not exists is_task_done           boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workboard_notes_sm8_refusal_check') then
    alter table public.workboard_notes add constraint workboard_notes_sm8_refusal_check
      check (sm8_refusal is null or sm8_refusal in
        ('unlinked', 'no_card', 'confirm', 'denied', 'inactive', 'unknown', 'bad_link',
         'job_gone', 'capped', 'unqueued', 'unreadable'));
  end if;
  -- a Done stays a Done after its task is deleted: task_id goes null, the mark stays
  if not exists (select 1 from pg_constraint where conname = 'workboard_notes_task_fkey') then
    alter table public.workboard_notes add constraint workboard_notes_task_fkey
      foreign key (task_id) references public.tasks (id) on delete set null;
  end if;
end $$;

-- ── the owner's switch per kind ──
alter table public.integration_connections
  add column if not exists write_kinds text[] not null default '{attachment}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'integration_connections_write_kinds_check') then
    alter table public.integration_connections add constraint integration_connections_write_kinds_check
      check (write_kinds <@ array['attachment', 'note']::text[]);
  end if;
end $$;

-- ── each person's answer to "Is <ServiceM8 name> you?" ──
-- Confirmed ⇔ confirmed_answer = 'yes' and confirmed_remote_id = remote_id.
-- 'no' is a denial. A relink writes all four back to null.
alter table public.integration_links
  add column if not exists confirmed_remote_id  text,
  add column if not exists confirmed_answer     text,
  add column if not exists confirmed_at         timestamptz,
  add column if not exists confirmed_by_user_id text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'integration_links_confirmed_check') then
    alter table public.integration_links add constraint integration_links_confirmed_check check (
      (confirmed_answer is null and confirmed_remote_id is null and confirmed_at is null)
      or (confirmed_answer in ('yes', 'no') and confirmed_remote_id is not null and confirmed_at is not null));
  end if;
end $$;

-- ── two refusals, or two switches, can't race ──
create or replace function public.sm8_mark_kind_refused(p_org uuid, p_kind text, p_at text)
returns boolean language sql volatile set search_path = public
as $$
  with done as (
    update public.integration_connections
       set write_scope_refused = coalesce(write_scope_refused, '{}'::jsonb) || jsonb_build_object(p_kind, p_at)
     where org_id = p_org and provider = 'servicem8'
     returning 1)
  select exists (select 1 from done);
$$;

create or replace function public.sm8_set_write_kind(p_org uuid, p_kind text, p_on boolean, p_at timestamptz)
returns text[] language sql volatile set search_path = public
as $$
  update public.integration_connections
     set write_kinds = case
           when p_on then (select array_agg(distinct k order by k) from unnest(write_kinds || array[p_kind]) as k)
           else array_remove(write_kinds, p_kind) end,
         updated_at = p_at
   where org_id = p_org and provider = 'servicem8' and p_kind in ('attachment', 'note')
  returning write_kinds;
$$;

revoke execute on function public.sm8_mark_kind_refused(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.sm8_mark_kind_refused(uuid, text, text) to service_role;
revoke execute on function public.sm8_set_write_kind(uuid, text, boolean, timestamptz) from public, anon, authenticated;
grant  execute on function public.sm8_set_write_kind(uuid, text, boolean, timestamptz) to service_role;

commit;
