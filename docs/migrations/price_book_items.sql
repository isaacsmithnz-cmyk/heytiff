-- The price book's current items for one business, in ONE call (26 October
-- 2026). The book was read through the API a thousand rows a page: a first
-- page to count, then eight more, ~1–1.5 s for 8,870 parts. Built here as
-- one JSON array of rows (each the columns the app reads, in this order),
-- it is one query, 28 ms on that book, and no page limit applies to it.
--
-- Order of each row: supplier_key, code, name, times_bought, uom, cents,
-- on_list, listed_on, last_import_at, priced_on, paid_cents, paid_on.
create or replace function public.price_book_items(p_org uuid)
returns json
language sql
stable
set search_path = public
as $$
  select coalesce(
    json_agg(
      json_build_array(supplier_key, code, name, times_bought, uom, cents, on_list, listed_on, last_import_at, priced_on, paid_cents, paid_on)
      order by supplier_key, code
    ),
    '[]'::json
  )
  from public.quote_price_items
  where org_id = p_org and current
$$;

-- the app calls it with the service role; nobody else may
revoke execute on function public.price_book_items(uuid) from public, anon, authenticated;
grant execute on function public.price_book_items(uuid) to service_role;
