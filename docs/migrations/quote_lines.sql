-- A QUOTE'S LINES, ONE ROW EACH (the engine rebuild, slice 2.1; Isaac's go
-- 2026-10-08).
--
-- Today a quote's lines are worked out each time it's priced, from the
-- proposal's options and the site checklist (option-materials.ts). In the
-- rebuild they are kept: each line its own row, so a person and Tiff change
-- one line at a time, two edits to different lines never clash, every
-- change is kept with who made it, and any change can be undone.
--
-- `quote_drafts.engine` is the switch, one per quote: 'old' (every quote
-- today) prices as now; 'lines' prices from these rows. Nothing reads these
-- tables until a quote is switched.
--
-- KEYED BY sm8_job_uuid, NOT A FOREIGN KEY, for quote_drafts.sql's reason:
-- the ServiceM8 mirror is disposable.
--
-- PRICES ARE NUMERIC: cable is bought by the metre at a price that lands
-- between cents once marked up ($3.54 × 1.4 = $4.956), and qty × each must
-- equal the line's total.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: two new tables and a column with a
-- default every existing row takes ('old'). Additive and idempotent.

create table if not exists public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  sm8_job_uuid text not null,
  -- the option it's on, counted from 0 as the proposal counts them
  option_index integer not null default 0 check (option_index >= 0 and option_index < 20),
  -- where it sits: the system ("Downstairs"), then the group ("Units")
  system text not null default '',
  grp text not null,
  -- its order within the quote
  position integer not null default 0,
  name text not null,
  -- the price-book item it's priced from; both null for an allowance
  code text,
  supplier_key text,
  kind text not null check (kind in ('unit', 'material', 'labour')),
  qty numeric not null check (qty >= 0),
  -- "m" for a length, "h" for hours, '' for a count
  unit text not null default '' check (unit in ('', 'm', 'h')),
  -- what one costs the business: the book's price, or an hour's cost
  cost_cents numeric not null default 0 check (cost_cents >= 0),
  -- what one sells for, when a person set it; null: cost at the markup
  sell_cents numeric check (sell_cents is null or sell_cents >= 0),
  -- where it came from: what the brief said, what was assumed, not known
  -- yet, made to fit, or typed by a person
  source text not null default 'by_hand' check (source in ('said', 'assumed', 'unknown', 'fitted', 'by_hand')),
  -- the words it came from, or the reason it was assumed
  why text not null default '',
  -- counts toward the duct contingency
  duct boolean not null default false,
  -- bumped on every change, so a change made against an old copy is refused
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- auth id of whoever made it or last changed it
  updated_by text not null
);

create index if not exists quote_lines_job on public.quote_lines (org_id, sm8_job_uuid, option_index, position);

comment on table public.quote_lines is
  'A quote''s lines, one row each, for a quote on the new engine (quote_drafts.engine = ''lines''). See src/lib/quotes/lines.ts.';
comment on column public.quote_lines.sm8_job_uuid is
  'sm8_jobs.uuid of the job card. Deliberately NOT a foreign key: the mirror is disposable.';

-- Every change to a line: what it was, what it became, who and why. The
-- line's history (Undo), and later what Tiff's habits learn from.
create table if not exists public.quote_line_changes (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  sm8_job_uuid text not null,
  line_id uuid not null,
  action text not null check (action in ('add', 'change', 'remove')),
  -- the line as it was (null for an add) and as it became (null for a remove)
  before jsonb,
  after jsonb,
  why text not null default '',
  -- auth id of whoever made the change; 'tiff' for Tiff
  made_by text not null,
  made_at timestamptz not null default now()
);

create index if not exists quote_line_changes_job on public.quote_line_changes (org_id, sm8_job_uuid, made_at desc);
create index if not exists quote_line_changes_line on public.quote_line_changes (line_id, made_at desc);

comment on table public.quote_line_changes is
  'Every change to a quote line: before, after, who, when, why. A line''s history and its Undo.';

-- The switch, one per quote: every quote today stays on the old engine.
alter table public.quote_drafts add column if not exists engine text not null default 'old';
alter table public.quote_drafts drop constraint if exists quote_drafts_engine_check;
alter table public.quote_drafts add constraint quote_drafts_engine_check check (engine in ('old', 'lines'));

comment on column public.quote_drafts.engine is
  'Which engine prices the quote: ''old'' (worked out from the proposal and checklist) or ''lines'' (from quote_lines).';

-- RLS deny-all, enforcement app-layer, as every other table here.
alter table public.quote_lines enable row level security;
alter table public.quote_line_changes enable row level security;
