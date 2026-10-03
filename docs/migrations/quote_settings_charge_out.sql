-- THE BUSINESS'S DAY: its charge-out rate times its working hours (Isaac,
-- 2026-10-04: "Day rate only the charge out rate by set work hours… there
-- are to be no made up figures. Everything has to come from the orgs own
-- settings" — and "make sure that you can set the rate without completing
-- the rate calc").
--
-- Both are set on the Quoting page. Left blank, a quote takes them from the
-- business's Rate Calculator (the rate it charges, else the one it
-- recommends; its working hours). Neither set anywhere: no cost, no hours.
--
-- day_hours loses its default of 8, and Diamond Air's row loses the 8 it
-- was given from that default on 2026-10-04 (quote_settings_markup_unset),
-- so it reads its Rate Calculator's own working hours instead.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: the code before it reads a null
-- day_hours as its own 8, and doesn't read charge_out_cents.

alter table public.quote_settings
  add column if not exists charge_out_cents integer,
  alter column day_hours drop not null,
  alter column day_hours drop default;

alter table public.quote_settings
  drop constraint if exists quote_settings_charge_out_cents_check;
alter table public.quote_settings
  add constraint quote_settings_charge_out_cents_check check (charge_out_cents is null or charge_out_cents > 0);

comment on column public.quote_settings.charge_out_cents is
  'The install charge-out rate, cents an hour, as set on the Quoting page. Null: the Rate Calculator''s.';
comment on column public.quote_settings.day_hours is
  'The working day, hours, as set on the Quoting page. Null: the Rate Calculator''s working hours.';

update public.quote_settings set day_hours = null
where org_id = '91e33ca2-4847-408d-8ec5-c7cc0fa7a576' and day_hours = 8;
