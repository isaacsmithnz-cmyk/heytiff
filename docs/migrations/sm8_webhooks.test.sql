-- A rolled-back test of sm8_webhooks.sql's three functions: the route's one
-- round trip (sm8_take_ping), a rotation (sm8_rotate_hook) and the hook
-- call counter (sm8_take_hook_call). RUN IT AFTER THE MIGRATION: it needs
-- the three tables.
--
-- SAFE TO RUN AGAINST PRODUCTION: everything below is one transaction that
-- ends in ROLLBACK. It works on the workspace whose ServiceM8 connection is
-- connected (the functions check the connection, so it must be a real
-- one), under hook hashes spelled 'rollback-test:*' that no real secret can
-- hash to, and it raises before anything else if that workspace already has
-- a hook — after the walk, this script has nothing left to prove.
--
-- Run it whole. Each check RAISEs an exception on failure, which aborts the
-- transaction (the ROLLBACK then only ends it); a clean run prints one
-- NOTICE per check and leaves nothing behind.
--
-- The block between the BEGIN and END markers is a copy of the
-- migration's, and src/lib/integrations/__tests__/sm8-hooks-migration.test.ts
-- fails if they drift apart.

begin;

-- BEGIN HOOK FUNCTIONS (the test script carries this block; a jest test holds the copies equal)

-- The route's one round trip. p_object null = a challenge: only the lookup.
create or replace function public.sm8_take_ping(
  p_hash text, p_object text, p_uuids text[], p_cap integer
)
returns table (verdict text, hook_org uuid)
language plpgsql volatile set search_path = public
as $$
declare
  v_org uuid; v_account text; v_count integer; v_new integer := 0; v_u text;
begin
  select h.org_id, h.account_uuid into v_org, v_account
    from public.sm8_webhook_hooks h
   where h.hook_hash = p_hash and (h.valid_until is null or h.valid_until > clock_timestamp());
  if v_org is null then return query select 'unknown'::text, null::uuid; return; end if;
  if not exists (select 1 from public.integration_connections c
                  where c.org_id = v_org and c.provider = 'servicem8'
                    and c.status = 'connected' and c.tenant_id = v_account) then
    return query select 'stale'::text, v_org; return;
  end if;
  if p_object is null then return query select 'known'::text, v_org; return; end if;
  if coalesce(array_length(p_uuids, 1), 0) not between 1 and 10 then
    raise exception 'sm8_take_ping: 1 to 10 uuids';
  end if;

  update public.sm8_webhooks w set last_ping_at = clock_timestamp(), quiet_since = null
   where w.org_id = v_org;

  foreach v_u in array p_uuids loop
    update public.sm8_webhook_pings p
       set last_seen_at = clock_timestamp(), pings = p.pings + 1
     where p.org_id = v_org and p.object = p_object and p.uuid = v_u;
    if not found then
      select count(*) into v_count from public.sm8_webhook_pings p where p.org_id = v_org;
      if v_count >= p_cap then
        update public.sm8_webhooks w set sync_wanted_at = clock_timestamp() where w.org_id = v_org;
        return query select 'full'::text, v_org; return;
      end if;
      insert into public.sm8_webhook_pings as p (org_id, object, uuid) values (v_org, p_object, v_u)
        on conflict (org_id, object, uuid) do update
        set last_seen_at = clock_timestamp(), pings = p.pings + 1;
      v_new := v_new + 1;
    end if;
  end loop;
  return query select (case when v_new > 0 then 'queued' else 'merged' end)::text, v_org;
end
$$;

-- A rotation: the current secret retires (valid 72 h more), the new one is current.
create or replace function public.sm8_rotate_hook(p_org uuid, p_account text, p_hash text)
returns void language plpgsql volatile set search_path = public
as $$
begin
  update public.sm8_webhook_hooks
     set retired_at = clock_timestamp(), valid_until = clock_timestamp() + interval '72 hours'
   where org_id = p_org and retired_at is null;
  insert into public.sm8_webhook_hooks (hook_hash, org_id, account_uuid) values (p_hash, p_org, p_account);
  insert into public.sm8_webhooks (org_id, account_uuid) values (p_org, p_account)
    on conflict (org_id) do update set account_uuid = excluded.account_uuid, rotate_wanted_at = null;
end
$$;

-- One hook call, counted BEFORE it is made. False: the day's budget is spent.
create or replace function public.sm8_take_hook_call(p_org uuid, p_budget integer)
returns boolean language plpgsql volatile set search_path = public
as $$
declare v_today date := (clock_timestamp() at time zone 'utc')::date;
begin
  update public.sm8_webhooks w
     set calls_today = case when w.calls_day = v_today then w.calls_today + 1 else 1 end,
         calls_day   = v_today
   where w.org_id = p_org
     and (w.calls_day is distinct from v_today or w.calls_today < p_budget);
  return found;
end
$$;

revoke execute on function public.sm8_take_ping(text, text, text[], integer) from public, anon, authenticated;
grant  execute on function public.sm8_take_ping(text, text, text[], integer) to service_role;
revoke execute on function public.sm8_rotate_hook(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.sm8_rotate_hook(uuid, text, text) to service_role;
revoke execute on function public.sm8_take_hook_call(uuid, integer) from public, anon, authenticated;
grant  execute on function public.sm8_take_hook_call(uuid, integer) to service_role;
-- END HOOK FUNCTIONS

-- the workspace under test: the connected one, and its account
create temporary table rollback_test_ctx on commit drop as
  select c.org_id as org, c.tenant_id as account
    from public.integration_connections c
   where c.provider = 'servicem8' and c.status = 'connected' and c.tenant_id is not null
   order by c.org_id
   limit 1;

do $$
declare v_org uuid;
begin
  select org into v_org from rollback_test_ctx;
  if v_org is null then raise exception 'no connected ServiceM8 workspace to test against'; end if;
  if exists (select 1 from public.sm8_webhook_hooks where org_id = v_org) then
    raise exception 'this workspace already has a hook: nothing here is for after the walk';
  end if;
  raise notice 'ok: testing against the connected workspace, which has no hook yet';
end $$;

-- 1. a rotation makes a hash known, for a challenge
do $$
declare c rollback_test_ctx%rowtype; r record;
begin
  select * into c from rollback_test_ctx;
  perform public.sm8_rotate_hook(c.org, c.account, 'rollback-test:hook-a');
  select * into r from public.sm8_take_ping('rollback-test:hook-a', null, null, 2000);
  if r.verdict is distinct from 'known' or r.hook_org is distinct from c.org then
    raise exception '1: a challenge on a fresh hash: expected known, got %', row_to_json(r);
  end if;
  select * into r from public.sm8_take_ping('rollback-test:never', null, null, 2000);
  if r.verdict is distinct from 'unknown' or r.hook_org is not null then
    raise exception '1: a never-known hash: expected unknown, got %', row_to_json(r);
  end if;
  if (select count(*) from public.sm8_webhooks where org_id = c.org) <> 1 then
    raise exception '1: the rotation should make the workspace''s sm8_webhooks row';
  end if;
  raise notice 'ok 1: a rotated-in hash is known, and a never-known one unknown';
end $$;

-- 2. a new record is queued; the same record again merges
do $$
declare c rollback_test_ctx%rowtype; r record;
begin
  select * into c from rollback_test_ctx;
  select * into r from public.sm8_take_ping('rollback-test:hook-a', 'jobs',
    array['0e0e0e0e-0000-4000-8000-000000000001'], 2000);
  if r.verdict is distinct from 'queued' then raise exception '2: first ping: expected queued, got %', row_to_json(r); end if;
  select * into r from public.sm8_take_ping('rollback-test:hook-a', 'jobs',
    array['0e0e0e0e-0000-4000-8000-000000000001'], 2000);
  if r.verdict is distinct from 'merged' then raise exception '2: the same ping: expected merged, got %', row_to_json(r); end if;
  if (select pings from public.sm8_webhook_pings
       where org_id = c.org and object = 'jobs' and uuid = '0e0e0e0e-0000-4000-8000-000000000001') is distinct from 2 then
    raise exception '2: a merged ping should count 2';
  end if;
  if (select last_ping_at from public.sm8_webhooks where org_id = c.org) is null then
    raise exception '2: a ping should stamp last_ping_at';
  end if;
  raise notice 'ok 2: queued, then merged with pings = 2';
end $$;

-- 3. several uuids in one call
do $$
declare c rollback_test_ctx%rowtype; r record;
begin
  select * into c from rollback_test_ctx;
  select * into r from public.sm8_take_ping('rollback-test:hook-a', 'job_notes',
    array['0e0e0e0e-0000-4000-8000-000000000002', '0e0e0e0e-0000-4000-8000-000000000003'], 2000);
  if r.verdict is distinct from 'queued' then raise exception '3: two new: expected queued, got %', row_to_json(r); end if;
  select * into r from public.sm8_take_ping('rollback-test:hook-a', 'job_notes',
    array['0e0e0e0e-0000-4000-8000-000000000004', '0e0e0e0e-0000-4000-8000-000000000002'], 2000);
  if r.verdict is distinct from 'queued' then raise exception '3: one new, one old: expected queued, got %', row_to_json(r); end if;
  if (select count(*) from public.sm8_webhook_pings where org_id = c.org) <> 4 then
    raise exception '3: expected 4 queued rows, found %', (select count(*) from public.sm8_webhook_pings where org_id = c.org);
  end if;
  raise notice 'ok 3: two uuids in one call queue, and a new one beside an old one queues';
end $$;

-- 4. the cap
do $$
declare c rollback_test_ctx%rowtype; r record; n integer;
begin
  select * into c from rollback_test_ctx;
  select count(*) into n from public.sm8_webhook_pings where org_id = c.org;
  select * into r from public.sm8_take_ping('rollback-test:hook-a', 'companies',
    array['0e0e0e0e-0000-4000-8000-000000000005'], n);
  if r.verdict is distinct from 'full' then raise exception '4: at the cap: expected full, got %', row_to_json(r); end if;
  if exists (select 1 from public.sm8_webhook_pings where org_id = c.org and uuid = '0e0e0e0e-0000-4000-8000-000000000005') then
    raise exception '4: a full queue took a row';
  end if;
  if (select sync_wanted_at from public.sm8_webhooks where org_id = c.org) is null then
    raise exception '4: a full queue should ask for an ordinary sync';
  end if;
  -- a record already waiting still merges at the cap
  select * into r from public.sm8_take_ping('rollback-test:hook-a', 'jobs',
    array['0e0e0e0e-0000-4000-8000-000000000001'], n);
  if r.verdict is distinct from 'merged' then raise exception '4: a waiting record at the cap: expected merged, got %', row_to_json(r); end if;
  raise notice 'ok 4: full at the cap, sync_wanted_at set, and a waiting record still merges';
end $$;

-- 7. the day's hook calls, counted before each
do $$
declare c rollback_test_ctx%rowtype; a boolean; b boolean; d boolean;
begin
  select * into c from rollback_test_ctx;
  a := public.sm8_take_hook_call(c.org, 2);
  b := public.sm8_take_hook_call(c.org, 2);
  d := public.sm8_take_hook_call(c.org, 2);
  if a is distinct from true or b is distinct from true or d is distinct from false then
    raise exception '7: budget 2: expected true, true, false, got %, %, %', a, b, d;
  end if;
  if (select calls_today from public.sm8_webhooks where org_id = c.org) <> 2 then
    raise exception '7: a refused call was counted';
  end if;
  -- yesterday's count starts again at one
  update public.sm8_webhooks set calls_day = calls_day - 1 where org_id = c.org;
  if public.sm8_take_hook_call(c.org, 2) is distinct from true
     or (select calls_today from public.sm8_webhooks where org_id = c.org) <> 1 then
    raise exception '7: a new UTC day should start the count again';
  end if;
  if public.sm8_take_hook_call('00000000-0000-4000-8000-00000000dead', 2) is distinct from false then
    raise exception '7: a workspace with no sm8_webhooks row has no calls';
  end if;
  raise notice 'ok 7: budget 2 gives true, true, false; a new day starts again';
end $$;

-- 8. a bad uuid or object raises
do $$
declare raised boolean;
begin
  begin
    perform * from public.sm8_take_ping('rollback-test:hook-a', 'jobs', array['not-a-uuid'], 2000);
    raised := false;
  exception when others then raised := true;
  end;
  if not raised then raise exception '8: a bad uuid was queued'; end if;
  begin
    perform * from public.sm8_take_ping('rollback-test:hook-a', 'jobs', array['0E0E0E0E-0000-4000-8000-000000000009'], 2000);
    raised := false;
  exception when others then raised := true;
  end;
  if not raised then raise exception '8: an uppercase uuid was queued'; end if;
  begin
    perform * from public.sm8_take_ping('rollback-test:hook-a', 'staff', array['0e0e0e0e-0000-4000-8000-000000000009'], 2000);
    raised := false;
  exception when others then raised := true;
  end;
  if not raised then raise exception '8: an object we don''t subscribe was queued'; end if;
  raise notice 'ok 8: a bad uuid, an uppercase one and an unsubscribed object raise';
end $$;

-- 9. more than ten uuids, or none, raise
do $$
declare raised boolean; many text[];
begin
  select array_agg(format('0e0e0e0e-0000-4000-8000-%s', lpad(i::text, 12, '0'))) into many
    from generate_series(100, 110) as i;
  begin
    perform * from public.sm8_take_ping('rollback-test:hook-a', 'jobs', many, 2000);
    raised := false;
  exception when others then raised := true;
  end;
  if not raised then raise exception '9: 11 uuids were taken'; end if;
  begin
    perform * from public.sm8_take_ping('rollback-test:hook-a', 'jobs', array[]::text[], 2000);
    raised := false;
  exception when others then raised := true;
  end;
  if not raised then raise exception '9: no uuids were taken'; end if;
  raise notice 'ok 9: 11 uuids raise, and so do none';
end $$;

-- 5. a rotation keeps the old hash for 72 hours, then it is unknown
do $$
declare c rollback_test_ctx%rowtype; r record;
begin
  select * into c from rollback_test_ctx;
  perform public.sm8_rotate_hook(c.org, c.account, 'rollback-test:hook-b');
  select * into r from public.sm8_take_ping('rollback-test:hook-a', null, null, 2000);
  if r.verdict is distinct from 'known' then raise exception '5: a hash rotated out: expected known, got %', row_to_json(r); end if;
  select * into r from public.sm8_take_ping('rollback-test:hook-b', null, null, 2000);
  if r.verdict is distinct from 'known' then raise exception '5: the new hash: expected known, got %', row_to_json(r); end if;
  if (select count(*) from public.sm8_webhook_hooks where org_id = c.org and retired_at is null) <> 1 then
    raise exception '5: a workspace should have exactly one current hash';
  end if;
  if not exists (select 1 from public.sm8_webhook_hooks
                  where hook_hash = 'rollback-test:hook-a'
                    and valid_until between clock_timestamp() + interval '71 hours' and clock_timestamp() + interval '73 hours') then
    raise exception '5: the retired hash should stay valid for 72 hours';
  end if;
  -- a retired hash still queues a ping for the same account
  select * into r from public.sm8_take_ping('rollback-test:hook-a', 'attachments',
    array['0e0e0e0e-0000-4000-8000-000000000006'], 2000);
  if r.verdict is distinct from 'queued' then raise exception '5: a retired hash''s ping: expected queued, got %', row_to_json(r); end if;
  update public.sm8_webhook_hooks set valid_until = clock_timestamp() - interval '1 second'
   where hook_hash = 'rollback-test:hook-a';
  select * into r from public.sm8_take_ping('rollback-test:hook-a', null, null, 2000);
  if r.verdict is distinct from 'unknown' then raise exception '5: a hash past its grace: expected unknown, got %', row_to_json(r); end if;
  raise notice 'ok 5: the old hash stays known for 72 hours after a rotation, then is unknown';
end $$;

-- 6. a hash for another account is stale
do $$
declare c rollback_test_ctx%rowtype; r record;
begin
  select * into c from rollback_test_ctx;
  update public.sm8_webhook_hooks set account_uuid = 'other' where hook_hash = 'rollback-test:hook-b';
  select * into r from public.sm8_take_ping('rollback-test:hook-b', null, null, 2000);
  if r.verdict is distinct from 'stale' or r.hook_org is distinct from c.org then
    raise exception '6: another account''s hash: expected stale, got %', row_to_json(r);
  end if;
  select * into r from public.sm8_take_ping('rollback-test:hook-b', 'jobs',
    array['0e0e0e0e-0000-4000-8000-000000000007'], 2000);
  if r.verdict is distinct from 'stale' then raise exception '6: a change on a stale hash: expected stale, got %', row_to_json(r); end if;
  if exists (select 1 from public.sm8_webhook_pings where uuid = '0e0e0e0e-0000-4000-8000-000000000007') then
    raise exception '6: a stale hash queued a row';
  end if;
  raise notice 'ok 6: a hash whose account isn''t the connection''s is stale, and queues nothing';
end $$;

rollback;
