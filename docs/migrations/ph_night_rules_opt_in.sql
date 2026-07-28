-- The public-holiday and night rules become REAL, so existing orgs get to
-- choose them rather than inherit them. APPLIED 2026-07-28.
--
-- WHY A MIGRATION AT ALL. Both rules shipped defaulted ON and were never
-- applied by `splitDay` — so every workspace is carrying `ph.on = true` and
-- `night.on = true` that has never moved a cent (audit issue #203). The
-- moment the engine honours them, those stored trues would start paying:
-- 2× on any worked public holiday, and 2× on every hour before 6 AM. Trades
-- start early. A 5:30 AM start would quietly become half an hour of double
-- time, every day, on a wage bill nobody agreed to change.
--
-- Fixing a bug must not raise somebody's payroll behind their back. So both
-- rules are switched OFF here, keeping their rate/up so flipping one back on
-- in Time & Pay settings restores exactly what the screen already promised.
-- The settings screen is where that choice belongs, and it now means it.
--
-- The object merge (rather than jsonb_set) is deliberate: jsonb_set can't
-- create a missing intermediate key, and a rules blob that predates either
-- rule would otherwise be left without one — which reads as the DEFAULT
-- (on) once getPaySettings merges it over DEFAULT_SETTINGS.rules.

update public.pay_settings
   set rules = coalesce(rules, '{}'::jsonb)
             || jsonb_build_object(
                  'ph',    coalesce(rules -> 'ph',    '{}'::jsonb) || '{"on":false}'::jsonb,
                  'night', coalesce(rules -> 'night', '{}'::jsonb) || '{"on":false}'::jsonb
                ),
       updated_at = now();
