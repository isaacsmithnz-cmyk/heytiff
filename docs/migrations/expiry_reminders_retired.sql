-- The per-card "Remind me" goes (issue #640, piece 3 of 4).
--
-- WHAT ISAAC DECIDED. One expiry-warning setting for everything
-- (org_expiry_warn.sql), and the five per-card Remind me doors — the
-- business's licences and insurance, staff tickets, work-rights checks, and
-- the fleet's rego / insurance / green slip — are removed. Tiff's "remind me
-- Monday morning" tasks are a SEPARATE feature and are not touched.
--
-- WHAT THIS DOES. Closes the open task rows those doors created. Every one of
-- them carries `lead_days` (30 / 14 / 7 / 0 — the chip that was pressed); a
-- task Tiff made from a note never does. So `lead_days is not null` is the
-- whole test, and a done row keeps its history.
--
-- WHAT THIS DOES NOT DO — YET. The five columns those rows used
-- (`lead_days`, `org_credential_id`, `staff_licence_id`, `work_rights_staff_id`,
-- `vehicle_id` + `renewal_kind`) stay for one release. The code that reads
-- them is deleted in the same PR as this file, but the code RUNNING when
-- this is applied still selects them, and a dropped column is a 500 on the
-- Organisation, profile and fleet pages until the deploy lands. Drop them in
-- the follow-up once nothing on main names them.
--
-- APPLY THIS BEFORE MERGING THE PR.

delete from public.tasks
where status = 'open'
  and lead_days is not null;
