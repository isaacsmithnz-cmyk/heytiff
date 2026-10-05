-- WHAT THE CUSTOMER SEES OF A QUOTE (Isaac, 2026-10-05: "we will just click
-- show line items to customer or leave it off by default so that they just
-- see the total price without being broken down").
--
-- Each business says whether its quotes show the customer their line items
-- by default; each quote can say otherwise. Off: the customer sees each
-- option's total. ServiceM8 can't hide lines, so a business that wants
-- totals only builds its lines elsewhere and types "As per quote" — this is
-- what the send to ServiceM8 will read.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: one new column with a default that
-- nothing reads yet.

alter table public.quote_settings add column if not exists show_lines boolean not null default false;

comment on column public.quote_settings.show_lines is
  'Whether a quote shows the customer its line items by default; false: each option''s total only.';
