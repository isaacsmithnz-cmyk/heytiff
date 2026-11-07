-- WHAT A JOB WAS PRICED AT, WHERE ITS QUOTE DOESN'T SAY (Isaac, 5 November
-- 2026, on 1352, whose ServiceM8 quote is one price: "allow manual override
-- on that. Or just say hours were not quoted. Add manually", then "Have
-- option for visit one 2 guys 1 day / Add visit, visit 2 3 guys 1 day",
-- then "Yes, build it"). The Job tracker judges hours worked against the
-- quote's hours and what was used against the quote's materials; a job whose
-- quote holds neither gets them here, typed by someone who sees money on jobs.
-- A quote that has its own hours or materials keeps them: this row is read
-- only where the quote says nothing.
--
-- `visits` is [{people, days}], one a visit as it was priced; the hours are
-- people x days x `day_hours`, the working day at the time it was saved (the
-- business's, from its quoting settings, else the one typed with it), so a
-- later change to the settings never moves a job already planned.

create table if not exists public.job_tracker_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- the ServiceM8 job, as the mirror keeps its uuid
  sm8_job_uuid text not null,
  -- the labour as priced, visit by visit; null when nobody has added it
  visits jsonb check (visits is null or jsonb_typeof(visits) = 'array'),
  day_hours numeric(5, 2) check (day_hours is null or day_hours > 0),
  hours_by text,
  hours_by_name text,
  hours_at timestamptz,
  -- the materials as priced, in cents at cost; null when nobody has added it
  materials_cents bigint check (materials_cents is null or materials_cents >= 0),
  materials_by text,
  materials_by_name text,
  materials_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_tracker_plans_hours_day check ((visits is null) or (day_hours is not null)),
  constraint job_tracker_plans_one unique (org_id, sm8_job_uuid)
);

comment on table public.job_tracker_plans is
  'What a job was priced at where its quote does not say: the labour visit by visit (people x days x the working day) and the materials at cost, for the Job tracker.';

-- RLS deny-all, enforcement app-layer, same as every other table here.
alter table public.job_tracker_plans enable row level security;
