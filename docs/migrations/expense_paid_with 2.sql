-- Expenses: whose money, and the receipt that has to be kept either way.
--
-- THE PROBLEM. `expense_claims` was scoped to REIMBURSEMENT and said so in as
-- many words: money a staff member spent from their own pocket and wants back,
-- explicitly not the business's own bills. That scope has a hole in it the
-- size of the company credit card. An apprentice buys a drill on the card and
-- there is nowhere in this app to put the docket: it is not a claim, because
-- nobody owes them anything, and it is not one of the bills that live in Xero
-- either — Xero will see a card transaction from the bank feed with no
-- receipt, no description and no category against it. The one person holding
-- the paper is standing in a trade counter with a phone, which is exactly the
-- spend this table exists to catch (Isaac, 2026-08-23).
--
-- WHAT THIS ADDS. A row now records WHO PAID. `own` is everything the table has
-- ever held and keeps the whole approval machine; `company` is a RECORD rather
-- than a claim — the money has already left the business account, so there is
-- nothing to approve and nothing to pay.
--
-- THE PRECEDENT IS FUEL. `vehicle_logs.paid_with` answers the same question
-- for the same reason (docs/migrations/fuel_paid_with.sql), and the tax screen
-- already reads company-paid fuel. A card receipt captured on a phone is the
-- same kind of fact; it belongs in the same report.
--
-- POSTURE: RLS on with no policies, unchanged. Enforcement stays app-layer in
-- src/app/actions/expenses.ts.
--
-- APPLY THIS BEFORE MERGING THE PR.

-- ── 1. whose money ────────────────────────────────────────────────────────
-- NOT NULL with a default, unlike the fuel column, and the difference is
-- deliberate: on vehicle_logs a null meant "logged before anyone was asked",
-- because the company paying was only an assumption. Here every existing row
-- is a reimbursement by definition — the table has never held anything else —
-- so backfilling them to 'own' states a fact rather than guessing one.
alter table public.expense_claims
  add column if not exists paid_with text not null default 'own'
    check (paid_with in ('own', 'company'));

-- ── 2. a status for a thing nobody has to decide ──────────────────────────
-- The constraint is replaced rather than altered — Postgres has no ADD VALUE
-- for a check — and named so the next change can find it, the same way the
-- category constraint was handled.
--
-- 'recorded' is terminal except for 'cancelled', which its author may still
-- reach: a card receipt entered against the wrong purchase has to be
-- withdrawable by the person who entered it, and nothing else in this app can
-- remove it. It never becomes 'approved' or 'reimbursed'; the transition table
-- in lib/expenses/claim.ts refuses both, so an approver pressing a button on
-- one is a refusal rather than a payment for money that never left anybody.
alter table public.expense_claims
  drop constraint if exists expense_claims_status_check;
alter table public.expense_claims
  add constraint expense_claims_status_check
    check (status in ('pending', 'approved', 'declined', 'reimbursed', 'cancelled', 'recorded'));

-- ── 3. a company record can never be a fuel reimbursement ─────────────────
-- `vehicle_log_id` is the back-pointer from the reimbursement half of a
-- personally-funded tank — "Log fuel · my own money". A company-paid row by
-- definition has no reimbursement half, and the tax read skips any claim
-- carrying a log id, so a company row that somehow carried one would vanish
-- from the report it is the whole point of. Refuse the combination outright.
alter table public.expense_claims
  drop constraint if exists expense_claims_company_no_fuel_log;
alter table public.expense_claims
  add constraint expense_claims_company_no_fuel_log
    check (paid_with = 'own' or vehicle_log_id is null);

-- ── 4. the reads this adds ────────────────────────────────────────────────
-- "My company-card receipts" is its own face on the Me card, and it is the
-- only read that filters on paid_with.
create index if not exists expense_claims_paid_with_idx
  on public.expense_claims (org_id, staff_profile_id, paid_with);

-- ── 5. what it was bought FOR ─────────────────────────────────────────────
-- A receipt for a job is a cost on that job, and the app knew it for the two
-- seconds the person was holding the docket and then forgot. Optional on
-- purpose: plenty of spend belongs to the business rather than to any one job
-- — a new drill is the van's, not Tuesday's — and forcing a pick would either
-- stop the capture or fill the column with the wrong answer (Isaac,
-- 2026-08-23).
--
-- BOTH KINDS CARRY IT. The question "which job" has nothing to do with whose
-- card paid: materials for Northgate bought on a personal card are the same
-- cost on the same job. A rule that applied to one and not the other would be
-- a second thing to remember and a hole to fall through.
--
-- THE SHAPE IS `workboard_notes.target_kind` / `target_id`, with its
-- vocabulary intact, because it is the same act — pointing a captured thing at
-- work. Renamed to job_* here only because on THIS table the thing being
-- pointed at is unambiguously a job, and `target` would be vaguer than the
-- fact. Polymorphic, so no foreign key is possible; the server action resolves
-- the row itself and refuses an id it cannot find in this org.
alter table public.expense_claims
  add column if not exists job_kind text not null default 'none'
    check (job_kind in ('none', 'project', 'visit', 'agreement'));
alter table public.expense_claims
  add column if not exists job_id uuid;

-- A kind without an id is a link to nothing, and an id without a kind is an id
-- nobody can look up. Neither is a state worth reading code for.
alter table public.expense_claims
  drop constraint if exists expense_claims_job_link_check;
alter table public.expense_claims
  add constraint expense_claims_job_link_check
    check ((job_kind = 'none') = (job_id is null));

-- THE LABEL IS A SNAPSHOT, and deliberately not a join. Same call
-- job_picklist_items.sql makes and for a sharper reason: what this row records
-- is which job the money was spent on AT THE TIME, and re-deriving it from a
-- job that has since been renamed would rewrite history under the person who
-- filed it. `job_id` stays the truth for anything costing the job; this is
-- what the screen prints.
--
-- It is also the read that would otherwise cost three joins across
-- maintenance_visits, maintenance_agreements and projects on a list where most
-- rows now have a job — unlike the fuel back-pointer beside it, which is rare
-- enough to resolve on demand.
alter table public.expense_claims
  add column if not exists job_label text;

-- Job costing reads this: everything spent on one job, whoever paid.
create index if not exists expense_claims_job_idx
  on public.expense_claims (org_id, job_kind, job_id)
  where job_id is not null;
