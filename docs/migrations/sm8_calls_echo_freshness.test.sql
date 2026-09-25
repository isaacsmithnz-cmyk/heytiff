-- A rolled-back test of sm8_calls_echo_freshness.sql's two functions that
-- sit on every ServiceM8 call (the call counter) and every mirror write (the
-- keep-newer guard). SAFE TO RUN AGAINST PRODUCTION: everything below is one
-- transaction that ends in ROLLBACK, the counter's rows are keyed
-- 'rollback-test:*' so they can't meet a real account's, and the guard is
-- exercised on a temporary table, never a mirror.
--
-- Run it whole. Each check RAISEs an exception on failure, which aborts the
-- transaction (the ROLLBACK then only ends it); a clean run prints one
-- NOTICE per check and leaves nothing behind.
--
-- The two blocks between the BEGIN and END markers are copies of the
-- migration's, and src/lib/integrations/__tests__/sm8-calls-migration.test.ts
-- fails if they drift apart.

begin;

-- BEGIN METER

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

-- BEGIN KEEP NEWER
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

-- The caller's numbers (SM8_METER in src/lib/integrations/sm8-meter.ts):
-- burst 20, 2 a second, floors write 0 / read 4 / sync 10, day caps
-- write 18,000 / read 16,000 / sync 12,000.

do $$
declare r record; n integer;
begin
  -- a new account starts full, and a turn takes one token
  select * into r from public.sm8_take_call('rollback-test:a', 1, 20, 2, 0, 18000);
  if r.ok is distinct from true or r.wait_ms <> 0 or r.why is not null then
    raise exception 'fresh meter: expected ok, got %', row_to_json(r);
  end if;
  select count(*) into n from public.sm8_take_call('rollback-test:a', 1, 20, 2, 0, 18000);
  if n <> 1 then raise exception 'RETURNS TABLE should give exactly one row, gave %', n; end if;
  if (select day_calls from public.sm8_call_meter where meter = 'rollback-test:a') <> 2 then
    raise exception 'day_calls should count both turns';
  end if;
  if (select tokens from public.sm8_call_meter where meter = 'rollback-test:a') not between 17.9 and 18.1 then
    raise exception 'two turns should leave 18 tokens, left %', (select tokens from public.sm8_call_meter where meter = 'rollback-test:a');
  end if;
  raise notice 'ok: a fresh meter lets a turn through and counts it';
end $$;

do $$
declare r record; before double precision;
begin
  -- ten tokens left: the sync (floor 10) is refused, a read (floor 4) is not
  update public.sm8_call_meter set tokens = 10, refilled_at = clock_timestamp() where meter = 'rollback-test:a';
  select * into r from public.sm8_take_call('rollback-test:a', 1, 20, 2, 10, 12000);
  if r.ok or r.why <> 'minute' or r.wait_ms not between 1 and 500 then
    raise exception 'sync at its floor: expected a short minute wait, got %', row_to_json(r);
  end if;
  select tokens into before from public.sm8_call_meter where meter = 'rollback-test:a';
  if before not between 9.99 and 10.1 then raise exception 'a refused turn spent tokens: %', before; end if;
  select * into r from public.sm8_take_call('rollback-test:a', 1, 20, 2, 4, 16000);
  if r.ok is distinct from true then raise exception 'read above its floor: expected ok, got %', row_to_json(r); end if;
  -- and a write (floor 0) takes the last token the others must leave
  update public.sm8_call_meter set tokens = 1, refilled_at = clock_timestamp() where meter = 'rollback-test:a';
  select * into r from public.sm8_take_call('rollback-test:a', 1, 20, 2, 0, 18000);
  if r.ok is distinct from true then raise exception 'write with one token: expected ok, got %', row_to_json(r); end if;
  select * into r from public.sm8_take_call('rollback-test:a', 1, 20, 2, 4, 16000);
  if r.ok or r.why <> 'minute' or r.wait_ms not between 2000 and 2600 then
    raise exception 'read on an empty bucket: expected about 2.5 s, got %', row_to_json(r);
  end if;
  raise notice 'ok: floors put writes first, then reads, then the sync';
end $$;

do $$
declare r record;
begin
  -- five seconds of refill is ten tokens; an hour of it is capped at the burst
  update public.sm8_call_meter set tokens = 0, refilled_at = clock_timestamp() - interval '5 seconds'
   where meter = 'rollback-test:a';
  select * into r from public.sm8_take_call('rollback-test:a', 1, 20, 2, 0, 18000);
  if r.ok is distinct from true then raise exception 'refill: expected ok, got %', row_to_json(r); end if;
  if (select tokens from public.sm8_call_meter where meter = 'rollback-test:a') not between 8.9 and 9.2 then
    raise exception 'refill: five seconds less one turn should leave 9, left %', (select tokens from public.sm8_call_meter where meter = 'rollback-test:a');
  end if;
  update public.sm8_call_meter set tokens = 0, refilled_at = clock_timestamp() - interval '1 hour'
   where meter = 'rollback-test:a';
  select * into r from public.sm8_take_call('rollback-test:a', 1, 20, 2, 0, 18000);
  if (select tokens from public.sm8_call_meter where meter = 'rollback-test:a') not between 18.9 and 19.01 then
    raise exception 'refill past the burst: expected 19 left, got %', (select tokens from public.sm8_call_meter where meter = 'rollback-test:a');
  end if;
  raise notice 'ok: the bucket refills at the rate, up to the burst';
end $$;

do $$
declare r record;
begin
  -- the day's cap: the sync stops at 12,000, a write goes on to 18,000
  update public.sm8_call_meter
     set day_calls = 12000, day_utc = (clock_timestamp() at time zone 'utc')::date, tokens = 20, refilled_at = clock_timestamp()
   where meter = 'rollback-test:a';
  select * into r from public.sm8_take_call('rollback-test:a', 1, 20, 2, 10, 12000);
  if r.ok or r.why <> 'day' or r.wait_ms not between 1 and 86400000 then
    raise exception 'sync past its day cap: expected a day wait, got %', row_to_json(r);
  end if;
  select * into r from public.sm8_take_call('rollback-test:a', 1, 20, 2, 0, 18000);
  if r.ok is distinct from true then raise exception 'write under its day cap: expected ok, got %', row_to_json(r); end if;
  -- yesterday's count doesn't count today
  update public.sm8_call_meter
     set day_calls = 12000, day_utc = (clock_timestamp() at time zone 'utc')::date - 1
   where meter = 'rollback-test:a';
  select * into r from public.sm8_take_call('rollback-test:a', 1, 20, 2, 10, 12000);
  if r.ok is distinct from true then raise exception 'a new UTC day: expected ok, got %', row_to_json(r); end if;
  if (select day_calls from public.sm8_call_meter where meter = 'rollback-test:a') <> 1 then
    raise exception 'a new UTC day should restart the count at 1';
  end if;
  raise notice 'ok: each lane stops at its own daily cap, and the count restarts at UTC midnight';
end $$;

do $$
declare r record;
begin
  -- a 429 per minute: every caller, every lane, waits out the minute
  perform public.sm8_note_throttle('rollback-test:b', 'minute', 60000);
  select * into r from public.sm8_take_call('rollback-test:b', 1, 20, 2, 0, 18000);
  if r.ok or r.why <> 'cooldown_minute' or r.wait_ms not between 59000 and 60000 then
    raise exception 'after a minute 429: expected a minute cooldown, got %', row_to_json(r);
  end if;
  if (select tokens from public.sm8_call_meter where meter = 'rollback-test:b') <> 0 then
    raise exception 'a 429 should empty the bucket';
  end if;
  -- a 429 per day: an hour, and a later minute 429 neither shortens nor relabels it
  perform public.sm8_note_throttle('rollback-test:b', 'day', 3600000);
  perform public.sm8_note_throttle('rollback-test:b', 'minute', 60000);
  select * into r from public.sm8_take_call('rollback-test:b', 1, 20, 2, 0, 18000);
  if r.ok or r.why <> 'cooldown_day' or r.wait_ms not between 3590000 and 3600000 then
    raise exception 'after a day 429: expected an hour cooldown, got %', row_to_json(r);
  end if;
  -- a cooldown that has passed is no cooldown
  update public.sm8_call_meter
     set cooldown_until = clock_timestamp() - interval '1 second', refilled_at = clock_timestamp() - interval '1 minute'
   where meter = 'rollback-test:b';
  select * into r from public.sm8_take_call('rollback-test:b', 1, 20, 2, 10, 12000);
  if r.ok is distinct from true then raise exception 'after the cooldown: expected ok, got %', row_to_json(r); end if;
  raise notice 'ok: a 429 holds every caller for its cooldown, and no longer';
end $$;

do $$
begin
  begin
    perform public.sm8_take_call('rollback-test:c', 1, 20, 2, 20, 18000);
    raise exception 'a floor at the burst should be refused';
  exception when raise_exception then
    if sqlerrm <> 'sm8_take_call: bad arguments' then raise; end if;
  end;
  raise notice 'ok: arguments that could never let a call through are refused';
end $$;

do $$
declare r record;
begin
  -- the guard, on a table shaped like a mirror
  create temporary table rollback_test_mirror (uuid text primary key, name text, edit_date text) on commit drop;
  create trigger sm8_keep_newer before update on rollback_test_mirror
    for each row execute function public.sm8_mirror_keep_newer();
  insert into rollback_test_mirror values ('u1', 'newer', '2026-09-25 10:00:00');

  -- an older copy, as the sync's upsert writes it: kept out
  insert into rollback_test_mirror values ('u1', 'older', '2026-09-25 09:59:59')
    on conflict (uuid) do update set name = excluded.name, edit_date = excluded.edit_date;
  select * into r from rollback_test_mirror where uuid = 'u1';
  if r.name <> 'newer' then raise exception 'an older edit_date replaced a newer one: %', row_to_json(r); end if;

  -- the same stamp, a later one, and a missing one all go through
  insert into rollback_test_mirror values ('u1', 'same', '2026-09-25 10:00:00')
    on conflict (uuid) do update set name = excluded.name, edit_date = excluded.edit_date;
  if (select name from rollback_test_mirror where uuid = 'u1') <> 'same' then raise exception 'an equal stamp was kept out'; end if;
  insert into rollback_test_mirror values ('u1', 'later', '2026-09-25 10:00:01')
    on conflict (uuid) do update set name = excluded.name, edit_date = excluded.edit_date;
  if (select name from rollback_test_mirror where uuid = 'u1') <> 'later' then raise exception 'a newer stamp was kept out'; end if;
  insert into rollback_test_mirror values ('u1', 'nameless', null)
    on conflict (uuid) do update set name = excluded.name, edit_date = excluded.edit_date;
  if (select name from rollback_test_mirror where uuid = 'u1') <> 'nameless' then raise exception 'a null stamp was kept out'; end if;
  raise notice 'ok: the mirror keeps the newer copy of a record';
end $$;

rollback;
