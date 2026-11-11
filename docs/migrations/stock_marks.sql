-- STOCK — what the jobs booked in the next two weeks need, ticked In stock
-- in the factory and Ordered from the supplier (Isaac, 11 November 2026:
-- "see an upcoming inventory requirement ... jobs that are booked in next
-- week and the week after ... tick things off as he's ordered them or as
-- they've come into the office", then "it should show you the whole
-- shopping list ... someone can go through the factory and tick things off
-- ... it will get allocated to whoever's booked in first"; the mock
-- https://claude.ai/artifact/WQ1yppLgALMhXbHM5XWLDq).
--
-- WHAT A JOB NEEDS IS NEVER STORED HERE. It is read each time from the job's
-- quote (its accepted option's unit and control lines, lib/stock/stock.ts),
-- so a requote is seen at once. This table keeps only what people did: how
-- many of an item are in stock FOR THIS JOB, how many are ordered for it,
-- and who did each and when.
--
-- ONE ROW A JOB AN ITEM. `item_key` is the item's model code, upper-cased
-- ("MSZ-AP25VGKD2-A2"), or "duct" for a job's ductwork suggestion. Keyed by
-- the code rather than a quote line's id so a requote that keeps the model
-- keeps its tick, and a changed model starts at none in, as it should.
--
-- ALLOCATION IS WRITTEN, NOT WORKED OUT ON READ: a count said on the
-- shopping list ("we've got 4 of 6") is split across the jobs that need
-- the item, earliest booking first, and each job's share is stored on its
-- row. So a job keeps what it was given when another job is booked earlier
-- later; re-sharing on a moved booking is not built.
--
-- KEYED BY sm8_job_uuid, NOT A FOREIGN KEY, for the reason job_picklist.sql
-- and purchases.sql give: the mirror is a disposable cache.
--
-- Not applied to prod. Nothing reads it until it is: the app checks for the
-- table and shows Stock as not set up yet.

create table if not exists public.stock_marks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  sm8_job_uuid text not null,
  item_key text not null check (length(item_key) between 1 and 120),
  -- how many of it are in the office for this job
  in_stock integer not null default 0 check (in_stock between 0 and 10000),
  in_stock_by text,
  in_stock_at timestamptz,
  -- how many are ordered for this job and not yet in
  ordered integer not null default 0 check (ordered between 0 and 10000),
  -- the price book's supplier it was ordered from, or null
  ordered_from text,
  ordered_by text,
  ordered_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (org_id, sm8_job_uuid, item_key)
);

comment on table public.stock_marks is
  'Stock: how many of an item are in stock and ordered for one job, with who and when. What the job needs is read from its quote, never kept here.';

create index if not exists stock_marks_org_idx on public.stock_marks (org_id, sm8_job_uuid);

-- RLS deny-all, enforcement app-layer, same as every other table here.
alter table public.stock_marks enable row level security;
