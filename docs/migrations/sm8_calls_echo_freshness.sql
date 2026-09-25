-- Calls, echo and freshness: one call counter per ServiceM8 account, the
-- index that finds HeyTiff's own writes by uuid, when a walk began, a guard
-- that keeps the newer copy of a mirrored record, and the overnight trace.
--
-- ONE CALL COUNTER PER SERVICEM8 ACCOUNT (sm8_call_meter). Every request to
-- ServiceM8's REST API takes a turn first (src/lib/integrations/sm8-http.ts
-- → sm8-meter.ts → sm8_take_call). A token bucket per account: `burst`
-- tokens, refilled at `per_second`, a floor each lane must leave behind
-- (the sync leaves 10, a read 4, a write none) and a cap per UTC day. The
-- NUMBERS are the caller's (SM8_METER, tested there); this only carries
-- them out. A 429 from ServiceM8 starts a cooldown every caller respects
-- (sm8_note_throttle). The row is keyed by the ServiceM8 account's uuid,
-- or 'org:<workspace>' while a connection is nameless.
--
-- THE ECHO. A file HeyTiff sends comes back in the mirror as one of
-- ServiceM8's; HeyTiff finds its own by uuid (sm8-echo.ts), org first.
--
-- WHEN A WALK BEGAN (sm8_sync_state.walk_started_at). A finished walk's
-- cursor is floored a quarter of an hour before the walk began, in the
-- account's clock, so an edit made on a page already read — or in April's
-- repeated hour — is read by the next walk. Null on a walk paused before
-- this column: it finishes on the old rule.
--
-- KEEP THE NEWER ROW (sm8_keep_newer, on all 13 mirror tables). An update
-- whose edit_date is OLDER than the stored one is skipped: a later page of
-- a slow walk, or a re-read, can't put an old copy over a newer one. Equal
-- or null stamps go through. edit_date is ServiceM8's fixed-width naive
-- text, so collate "C" compares it as the time it is. The sync is the only
-- writer of these tables.
--
-- THE ONE EXCEPTION, APRIL'S REPEATED HOUR. A record edited in both passes
-- of the hour the clock goes back (2 to 3 am) carries a second-pass stamp
-- that reads as older than its first-pass one: the cursor's floor reads it
-- again, and this guard then keeps the first-pass copy until the record's
-- next edit. A stamp with no zone can't tell the two passes apart, and
-- letting an older stamp through would undo the guard all year for one
-- hour a year.
--
-- THE OVERNIGHT TRACE (sm8_sync_runs.last_cron_at). Written only by
-- Vercel's scheduled call, after it passed CRON_SECRET; the owner's
-- ServiceM8 screen says when it last came.
--
-- APPLY BEFORE THE DEPLOY. Additive and idempotent: safe to run twice, and
-- the code on main never reads any of it. The new code runs without it:
-- calls simply aren't counted (one log line per worker), the cursor keeps
-- the old rule, the overnight line is hidden, and there is no guard.
--
-- TEST IT FIRST: docs/migrations/sm8_calls_echo_freshness.test.sql applies
-- the counter (section 1) and the keep-newer function (section 4), exercises
-- all three functions inside one transaction — the guard on a temporary
-- table — and rolls it all back. Safe against production. Run it whole;
-- every check raises on failure, and a clean run ends in ROLLBACK with
-- nothing left behind.
--
-- CHECKS, AFTER:
--   select proname from pg_proc where proname in
--     ('sm8_take_call', 'sm8_note_throttle', 'sm8_mirror_keep_newer');   -- 3 rows
--   select count(*) from pg_trigger where tgname = 'sm8_keep_newer';      -- 13
--   select column_name from information_schema.columns
--     where (table_name, column_name) in
--       (('sm8_sync_state', 'walk_started_at'), ('sm8_sync_runs', 'last_cron_at'));  -- 2 rows
-- AND AFTER THE DEPLOY: sm8_call_meter gains a row at the next Home load,
-- and sm8_sync_runs.last_cron_at is set after the next 20:00 UTC hour — if
-- it isn't, CRON_SECRET isn't set in Vercel Production (DEPLOY.md).

-- ── 1. one call counter per ServiceM8 account ──
-- BEGIN METER (sm8_calls_echo_freshness.test.sql carries this block and the
-- KEEP NEWER one, and a jest test holds the copies equal)

create table if not exists public.sm8_call_meter (
  meter          text primary key,
  tokens         double precision not null default 0,
  refilled_at    timestamptz not null default now(),
  day_utc        date not null default ((now() at time zone 'utc')::date),
  day_calls      integer not null default 0,
  cooldown_until timestamptz,
  cooldown_kind  text check (cooldown_kind in ('minute', 'day')),
  last_429_at    timestamptz,
  updated_at     timestamptz not null default now()
);
alter table public.sm8_call_meter enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)

create or replace function public.sm8_take_call(
  p_meter text, p_n integer, p_burst double precision, p_per_second double precision,
  p_floor double precision, p_day_cap integer
)
returns table (ok boolean, wait_ms integer, why text)
language plpgsql volatile set search_path = public
as $$
declare
  v_now    timestamptz := clock_timestamp();
  v_today  date := (v_now at time zone 'utc')::date;
  v_row    public.sm8_call_meter%rowtype;
  v_tokens double precision;
  v_calls  integer;
begin
  if p_n < 1 or p_per_second <= 0 or p_floor < 0 or p_floor >= p_burst then
    raise exception 'sm8_take_call: bad arguments';
  end if;
  insert into public.sm8_call_meter (meter, tokens) values (p_meter, p_burst)
    on conflict (meter) do nothing;
  select * into v_row from public.sm8_call_meter where meter = p_meter for update;

  if v_row.cooldown_until is not null and v_row.cooldown_until > v_now then
    return query select false,
      ceil(extract(epoch from (v_row.cooldown_until - v_now)) * 1000)::integer,
      'cooldown_' || coalesce(v_row.cooldown_kind, 'minute');
    return;
  end if;

  v_calls  := case when v_row.day_utc = v_today then v_row.day_calls else 0 end;
  v_tokens := least(p_burst, greatest(0, v_row.tokens)
              + greatest(0, extract(epoch from (v_now - v_row.refilled_at))::double precision) * p_per_second);

  if v_calls + p_n > p_day_cap or v_tokens - p_n < p_floor then
    update public.sm8_call_meter
       set tokens = v_tokens, refilled_at = v_now, day_utc = v_today,
           day_calls = v_calls, updated_at = v_now
     where meter = p_meter;
    if v_calls + p_n > p_day_cap then
      return query select false,
        ceil(extract(epoch from (((v_today + 1)::timestamp at time zone 'utc') - v_now)) * 1000)::integer,
        'day'::text;
    else
      return query select false,
        ceil((p_n + p_floor - v_tokens) / p_per_second * 1000)::integer,
        'minute'::text;
    end if;
    return;
  end if;

  update public.sm8_call_meter
     set tokens = v_tokens - p_n, refilled_at = v_now, day_utc = v_today,
         day_calls = v_calls + p_n, updated_at = v_now
   where meter = p_meter;
  return query select true, 0, null::text;
end
$$;

create or replace function public.sm8_note_throttle(p_meter text, p_kind text, p_cooldown_ms integer)
returns void language sql volatile set search_path = public
as $$
  insert into public.sm8_call_meter as m
    (meter, tokens, refilled_at, cooldown_until, cooldown_kind, last_429_at, updated_at)
  values (p_meter, 0, clock_timestamp(),
          clock_timestamp() + make_interval(secs => p_cooldown_ms / 1000.0),
          case when p_kind = 'day' then 'day' else 'minute' end,
          clock_timestamp(), clock_timestamp())
  on conflict (meter) do update set
    tokens = 0,
    refilled_at = excluded.refilled_at,
    cooldown_until = greatest(coalesce(m.cooldown_until, excluded.cooldown_until), excluded.cooldown_until),
    -- a minute's 429 inside a day's cooldown doesn't relabel the longer wait
    cooldown_kind = case
      when m.cooldown_until is not null and m.cooldown_until > excluded.cooldown_until then m.cooldown_kind
      else excluded.cooldown_kind
    end,
    last_429_at = excluded.last_429_at,
    updated_at = excluded.updated_at;
$$;

revoke execute on function public.sm8_take_call(text, integer, double precision, double precision, double precision, integer) from public, anon, authenticated;
grant  execute on function public.sm8_take_call(text, integer, double precision, double precision, double precision, integer) to service_role;
revoke execute on function public.sm8_note_throttle(text, text, integer) from public, anon, authenticated;
grant  execute on function public.sm8_note_throttle(text, text, integer) to service_role;

-- END METER

-- ── 2. the echo: "which of these uuids are ours", org first ──
create index if not exists sm8_writes_org_remote_idx on public.sm8_writes (org_id, remote_uuid);

-- ── 3. when the walk in progress began ──
alter table public.sm8_sync_state add column if not exists walk_started_at timestamptz;

-- ── 4. keep the newer row: an older edit_date never replaces a newer one ──
-- (save in April's repeated hour: a record edited in both passes keeps its
-- first-pass copy until its next edit; see the header)
-- BEGIN KEEP NEWER (the test script carries this function too)
create or replace function public.sm8_mirror_keep_newer()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.edit_date is not null and new.edit_date is not null
     and new.edit_date collate "C" < old.edit_date collate "C" then
    return null;
  end if;
  return new;
end
$$;
-- END KEEP NEWER

do $$
declare t text;
begin
  foreach t in array array[
    'sm8_staff','sm8_categories','sm8_queues','sm8_companies','sm8_company_contacts',
    'sm8_jobs','sm8_job_contacts','sm8_job_activities','sm8_job_checklists',
    'sm8_attachments','sm8_job_notes','sm8_job_materials','sm8_job_payments'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists sm8_keep_newer on public.%I', t);
      execute format('create trigger sm8_keep_newer before update on public.%I '
                     || 'for each row execute function public.sm8_mirror_keep_newer()', t);
    end if;
  end loop;
end $$;

-- ── 5. the overnight trace, apart from last_trigger so a later kick can't overwrite it ──
alter table public.sm8_sync_runs add column if not exists last_cron_at timestamptz;
