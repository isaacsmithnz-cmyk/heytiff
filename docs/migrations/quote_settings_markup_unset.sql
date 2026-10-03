-- A MARKUP NOBODY SET IS NOT SET (Isaac, 2026-10-04: "whatever you build has
-- to be usable universally by a completely new org… price books etc have to
-- be injected by its own org").
--
-- The markups defaulted to 20/40 here and 25/40 in code: one business's
-- figures handed to every new one. Now a business with no markup has none,
-- and the Quoting page says so, until it sets its own.
--
-- The business that had been running on the code's 25/40 without a row gets
-- that row first, so nothing it sees changes.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: the code before it reads a null
-- markup as its own 25/40.

alter table public.quote_settings
  alter column unit_markup_pct drop not null,
  alter column unit_markup_pct drop default,
  alter column material_markup_pct drop not null,
  alter column material_markup_pct drop default;

-- Diamond Air: what it has quoted on (DEFAULT_QUOTE_SETTINGS, 2026-09-30),
-- now its own.
insert into public.quote_settings (org_id, unit_markup_pct, material_markup_pct, day_hours, preferred)
values ('91e33ca2-4847-408d-8ec5-c7cc0fa7a576', 25, 40, 8, '{}'::jsonb)
on conflict (org_id) do nothing;
