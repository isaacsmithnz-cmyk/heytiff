-- Fuel: whose money bought it, and the reimbursement that follows.
--
-- THE PROBLEM. A fuel docket had exactly one home — a vehicle log — which
-- assumed the business paid. Someone who filled the ute on their own card had
-- no way to get the money back except to file it separately under My expenses,
-- where there was no fuel category either, so it went in as "travel" or
-- "other" and vanished from the tax screen's fuel reporting. Two half-answers,
-- neither of them the whole purchase.
--
-- WHAT THIS ADDS. The fuel log now records WHO PAID, and a personal card also
-- raises an expense claim so the person is reimbursed. The claim points back at
-- the log that raised it.
--
-- ONE PURCHASE, ONE TAX LINE. That back-pointer is load-bearing, not
-- decorative. The tax screen reads BOTH vehicle_logs and expense_claims, so
-- without it a personally-funded tank would appear twice in the same total —
-- once as fuel, once as a staff expense — which is precisely the double count
-- lib/documents/files.ts warns about when it explains why `receipt` and
-- `fuel_receipt` are two document kinds. The vehicle log is the tax line; the
-- claim is only the reimbursement, and the tax read skips any claim carrying a
-- vehicle_log_id.

-- ── 1. whose money ────────────────────────────────────────────────────────
-- Fuel rows only. Nullable rather than defaulted so existing rows stay honest:
-- null means "logged before anyone was asked", not "the company paid".
alter table public.vehicle_logs
  add column if not exists paid_with text
    check (paid_with is null or paid_with in ('company', 'own'));

-- ── 2. fuel is a claimable category ───────────────────────────────────────
-- The constraint is replaced rather than altered — Postgres has no ADD VALUE
-- for a check, and naming it explicitly means the next change can find it.
alter table public.expense_claims
  drop constraint if exists expense_claims_category_check;
alter table public.expense_claims
  add constraint expense_claims_category_check
    check (category in ('materials', 'tools', 'travel', 'meals', 'fuel', 'other'));

-- ── 3. the reimbursement's back-pointer ───────────────────────────────────
-- ON DELETE SET NULL, deliberately: deleting the vehicle log must not delete
-- somebody's reimbursement. The claim survives and starts counting toward tax
-- on its own, which is correct — with the log gone, the claim is the only
-- record of that purchase left.
alter table public.expense_claims
  add column if not exists vehicle_log_id uuid
    references public.vehicle_logs(id) on delete set null;

-- One claim per fuel log. Without this a double-submit raises two
-- reimbursements for one tank, and the tax read would still only skip both.
create unique index if not exists expense_claims_vehicle_log_uidx
  on public.expense_claims (vehicle_log_id)
  where vehicle_log_id is not null;

-- The tax screen's claim read filters on this every time.
create index if not exists expense_claims_tax_idx
  on public.expense_claims (org_id, expense_date)
  where vehicle_log_id is null;
