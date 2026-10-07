-- HOW A BUSINESS'S JOBS ARE COUNTED (Isaac, 2026-10-07: "How do we make it
-- universal", "Settings options maybe?"). One row per business, written on
-- Admin, Analytics (src/app/actions/analytics-settings.ts) and read by the
-- Analytics page (src/lib/analytics/settings.ts says what each column means).
--
-- Every column may be null, and null is "not set": the page then works from
-- what the live account taught it (180 days, $3,000, categories read from
-- their names, the clients and the close age found in the jobs). No row at
-- all is the same as a row of nulls, so nothing needs seeding.
--
--   lapse_after_days   a Quote with no answer this long after it was raised is lost
--   quote_from_cents   a work order this big, ex GST, with no quote sent is asked about
--   auto_close_days    the age ServiceM8 closes an unanswered Quote at; 0: it doesn't
--   category_roles     { ServiceM8 category uuid: install | service | maintenance |
--                        warranty | other | not_job }
--   not_customers      [ ServiceM8 client uuid ]: their cards are bookings, not work
--
-- The values are checked by the action that writes them, not here, so a new
-- role is a code change and not a migration. Uuids are ServiceM8's, NOT
-- foreign keys, for the reason job_analytics_decisions.sql gives: the mirror
-- is a disposable cache.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: a new table nothing reads yet. Until it
-- is applied, the page counts by its defaults and the settings page says its
-- choices can't be kept yet.

create table if not exists public.analytics_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  lapse_after_days integer,
  quote_from_cents integer,
  auto_close_days integer,
  category_roles jsonb not null default '{}'::jsonb,
  not_customers jsonb,
  -- the person, as every other "updated_by" in the app: their auth user id
  updated_by text,
  updated_at timestamptz not null default now()
);

comment on table public.analytics_settings is
  'How the Analytics page counts a business''s jobs: Admin, Analytics. Null is not set, and the page''s own reading stands.';

-- RLS deny-all, enforcement app-layer, same as every other table here: the
-- service role is the only path in, and the action re-checks the org and
-- workboard_money for itself.
alter table public.analytics_settings enable row level security;
