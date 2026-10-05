-- Drop the certificate tables nothing uses (2026-10-05).
--
-- No certifier is asked for or printed, and there is no fan list (both
-- removed from the app 2026-10-03), so nothing reads or writes these. Each
-- had 0 rows when dropped, and certifier_profile_id was the only reference
-- to certifier_profiles.

alter table public.certificate_versions drop column if exists certifier_profile_id;
drop table if exists public.certifier_profiles;
drop table if exists public.fan_models;
