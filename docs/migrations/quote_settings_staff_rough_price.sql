-- A ROUGH PRICE ON SITE (Isaac, 2026-10-21: "staff members could
-- potentially give a customer a price if they are asking for something while
-- on site. If the owner was like, oh, have you got a rough idea of how much
-- this would be?").
--
-- Whether anyone on a job may ask Tiff for a rough price to say to a
-- customer: a range inc GST, rounded, with no cost, markup or margin in it.
-- Off: only people who see the business's prices get one. Each business
-- decides; nobody's is on until its owner says.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: one new column with a default that
-- nothing reads yet.

alter table public.quote_settings add column if not exists staff_rough_price boolean not null default false;

comment on column public.quote_settings.staff_rough_price is
  'Whether anyone on a job may ask Tiff for a rough, rounded price to give a customer; false: only people who see prices.';
