-- ── one supplier, two sources of price (2026-10-05) ──
-- A supplier is one heading. Its prices come in two ways: its PRICE LIST
-- (net, or list less the business's discount) and its INVOICES (what the
-- business actually paid, net, on a date). Isaac: Mitsubishi Electric's VRF
-- indoors are quoted, never listed, so the invoices are how they get a
-- price — under Mitsubishi Electric, not a second supplier.
--
-- One row per supplier + code still. `cents` is the price list's price as
-- the list states it; `paid_cents` / `paid_on` the latest invoice. A code
-- only ever invoiced has on_list = false. The newer of the two prices is the
-- one a quote takes (lib/quotes/price-book.ts, effectiveRow): a price list's
-- prices are dated `listed_on` (the supplier's "prices from" date, else the
-- day it was uploaded), an invoice's by its own date. An invoice only ever
-- updates the codes on it; a new price list never drops an invoiced price.
alter table public.quote_price_items add column if not exists on_list boolean not null default true;
alter table public.quote_price_items add column if not exists listed_on date;
alter table public.quote_price_items add column if not exists paid_cents integer;
alter table public.quote_price_items add column if not exists paid_on date;

alter table public.quote_suppliers add column if not exists list_on date;
alter table public.quote_suppliers add column if not exists invoice_file_name text;
alter table public.quote_suppliers add column if not exists invoiced_at timestamptz;
alter table public.quote_suppliers add column if not exists invoice_items integer;
