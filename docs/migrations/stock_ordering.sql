-- STOCK: ORDERING, WHAT WE ALREADY HAVE, AND WHEN IT'S NEEDED (Isaac,
-- 13 November 2026, the mock https://claude.ai/artifact/MpMUX46rk45j6dP6ZYnEsu,
-- then "Build it"): an order says where it's going and when it lands, with
-- the supplier's own order number; "Already have them" says where they are;
-- an item on a job over many visits is needed at one of them, the quote's
-- pick or one changed by hand; and a supplier keeps the address of its own
-- ordering site ("We buy through most companies portals").
--
-- On top of stock_marks.sql (applied 12 November 2026). Every column is
-- nullable or defaulted, so the app written before this keeps working.

alter table public.stock_marks
  -- the factory, or the job's own address
  add column if not exists ordered_to text not null default 'factory' check (ordered_to in ('factory', 'site')),
  -- the day the supplier said it lands; null when they didn't
  add column if not exists ordered_due date,
  -- the supplier's order number, so the docket on the truck matches
  add column if not exists order_ref text check (order_ref is null or length(order_ref) <= 60),
  -- how many we already have for this job outside the factory, and where
  add column if not exists had integer not null default 0 check (had between 0 and 10000),
  add column if not exists had_where text check (had_where is null or had_where in ('site', 'van', 'customer')),
  add column if not exists had_who text check (had_who is null or length(had_who) <= 80),
  -- the visit it's needed at, counted from 1 in the quote's visits, when
  -- changed by hand; null takes the quote's own pick
  add column if not exists needed_at integer check (needed_at is null or needed_at between 1 and 60);

alter table public.quote_suppliers
  -- where the business orders from this supplier: its trade site
  add column if not exists order_url text check (order_url is null or length(order_url) <= 300);
