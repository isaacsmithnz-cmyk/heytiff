-- ALLOWANCES, THE BUSINESS'S OWN (Isaac, 2026-10-04: the install kits —
-- "every part is your item… a dollar figure you set in Quoting").
--
-- What a kit carries that isn't one price-book item: the consumables a head
-- uses (cable, fixings, tape), a new circuit until the electrician prices it,
-- a pipe flush on a swap, and recovering and removing an old system. Each is
-- what it costs the business; the materials markup goes on top, as on any
-- material. Blank: the kit says to set it, and prices nothing for it.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: four new nullable columns nothing
-- reads yet.

alter table public.quote_settings
  add column if not exists consumables_cents integer,
  add column if not exists new_circuit_cents integer,
  add column if not exists flush_cents integer,
  add column if not exists recovery_cents integer;

alter table public.quote_settings drop constraint if exists quote_settings_allowances_check;
alter table public.quote_settings
  add constraint quote_settings_allowances_check check (
    (consumables_cents is null or consumables_cents >= 0)
    and (new_circuit_cents is null or new_circuit_cents >= 0)
    and (flush_cents is null or flush_cents >= 0)
    and (recovery_cents is null or recovery_cents >= 0)
  );

comment on column public.quote_settings.consumables_cents is 'Allowance at cost: consumables per indoor head (cable, fixings, tape). Null: not set.';
comment on column public.quote_settings.new_circuit_cents is 'Allowance at cost: a new circuit from the switchboard, until the electrician prices it. Null: not set.';
comment on column public.quote_settings.flush_cents is 'Allowance at cost: flushing kept pipework on a swap. Null: not set.';
comment on column public.quote_settings.recovery_cents is 'Allowance at cost: recovering the old system''s refrigerant and taking it away. Null: not set.';
