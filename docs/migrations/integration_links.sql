-- integration_links — "this person here IS that record over there".
--
-- WHAT IT IS FOR: a HeyTiff staff member and a Xero payroll employee are the
-- same human, and something has to hold that fact. This table is the ONLY place
-- that correspondence lives, which is the whole point — the alternative is each
-- feature re-guessing it from names and quietly disagreeing.
--
-- WHY A TABLE AND NOT A `xero_employee_id` COLUMN ON staff_profiles:
--
--   * A link belongs to a TENANT. One authorisation can cover several Xero
--     organisations, and `integration_connections.tenant_id` can be switched.
--     A bare column could not say WHICH Xero org the id came from, so switching
--     org would silently point every person at a stranger's employee record.
--   * A link outlives the connection. Disconnecting deletes the connection row
--     (and its tokens); these rows stay, so reconnecting to the same tenant
--     brings back every human-confirmed match instead of asking for all of them
--     again.
--   * The next kind is a row, not a migration — suppliers→contacts, and
--     whatever a second provider needs, are `kind` values.
--
-- THE TWO UNIQUE INDEXES ARE THE "ONE SOURCE OF TRUTH" RULE, MADE STRUCTURAL.
-- One link per person per (provider, kind, tenant), AND one per remote record.
-- The second is the one that matters: without it two staff could both claim the
-- same Xero employee, and every later sync would have two answers to "whose
-- hours are these?" — a disagreement no amount of careful app code fixes.
--
-- NOTHING HERE IS MONEY. `remote_label` is a display name captured at link
-- time so an unlinked-in-Xero row can still say who it was. Wages, rates and
-- pay-template figures are never stored here — they are read live, behind the
-- `financials` gate, and shown as drift.
--
-- POSTURE: RLS on with NO policies, like every table here — the anon and
-- authenticated keys read nothing, and every access goes through the
-- service-role client behind an app-layer gate (src/app/actions/xero-links.ts,
-- `financials`).
--
-- APPLY THIS BEFORE MERGING THE PR.

create table if not exists public.integration_links (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  provider           text not null,                      -- 'xero'
  kind               text not null,                      -- 'payroll_employee' is the only kind today
  -- WHICH Xero organisation the remote id belongs to. Every read filters on
  -- this, so switching the connection's active tenant parks these links rather
  -- than mis-applying them.
  tenant_id          text not null,

  -- The HeyTiff side. Nullable because a later `kind` may link the ORG to
  -- something rather than a person; the check constraint below keeps today's
  -- only kind honest.
  staff_profile_id   uuid,

  remote_id          text not null,                      -- Xero EmployeeID
  -- Display only, captured at link time: never read as data, never money.
  remote_label       text,

  -- 'auto' = a suggestion the person accepted, 'manual' = picked by hand.
  -- Both are human decisions; the distinction is provenance, not confidence.
  matched_by         text not null check (matched_by in ('auto', 'manual')),

  linked_by_user_id  text,
  linked_at          timestamptz not null default now(),
  updated_at         timestamptz,

  -- The house pattern: the child carries org_id and the FK is COMPOSITE, so a
  -- row structurally cannot point at another org's person.
  constraint integration_links_staff_fkey
    foreign key (staff_profile_id, org_id)
    references public.staff_profiles(id, org_id) on delete cascade,

  constraint integration_links_kind_subject
    check (kind <> 'payroll_employee' or staff_profile_id is not null)
);

-- One link per person, per provider+kind, per Xero organisation.
create unique index if not exists integration_links_subject_uniq
  on public.integration_links (org_id, provider, kind, tenant_id, staff_profile_id)
  where staff_profile_id is not null;

-- One HeyTiff claimant per remote record. Two people claiming one Xero employee
-- is the exact "two systems fighting" failure this table exists to prevent.
create unique index if not exists integration_links_remote_uniq
  on public.integration_links (org_id, provider, kind, tenant_id, remote_id);

alter table public.integration_links enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)
