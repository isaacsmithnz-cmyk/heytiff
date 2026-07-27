-- The Time & Pay + Leave core, as it is LIVE in prod — recorded 2026-07-28.
-- ALREADY APPLIED. This file exists because the audit found the repo could
-- not rebuild its own database: these six tables were created by hand-run SQL
-- that was never committed, and every later migration ALTERs schema whose
-- CREATE lived nowhere. Everything here is IF NOT EXISTS, so running it
-- against prod is a no-op and running it against a fresh database yields the
-- real thing. Column-for-column from information_schema + pg_constraint +
-- pg_indexes, not from memory.
--
-- RLS: enabled with NO policies on every table — deny-all to the public
-- keys. All enforcement is app-layer through the service role, like the rest
-- of the schema.

-- ── pay_settings — one row per org, the period model ──────────────────────
create table if not exists public.pay_settings (
  org_id           uuid primary key references public.organizations (id) on delete cascade,
  cycle            text not null default 'Weekly'
                     check (cycle in ('Weekly', 'Fortnightly', 'Monthly')),
  week_start       text not null default 'Mon',
  standard         numeric(5,2) not null default 8,
  ot_after         numeric(5,2) not null default 8,
  ot_unit          text not null default 'day' check (ot_unit in ('day', 'week')),
  rules            jsonb not null default '{}'::jsonb,
  dbl_after        numeric(5,2) not null default 12,
  submit_day       text not null default 'Sun',
  submit_time      text not null default '3:00 PM',
  "lock"           boolean not null default true,
  export_detail    boolean not null default false,
  configured       boolean not null default false,
  fortnight_anchor date,
  month_start_day  integer not null default 1
                     check (month_start_day >= 1 and month_start_day <= 28),
  break_minutes    integer not null default 0,
  break_paid       boolean not null default true,
  default_start    text not null default '7:00 AM',
  default_end      text not null default '3:00 PM',
  work_days        integer[] not null default '{0,1,2,3,4}'::integer[],
  updated_at       timestamptz not null default now()
);
alter table public.pay_settings enable row level security;

-- ── time_entries — one row per person per day ─────────────────────────────
create table if not exists public.time_entries (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  staff_profile_id uuid not null,
  work_date        date not null,
  kind             text not null check (kind in ('work', 'leave', 'sick', 'ph', 'off')),
  start_time       text,
  end_time         text,
  hours            numeric(5,2) not null default 0
                     check (hours >= 0 and hours <= 24),
  note             text,
  -- which approved booking paid a materialised absence day; NULL on
  -- hand-entered rows (see time_entries_leave_request_id.sql)
  leave_request_id uuid references public.leave_requests (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint time_entries_staff_fkey
    foreign key (staff_profile_id, org_id)
    references public.staff_profiles (id, org_id) on delete cascade,
  constraint time_entries_day_key unique (org_id, staff_profile_id, work_date),
  constraint time_entries_work_times
    check (kind <> 'work' or (start_time is not null and end_time is not null))
);
create index if not exists time_entries_period_idx
  on public.time_entries (org_id, work_date, staff_profile_id);
create index if not exists time_entries_leave_request_idx
  on public.time_entries (org_id, leave_request_id)
  where leave_request_id is not null;
alter table public.time_entries enable row level security;

-- ── timesheets — the approval envelope, one row per person per period ─────
create table if not exists public.timesheets (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  staff_profile_id uuid not null,
  period_start     date not null,
  status           text not null default 'draft'
                     check (status in ('draft', 'submitted', 'approved', 'sent_back')),
  submitted_at     timestamptz,
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  review_note      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint timesheets_staff_fkey
    foreign key (staff_profile_id, org_id)
    references public.staff_profiles (id, org_id) on delete cascade,
  constraint timesheets_reviewer_fkey
    foreign key (reviewed_by, org_id)
    references public.staff_profiles (id, org_id) on delete set null,
  constraint timesheets_period_key unique (org_id, staff_profile_id, period_start)
);
create index if not exists timesheets_period_idx
  on public.timesheets (org_id, period_start);
alter table public.timesheets enable row level security;

-- ── leave_requests — the one place leave is booked ────────────────────────
create table if not exists public.leave_requests (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  staff_profile_id uuid not null,
  kind             text not null check (kind in ('annual', 'personal', 'unpaid')),
  start_date       date not null,
  end_date         date not null,
  hours            numeric(6,2) not null check (hours > 0),
  note             text,
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'declined', 'cancelled')),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  review_note      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint leave_requests_staff_fkey
    foreign key (staff_profile_id, org_id)
    references public.staff_profiles (id, org_id) on delete cascade,
  constraint leave_requests_reviewer_fkey
    foreign key (reviewed_by, org_id)
    references public.staff_profiles (id, org_id) on delete set null,
  constraint leave_requests_range check (end_date >= start_date)
);
create index if not exists leave_requests_period_idx
  on public.leave_requests (org_id, status, start_date);
create index if not exists leave_requests_staff_idx
  on public.leave_requests (org_id, staff_profile_id, start_date desc);
alter table public.leave_requests enable row level security;

-- ── leave_balances — entitlement as-at, drawn down by bookings ────────────
create table if not exists public.leave_balances (
  org_id           uuid not null references public.organizations (id) on delete cascade,
  staff_profile_id uuid not null,
  kind             text not null check (kind in ('annual', 'personal')),
  balance_hours    numeric(7,2) not null default 0,
  as_at            date not null default current_date,
  -- who owns this figure: 'manual' = set in HeyTiff; a sync writes its own
  -- source and the manual editor refuses to trample it
  source           text not null default 'manual'
                     check (source in ('manual', 'xero', 'myob', 'quickbooks')),
  synced_at        timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (org_id, staff_profile_id, kind),
  constraint leave_balances_staff_fkey
    foreign key (staff_profile_id, org_id)
    references public.staff_profiles (id, org_id) on delete cascade
);
alter table public.leave_balances enable row level security;

-- ── public_holidays — per org + state, tombstones never deletes ───────────
create table if not exists public.public_holidays (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  state        text not null,
  holiday_date date not null,
  name         text not null,
  source       text not null default 'manual',
  suppressed   boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint public_holidays_key unique (org_id, state, holiday_date)
);
create index if not exists public_holidays_org_idx
  on public.public_holidays (org_id, state, holiday_date);
alter table public.public_holidays enable row level security;
