-- time_entries.leave_request_id — which booking paid this day.
-- APPLY THIS BEFORE MERGING THE PR (leave↔timesheet lifecycle).
--
-- WHY A COLUMN AND NOT A JOIN
-- The integration audit's central leave finding: a materialised leave day in
-- time_entries and the leave_requests row that paid for it had NO link — not
-- a foreign key, not a shared id, nothing. Every later disagreement (a
-- cancelled booking whose day kept paying, a day entered with no booking at
-- all) was structurally unfindable. This column is the provenance: submit
-- stamps each leave-sourced row with the request the presumption spread onto
-- that date. Hand-entered days carry NULL — and since the saveDay whitelist
-- (PR #182) the only kinds a hand can enter are work and off, so a
-- leave/sick row with a NULL provenance is itself a red flag a later audit
-- query can hunt for.
--
-- ON DELETE SET NULL, not CASCADE: a time entry is a record of what was paid.
-- If a request row is ever hard-deleted the day should survive and show as
-- unprovenanced, not silently vanish from a frozen sheet.

alter table public.time_entries
  add column if not exists leave_request_id uuid
    references public.leave_requests (id) on delete set null;

-- reverse lookups: "which days did this booking put on sheets" — partial,
-- because almost every row is a plain worked day with NULL here
create index if not exists time_entries_leave_request_idx
  on public.time_entries (org_id, leave_request_id)
  where leave_request_id is not null;
