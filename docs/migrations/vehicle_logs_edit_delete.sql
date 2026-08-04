-- A history entry you can correct.
--
-- THE PROBLEM. vehicle_logs was append-only by omission rather than by
-- design: there was an addLog and nothing else. That was survivable while a
-- log was a fleet fact — a wrong litre count made one economy chip wrong. It
-- stopped being survivable the moment a fuel log started carrying a GST
-- figure and a receipt, because a mistyped docket is now a wrong line in a
-- tax export with a photograph attached to it, and there was no way to fix
-- it. Worse, documents.ts already told the reader that deleting the log was
-- how you released its receipt. There was no delete. That comment is fixed in
-- the same change as this.
--
-- SOFT DELETE, not a real one. These rows back a tax return. A deduction that
-- appeared in an export sent to an accountant in July must not be able to
-- vanish in September with no record that it ever existed — "it's gone" is not
-- an answer anybody can audit. `deleted_at` hides it from every read; the row
-- and its receipt stay.
--
-- WHO, stamped on the row. Own entries plus `assets_all` for anyone's, so the
-- one question a correction raises — who changed this, and when — is answered
-- by the row itself rather than by asking around.
--
-- APPLY THIS BEFORE MERGING THE PR.

alter table public.vehicle_logs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists edited_at  timestamptz,
  add column if not exists edited_by  uuid;

-- Every read filters on deleted_at, so the two indexes that serve those reads
-- become partial. Postgres will use them for the "is null" case and the dead
-- rows stop costing anything to skip.
drop index if exists vehicle_logs_fuel_date_idx;
create index if not exists vehicle_logs_fuel_date_idx
  on public.vehicle_logs (org_id, logged_on)
  where kind = 'fuel' and deleted_at is null;

create index if not exists vehicle_logs_live_idx
  on public.vehicle_logs (org_id, vehicle_id, logged_on desc)
  where deleted_at is null;

-- Note on the ODOMETER. vehicles.odometer is a denormalised high-water mark
-- fed by these logs, so deleting or editing one can leave it wrong. It is
-- recomputed in the action (max reading across the SURVIVING logs) rather than
-- by trying to reverse a delta — the guardrail already refuses any reading
-- below the current one, so the surviving maximum is always the right answer
-- whenever a reading survives at all.
