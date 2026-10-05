-- ── fold an "invoiced" supplier into its own supplier (2026-10-05) ──
-- RUN AFTER the code that reads quote_price_sources.sql is deployed: the
-- code before it would take a list-price supplier's invoiced rows as list
-- prices and take the discount off them.
--
-- Before invoices could be added to a supplier, Mitsubishi Electric's
-- invoices went in as a supplier of their own, "Mitsubishi Electric,
-- invoiced" (key mitsubishi_invoiced). It is the same supplier: its prices
-- become Mitsubishi Electric's invoiced prices — on a code the trade book
-- lists, beside the list's price; on a code it doesn't (the VRF indoors), as
-- an item priced only by what was paid. Every business that has both keys.

begin;

-- the dates a price list's prices are from: its file name's date (day
-- first), else the day it was uploaded — for every supplier, so the newer
-- of a list price and an invoice price can be told
update public.quote_suppliers s
set list_on = coalesce(
  case
    when m[2]::int between 1 and 12 and m[1]::int between 1 and 31
      then make_date(m[3]::int, m[2]::int, m[1]::int)
  end,
  s.imported_at::date)
from (select org_id, key, regexp_match(coalesce(file_name, ''), '(?:^|\D)(\d{1,2})[-_.](\d{1,2})[-_.](20\d\d)(?:\D|$)') m
      from public.quote_suppliers) d
where d.org_id = s.org_id and d.key = s.key and s.imported_at is not null and s.list_on is null;

update public.quote_price_items i
set listed_on = s.list_on
from public.quote_suppliers s
where s.org_id = i.org_id and s.key = i.supplier_key and i.on_list and i.listed_on is null and s.list_on is not null;

-- a code on both: the invoice's price beside the list's
update public.quote_price_items l
set paid_cents = i.cents,
    paid_on = i.priced_on,
    times_bought = i.times_bought,
    qty_bought = i.qty_bought,
    on_list = l.on_list and l.current,
    current = true
from public.quote_price_items i
where i.org_id = l.org_id and i.code = l.code
  and i.supplier_key = 'mitsubishi_invoiced' and l.supplier_key = 'mitsubishi'
  and i.current;

-- a code only invoiced: Mitsubishi Electric's, priced by what was paid
insert into public.quote_price_items
  (org_id, supplier_key, code, name, cents, previous_cents, price_changed_at, first_seen_at, last_import_at,
   current, uom, times_bought, qty_bought, on_list, paid_cents, paid_on)
select i.org_id, 'mitsubishi', i.code, i.name, i.cents, i.previous_cents, i.price_changed_at, i.first_seen_at, i.last_import_at,
       true, i.uom, i.times_bought, i.qty_bought, false, i.cents, i.priced_on
from public.quote_price_items i
where i.supplier_key = 'mitsubishi_invoiced' and i.current
  and exists (select 1 from public.quote_suppliers s where s.org_id = i.org_id and s.key = 'mitsubishi')
  and not exists (select 1 from public.quote_price_items l
                  where l.org_id = i.org_id and l.supplier_key = 'mitsubishi' and l.code = i.code);

-- what pointed at the invoiced supplier points at the supplier
update public.quote_preferred_items p set supplier_key = 'mitsubishi'
where supplier_key = 'mitsubishi_invoiced'
  and not exists (select 1 from public.quote_preferred_items q
                  where q.org_id = p.org_id and q.supplier_key = 'mitsubishi' and q.code = p.code);
delete from public.quote_preferred_items where supplier_key = 'mitsubishi_invoiced';
update public.quote_unit_choices set supplier_key = 'mitsubishi' where supplier_key = 'mitsubishi_invoiced';
-- a same-item pair between the two is one supplier's own code now
delete from public.quote_same_items
where (a_ref like 'mitsubishi_invoiced|%' or b_ref like 'mitsubishi_invoiced|%')
  and replace(a_ref, 'mitsubishi_invoiced|', 'mitsubishi|') = replace(b_ref, 'mitsubishi_invoiced|', 'mitsubishi|');

-- the invoices' file, on the supplier
update public.quote_suppliers s
set invoice_file_name = v.file_name, invoiced_at = v.imported_at, invoice_items = v.item_count
from public.quote_suppliers v
where v.org_id = s.org_id and v.key = 'mitsubishi_invoiced' and s.key = 'mitsubishi';

delete from public.quote_price_items i
where i.supplier_key = 'mitsubishi_invoiced'
  and exists (select 1 from public.quote_suppliers s where s.org_id = i.org_id and s.key = 'mitsubishi');
delete from public.quote_suppliers v
where v.key = 'mitsubishi_invoiced'
  and exists (select 1 from public.quote_suppliers s where s.org_id = v.org_id and s.key = 'mitsubishi');

commit;
