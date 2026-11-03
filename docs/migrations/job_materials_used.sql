-- WHAT WAS USED ON A JOB, A DAY AT A TIME (Isaac, 3 November 2026: "Yes,
-- add the table and build the wrap-up with the list"). One list per job per
-- day, shared by everyone on it: each person says what they used at the
-- day's wrap-up, the price book finds it, and a repeat of something already
-- on the list is asked about rather than counted twice. Every line keeps who
-- said what. The Job tracker reads it (never writes it); a service call's
-- lines go on to ServiceM8 as job materials from here.
--
-- A line counts as used while `removed_at` is null, at `qty` in `unit`:
-- an open repeat (`open_repeat`) never changes it until someone settles it.

create table if not exists public.job_materials_used (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- the ServiceM8 job, as the mirror keeps its uuid
  sm8_job_uuid text not null,
  -- the day it was used, on the account's own clock
  day date not null,
  -- the price book's item (quote_price_items' supplier_key + code), or null:
  -- not in the book, or a "Which one?" still open
  supplier_key text,
  code text,
  -- what the line reads: the book item's name once matched, else the words said
  name text not null check (btrim(name) <> ''),
  qty numeric(12, 3) not null check (qty > 0),
  -- as said: 'm', 'roll', 'box', 'L', 'kg'; null is a count
  unit text,
  -- the book's items to pick from when the words fit more than one:
  -- [{supplierKey, code, name, hint}], null once picked or when there were none
  choices jsonb,
  -- who put it on the list: their auth user id, their staff card when they
  -- have one, and the words they said
  added_by text not null,
  added_by_staff uuid references public.staff_profiles (id) on delete set null,
  words text not null default '',
  -- someone said a different figure and nobody settled it:
  -- {by, staff, qty, at}; the line's own qty still counts
  open_repeat jsonb,
  -- how it got there, oldest first: [{at, by, staff, kind, qty, was, ...}]
  history jsonb not null default '[]'::jsonb,
  -- taken off the list: kept for its history, never counted
  removed_at timestamptz,
  -- a service call's line sent to ServiceM8 as a job material, and its write
  sent_to_sm8_at timestamptz,
  sm8_write_id uuid references public.sm8_writes (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- the item it's matched to, or the name it was said as: one live line each a day
  item_key text generated always as (coalesce(supplier_key || '|' || code, 'name:' || lower(btrim(name)))) stored,
  constraint job_materials_used_item_check check ((supplier_key is null) = (code is null))
);

comment on table public.job_materials_used is
  'What was used on a job, one shared list a day: said at the wrap-up, matched to the price book, every line keeping who said what. Counts while removed_at is null.';

create index if not exists job_materials_used_job_idx
  on public.job_materials_used (org_id, sm8_job_uuid, day);

-- two people pressing Add in the same second: the second gets the question
create unique index if not exists job_materials_used_one_live
  on public.job_materials_used (org_id, sm8_job_uuid, day, item_key)
  where removed_at is null;

-- RLS deny-all, enforcement app-layer, same as every other table here.
alter table public.job_materials_used enable row level security;
