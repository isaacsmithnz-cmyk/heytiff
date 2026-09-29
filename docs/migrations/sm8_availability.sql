-- Time off in ServiceM8, mirrored (leave to ServiceM8, part two).
--
-- ServiceM8's Availability records (availability.json, read_schedule — a
-- grant every connection already holds): a person's leave, and the days the
-- business is shut. The Workboard's Schedule tab lays them on the day, and
-- the Book in panel warns when a booking lands on one.
--
-- Read off the live account on 2026-09-28: availability_type is
-- 'staff-annual-leave' (regarding_object 'staff'), 'public-holiday' or
-- 'business-closed' (regarding_object 'vendor'). There is NO sick type: the
-- free-text `name` says what it is ("SICK", "TAFE", "CAR SERVICE"). This is
-- a diary of blocked-out time and NEVER a leave ledger — nothing reads it
-- back into HeyTiff as leave.
--
-- Inherits sm8_mirror.sql whole: a disposable cache, natural key
-- (org_id, uuid), every ServiceM8 field TEXT (the stamps are the account's
-- wall clock with a '0000-00-00' null sentinel), integer flags the one
-- exception, no CHECK on mirrored values, RLS on with no policies, wiped on
-- disconnect and on a change of account by SM8_WIPE_TABLES /
-- SM8_ACCOUNT_RESET_TABLES, which map over SM8_OBJECTS.
--
-- WHEN TO APPLY: BEFORE THE DEPLOY. Until the table exists, a sync that
-- reaches the new object can't store its page and says so on the ServiceM8
-- page. Additive and idempotent; old code never names the table.
--
-- READ-ONLY, BEFORE:
--   select to_regclass('public.sm8_availability');                    -- null
--   select count(*) from public.sm8_sync_state where object = 'availability';  -- 0
-- AFTER:
--   select to_regclass('public.sm8_availability');                    -- sm8_availability
--   select relrowsecurity from pg_class where relname = 'sm8_availability';    -- true
--   select count(*) from pg_policies where tablename = 'sm8_availability';     -- 0
--   select tgname from pg_trigger where tgrelid = 'public.sm8_availability'::regclass
--      and not tgisinternal;                                           -- sm8_keep_newer
--
-- ROLLING BACK THE CODE: nothing to do. Old code never reads the table; the
-- rows sit until the next disconnect, or `drop table public.sm8_availability`
-- and `delete from public.sm8_sync_state where object = 'availability'`.

create table if not exists public.sm8_availability (
  org_id                uuid not null references public.organizations(id) on delete cascade,
  uuid                  text not null,
  -- 'staff' | 'vendor'; verbatim.
  regarding_object      text,
  regarding_object_uuid text,
  -- what the business typed: "SICK", "Holidays", "Labour Day"
  name                  text,
  -- 'staff-annual-leave' | 'public-holiday' | 'business-closed'; verbatim.
  availability_type     text,
  start_timestamp       text,
  end_timestamp         text,
  source                text,
  active                integer,
  edit_date             text,
  synced_at             timestamptz not null default now(),
  primary key (org_id, uuid)
);

-- the day's read: everything that starts before the day ends, per workspace
create index if not exists sm8_availability_org_start_idx
  on public.sm8_availability (org_id, start_timestamp);

alter table public.sm8_availability enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)

-- keep the newer row, as every other mirror does (sm8_calls_echo_freshness.sql,
-- which is applied already and names this table in its list for next time)
do $$
begin
  if to_regprocedure('public.sm8_mirror_keep_newer()') is not null then
    drop trigger if exists sm8_keep_newer on public.sm8_availability;
    create trigger sm8_keep_newer before update on public.sm8_availability
      for each row execute function public.sm8_mirror_keep_newer();
  end if;
end $$;
