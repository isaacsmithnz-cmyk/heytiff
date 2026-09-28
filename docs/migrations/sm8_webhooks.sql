-- Live updates from ServiceM8 (two-way phase 4, PR A), and the sync lease's
-- token.
--
-- WHEN TO APPLY: BEFORE PR B DEPLOYS (PR B writes the four new sm8_sync_runs
-- columns; without them it falls back to today's lease, logged once).
-- Additive and idempotent: safe to run twice. The code on main never reads
-- any of it, and nothing writes a row until SM8_WEBHOOKS=1 on Production
-- (src/lib/integrations/sm8-hooks-switch.ts).
--
-- WHAT IT ADDS
-- 1. sm8_sync_runs gains the lease's token, who holds it ('sync' | 'hook' |
--    'switch'), and a sync asking for it (wanted_at, wanted_by), so every
--    holder releases and extends by its own token and a drain stands aside
--    when a sync asks.
-- 2. sm8_webhooks: one row per workspace while live updates are set up —
--    what is subscribed per object (NEVER an address), the last ping and
--    drain, the drain's single flight, a sync the queue asked for, a
--    rotation a reconnect owes, and the day's hook calls.
-- 3. sm8_webhook_hooks: the secret in each address, by SHA-256 only. One
--    current per workspace; a rotated one stays valid 72 hours (ServiceM8's
--    retry window) and only for the account it was minted for.
-- 4. sm8_webhook_pings: the doorbell queue, one row per record, merged.
-- 5. Three functions, service_role only: sm8_take_ping (the route's one
--    round trip), sm8_rotate_hook (a rotation, in one transaction) and
--    sm8_take_hook_call (one hook call, counted before it is made).
--
-- Deny-all to the public keys (RLS on, no policies): the house posture.
--
-- READ-ONLY, BEFORE (expect t, t, t, t, 0):
--   select to_regclass('public.sm8_webhooks') is null,
--          to_regclass('public.sm8_webhook_hooks') is null,
--          to_regclass('public.sm8_webhook_pings') is null,
--          not exists (select 1 from pg_proc
--                       where proname in ('sm8_take_ping','sm8_rotate_hook','sm8_take_hook_call')),
--          (select count(*) from information_schema.columns
--            where table_schema = 'public' and table_name = 'sm8_sync_runs'
--              and column_name in ('lease_token','lease_by','wanted_at','wanted_by'));
--
-- THEN RUN docs/migrations/sm8_webhooks.test.sql WHOLE. It is one
-- transaction that ends in ROLLBACK, safe against production: it exercises
-- the three functions on the connected workspace and leaves nothing behind.
-- Every check raises on failure and names what it saw.
--
-- READ-ONLY, AFTER:
--   -- 3 rows, rls true, 0 policies
--   select c.relname, c.relrowsecurity,
--          (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname in ('sm8_webhooks','sm8_webhook_hooks','sm8_webhook_pings');
--   -- 3 rows, each: f, f, t
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'execute'),
--          has_function_privilege('authenticated', p.oid, 'execute'),
--          has_function_privilege('service_role', p.oid, 'execute')
--     from pg_proc p where p.proname in ('sm8_take_ping','sm8_rotate_hook','sm8_take_hook_call');
--   -- 4
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'sm8_sync_runs'
--      and column_name in ('lease_token','lease_by','wanted_at','wanted_by');
--   -- 0, 0, 0 (and again after the test script: it rolls back)
--   select (select count(*) from public.sm8_webhooks),
--          (select count(*) from public.sm8_webhook_hooks),
--          (select count(*) from public.sm8_webhook_pings);
--
-- ROLLING BACK: DEPLOY.md's "Live updates from ServiceM8 (two-way phase 4)".
-- The tables stay; old code never reads them.

begin;
set local lock_timeout = '5s';
-- Waits at most 5 s for a lock and fails rather than queue behind one: the
-- ALTERs below hold ACCESS EXCLUSIVE on sm8_sync_runs until commit, and every
-- sync waits on that table. A timeout rolls it all back; run it again.

-- ── 1. the sync lease: a token, who holds it, and a sync asking for it ──
alter table public.sm8_sync_runs add column if not exists lease_token uuid;
alter table public.sm8_sync_runs add column if not exists lease_by    text;   -- 'sync' | 'hook' | 'switch'
alter table public.sm8_sync_runs add column if not exists wanted_at   timestamptz;
alter table public.sm8_sync_runs add column if not exists wanted_by   text;

-- ── 2. one row per workspace while live updates are set up ──
create table if not exists public.sm8_webhooks (
  org_id           uuid primary key references public.organizations(id) on delete cascade,
  account_uuid     text not null,
  subscribed_at    timestamptz,             -- all six active at the current address
  objects          jsonb not null default '{}'::jsonb,  -- per object: name, sub, active, error, failure, new, changed; NEVER a URL
  last_ping_at     timestamptz,
  last_drain_at    timestamptz,
  draining_until   timestamptz,             -- the single flight
  sync_wanted_at   timestamptz,             -- the queue asked for an ordinary sync
  rotate_wanted_at timestamptz,             -- a reconnect owes a rotation
  ensure_tried_at  timestamptz,
  quiet_since      timestamptz,
  calls_today      integer not null default 0,
  calls_day        date,
  last_error       text
);
alter table public.sm8_webhooks enable row level security;

-- ── 3. the secrets, by hash only; a retired one stays valid 72 h ──
create table if not exists public.sm8_webhook_hooks (
  hook_hash    text primary key,            -- sha256 hex of the secret in the address
  org_id       uuid not null references public.organizations(id) on delete cascade,
  account_uuid text not null,
  created_at   timestamptz not null default now(),
  retired_at   timestamptz,
  valid_until  timestamptz,                 -- null while current
  check ((retired_at is null) = (valid_until is null))
);
alter table public.sm8_webhook_hooks enable row level security;
create unique index if not exists sm8_webhook_hooks_one_current
  on public.sm8_webhook_hooks (org_id) where retired_at is null;

-- ── 4. the doorbell queue ──
create table if not exists public.sm8_webhook_pings (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  object        text not null check (object in
                  ('jobs','job_activities','job_payments','job_notes','companies','attachments')),
  uuid          text not null check (uuid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  pings         integer not null default 1,
  attempts      integer not null default 0,
  handed_at     timestamptz,                -- handed to the next ordinary sync
  primary key (org_id, object, uuid)
);
alter table public.sm8_webhook_pings enable row level security;
create index if not exists sm8_webhook_pings_ready_idx
  on public.sm8_webhook_pings (org_id, first_seen_at);

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
        -- Review nit, left for PR C: 'full' can follow uuids this call already queued (they get no after()).
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
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 0));
  -- Two rotations at once take turns on the workspace's lock (held to commit): the
  -- second then retires the first's hash, where it would have broken
  -- sm8_webhook_hooks_one_current (spec 2.8, "Races").
  update public.sm8_webhook_hooks
     set retired_at = clock_timestamp(), valid_until = clock_timestamp() + interval '72 hours'
   where org_id = p_org and retired_at is null;
  insert into public.sm8_webhook_hooks (hook_hash, org_id, account_uuid) values (p_hash, p_org, p_account);
  insert into public.sm8_webhooks (org_id, account_uuid) values (p_org, p_account)
    -- Review nit, left for PR C: this clears rotate_wanted_at at the mint; the spec clears it at the ensure's end.
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

commit;
