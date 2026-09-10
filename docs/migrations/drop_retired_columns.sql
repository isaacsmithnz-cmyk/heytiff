-- Twelve columns nothing reads any more, dropped.
--
-- WHAT GOES, AND WHAT REPLACED EACH.
--
--   organizations.arc_rta, .contractor_licence, .insurer, .insurance_policy,
--   .insurance_expiry — the flat licence and insurance fields. The business's
--   licences and policies are cards now (org_credentials.sql), each with a
--   history of terms (org_credential_records.sql). org_credentials.sql
--   planned this drop "once this has been live long enough to trust the
--   backfill".
--
--   staff_profiles.work_rights_doc_url — one link to one work-rights
--   document. Right to work is a history of checks now, each with its own
--   evidence (staff_work_rights_records.sql). The two selects that still
--   named it are removed in the same PR as this file.
--
--   tasks.lead_days, .org_credential_id, .staff_licence_id,
--   .work_rights_staff_id, .vehicle_id, .renewal_kind — what the per-card
--   "Remind me" doors stamped on a task. The doors went in #645, and
--   expiry_reminders_retired.sql closed their open rows but kept these
--   columns for one release, because the code running then still selected
--   them. Nothing on main names them now. Their four partial indexes, two
--   CHECKs and three foreign keys go with them.
--
-- NOTHING IS LOST. Checked against production on 2026-09-10: every one of
-- these is empty except the organisation row's insurer, insurance_policy and
-- insurance_expiry, which hold test typing ("wd", "qwe", 2026-08-13) that
-- matches no card. The real policies are the two cards on the wall.
--
-- APPLY THIS AFTER THE PR'S DEPLOY LANDS, NEVER BEFORE. Until then the
-- running code still selects staff_profiles.work_rights_doc_url, and a
-- dropped column is a 500 on the profile and Team pages.

alter table public.organizations
  drop column if exists arc_rta,
  drop column if exists contractor_licence,
  drop column if exists insurer,
  drop column if exists insurance_policy,
  drop column if exists insurance_expiry;

alter table public.staff_profiles
  drop column if exists work_rights_doc_url;

alter table public.tasks
  drop column if exists lead_days,
  drop column if exists org_credential_id,
  drop column if exists staff_licence_id,
  drop column if exists work_rights_staff_id,
  drop column if exists vehicle_id,
  drop column if exists renewal_kind;
