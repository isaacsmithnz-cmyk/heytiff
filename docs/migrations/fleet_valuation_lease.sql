-- Fleet valuation gets a lease, so the run's result cannot die with the tab.
--
-- THE BUG THIS CLOSES WAS WATCHED HAPPEN (issue #502, prod, 2026-08-24).
-- Valuing the fleet against live listings is a multi-minute, real-money call,
-- and until now the CLIENT was the courier: the route returned the valuations
-- and persistence only happened if the register component was still mounted
-- to receive them. Isaac's first press ran the full ~5 minutes, the page did a
-- fresh navigation mid-run, and the response arrived to a dead component — no
-- error, no values, no trace, money spent. The second press, undisturbed,
-- worked perfectly. The route now persists the valuations itself; this table
-- is the other half — knowing a run is in flight at all.
--
-- A LEASE, NOT A LOCK, for the same reason kb_documents.lease_until is one:
-- the holder is a serverless invocation that can vanish without releasing
-- anything. Claiming is one conditional UPDATE — atomic in Postgres, so of two
-- simultaneous presses exactly one wins and the other is told a run is already
-- going (each press bills separately, which is exactly why two must not run at
-- once). The lease outlives the route's own maxDuration by a minute, so a
-- function Vercel kills at the ceiling frees itself shortly after.
--
-- One row per org, nullable lease: an org that has never valued has no row,
-- and a null or past lease_until reads as free. There is deliberately no
-- history here — the valuations themselves live on vehicles.ai_value, and a
-- run that finished is fully described by them.
--
-- POSTURE: RLS is ON with NO policies, like every other table here — the
-- anon/authenticated keys can read nothing, and every access goes through the
-- service-role client behind the app-layer `assets_all` gate
-- (app/api/fleet/value/route.ts).
--
-- APPLY THIS BEFORE MERGING THE PR. The route claims the lease before it
-- spends anything.

create table if not exists public.fleet_valuation_leases (
  org_id      uuid primary key references public.organizations (id) on delete cascade,
  lease_until timestamptz
);

comment on column public.fleet_valuation_leases.lease_until is
  'While in the future, a valuation run owns this org''s fleet; nobody else may start one. Expires so a dead function frees it.';

alter table public.fleet_valuation_leases enable row level security;
