-- ── what goes on the business's quotes (2026-10-05) ──
-- Isaac: "the most used should come from quotes. And items that get pulled
-- from the quotes can sit in the most used." Two sources, counted once per
-- quote (a quote is its ServiceM8 job):
--   * HeyTiff's own quotes: every item the quote engine pulls into a job's
--     options, kept here and replaced each time the quote is priced, so a
--     quote counts what it holds now;
--   * ServiceM8's quotes: the catalogue items on every job that was quoted
--     (a quote date, or a job still a Quote or Unsuccessful). ServiceM8's
--     catalogue holds a Reece item as "REC" + Reece's code.
create table if not exists public.quote_item_uses (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  sm8_job_uuid  text not null,
  supplier_key  text not null,
  code          text not null,
  used_at       timestamptz not null default now(),
  primary key (org_id, sm8_job_uuid, supplier_key, code)
);
alter table public.quote_item_uses enable row level security;

-- How many quotes each code is on, for one business: one call, counted in
-- the database (the price book used to page every job line to the app).
create or replace function public.quote_item_counts(p_org uuid)
returns table (code text, quotes bigint)
language sql
stable
set search_path = public
as $$
  with quoted as (
    select j.uuid
    from public.sm8_jobs j
    where j.org_id = p_org
      and (j.quote_date ~ '^\d{4}-' or j.status in ('Quote', 'Unsuccessful'))
  ),
  sm8 as (
    select distinct jm.job_uuid, trim(m.item_number) as item
    from public.sm8_job_materials jm
    join quoted q on q.uuid = jm.job_uuid
    join public.sm8_materials m on m.org_id = jm.org_id and m.uuid = jm.material_uuid
    where jm.org_id = p_org and jm.active = 1 and coalesce(trim(m.item_number), '') <> ''
  ),
  pulled as (
    select job_uuid, item as code from sm8
    union
    select job_uuid, substr(item, 4) from sm8 where item ~ '^REC.'
    union
    select u.sm8_job_uuid, u.code from public.quote_item_uses u where u.org_id = p_org
  )
  select code, count(distinct job_uuid) from pulled group by code
$$;

-- the app calls it with the service role; nobody else may
revoke execute on function public.quote_item_counts(uuid) from public, anon, authenticated;
grant execute on function public.quote_item_counts(uuid) to service_role;
