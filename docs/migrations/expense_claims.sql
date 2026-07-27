-- expense_claims — money a staff member spent from their own pocket, and
-- wants back.
--
-- SCOPE, because "expenses" is an overloaded word. This is REIMBURSEMENT: the
-- apprentice who bought a drill bit on the way to a job. It is NOT the
-- business's own bills — those live in Xero and the Rate Calculator reads them
-- as overheads. The two never mix: a reimbursement is owed to a person, an
-- overhead is owed to a supplier.
--
-- SHAPE: deliberately the same one as leave_requests, because it is the same
-- object — something a staff member submits, somebody with `approvals`
-- decides, and which then has an outcome. Copying the shape means copying the
-- rules that are already proven (self-review refused, decline needs a reason,
-- own-row cancel), rather than inventing a second approval model that drifts.
--
-- NO DRAFT STATUS. A claim is one screen with the receipt attached, so it is
-- born `pending`; `cancelled` covers regret while it is still undecided. A
-- draft would be a row nobody is waiting on, which is just a lost receipt.
--
-- 'reimbursed' IS A SEPARATE ACT from 'approved', gated on `financials` rather
-- than `approvals`. Approving says the spend was legitimate; reimbursing says
-- the money actually moved. A manager can do the first without ever touching
-- the payroll — which is the same split docs/roles-and-permissions.md draws
-- when it says approvers see amounts but never pay rates.
--
-- POSTURE: RLS on with NO policies, like every table here. Enforcement is
-- app-layer in src/app/actions/expenses.ts.
--
-- APPLY THIS BEFORE MERGING THE PR.

create table if not exists public.expense_claims (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  staff_profile_id uuid not null,

  expense_date     date not null,
  description      text not null,
  category         text not null
                     check (category in ('materials', 'tools', 'travel', 'meals', 'other')),

  -- numeric, not float: this is money somebody is owed, and 0.1 + 0.2 is not
  -- an acceptable answer to "how much".
  amount           numeric(10, 2) not null check (amount > 0),
  -- Nullable on purpose: plenty of small receipts have no GST line, and
  -- guessing one-eleventh would be inventing a tax figure.
  gst_amount       numeric(10, 2) check (gst_amount >= 0),
  supplier         text,

  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'declined', 'reimbursed', 'cancelled')),

  review_note      text,
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  reimbursed_by    uuid,
  reimbursed_at    timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz,

  -- The house pattern: the child carries org_id and the FK is COMPOSITE, so a
  -- claim structurally cannot belong to another org's person.
  constraint expense_claims_staff_fkey
    foreign key (staff_profile_id, org_id)
    references public.staff_profiles(id, org_id) on delete cascade
);

-- The two reads this table gets: "my claims" and "everything waiting on me".
create index if not exists expense_claims_staff_idx
  on public.expense_claims (org_id, staff_profile_id);
create index if not exists expense_claims_status_idx
  on public.expense_claims (org_id, status);

alter table public.expense_claims enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)

-- ---------------------------------------------------------------------------
-- The receipt. Same upload-then-claim pattern as notice attachments: the file
-- is uploaded first (it has to be, to be scanned), then adopted by the claim
-- on submit. A hard column rather than a polymorphic owner, exactly like
-- documents.notice_id — the alternative is a (type, id) pair no foreign key
-- can protect.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists expense_claim_id uuid;

create index if not exists documents_expense_claim_idx
  on public.documents (expense_claim_id)
  where expense_claim_id is not null;
