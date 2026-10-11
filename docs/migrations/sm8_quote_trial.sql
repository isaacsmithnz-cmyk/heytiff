-- ── quotes to ServiceM8 on a trial run of their own (2026-10-11) ──
-- Isaac: Send to ServiceM8 as a quote, "build it, Trial first", nothing to a
-- live job until he says. The connection's write_mode is every kind's at
-- once (Diamond Air's is live, for files, notes, bookings, leave, jobs and
-- customers), so quotes get their own trial: a kind named here is checked
-- and logged and never sent, however the connection is set. Every
-- connection starts with quotes on trial; the owner's On for quotes takes
-- them off it.
--
-- Additive. Old code never reads the column. The app reads it on its own
-- (sm8-quote-trial.ts) and takes a read that fails as a trial run.
alter table public.integration_connections
  add column if not exists trial_kinds text[] not null default array['quote']::text[];

do $$ begin
  alter table public.integration_connections
    add constraint integration_connections_trial_kinds_check check (trial_kinds <@ array['quote']::text[]);
exception when duplicate_object then null; end $$;

create or replace function public.sm8_set_trial_kind(p_org uuid, p_kind text, p_trial boolean, p_at timestamptz)
returns text[] language sql volatile set search_path = public
as $$
  update public.integration_connections
     set trial_kinds = case
           when p_trial then (select array_agg(distinct k order by k) from unnest(trial_kinds || array[p_kind]) as k)
           else array_remove(trial_kinds, p_kind) end,
         updated_at = p_at
   where org_id = p_org and provider = 'servicem8' and p_kind in ('quote')
  returning trial_kinds;
$$;
revoke execute on function public.sm8_set_trial_kind(uuid, text, boolean, timestamptz) from public, anon, authenticated;
grant  execute on function public.sm8_set_trial_kind(uuid, text, boolean, timestamptz) to service_role;
