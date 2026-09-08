-- The business's licences and insurance become a HISTORY, not a field you
-- overwrite — the same move vehicle_policies.sql made for the fleet.
--
-- WHAT ISAAC ASKED FOR: the Licences & insurance section should operate the
-- way the fleet vehicle cards do — scan the document to enter it, and keep the
-- previous ones. Today a renewal is destructive: the policy number, insurer
-- and expiry are three columns on org_credentials, so recording this year's
-- certificate of currency erases last year's, and with it the answer to "what
-- have we paid for public liability since 2022" and "were we covered on the
-- day of that job".
--
-- WHY A TABLE AND NOT MORE COLUMNS. Cost-over-time and "were we covered then"
-- both need ROWS. The columns on org_credentials stay — the dashboard chip,
-- the card wall and lib/dashboard/query.ts's orgInsurance all read them — but
-- they become a DERIVED CACHE of the newest record rather than the only record.
-- Exactly the arrangement vehicles.insurance_expiry has with vehicle_policies.
--
-- THE PREVIOUS VERSION IS NOT A SEPARATE STORE. It is an older row. "Current"
-- is the one with the latest expires_on and everything under it is history by
-- construction — nothing is moved, archived or flagged, so there is no state
-- that can disagree with itself.
--
-- ONE TABLE, BOTH KINDS. A contractor-licence renewal is the same shape as an
-- insurance renewal: a certificate, a period, a cost. org_credentials already
-- holds both kinds in one table for that reason; its records do too.
--
-- premium, excess and sum_insured are NULLABLE and never derived. A licence
-- certificate that does not print a fee must not have one invented, for the
-- same reason fuel GST is never divided out of a total.
--
-- POSTURE: RLS on with no policies, like every other table here — service-role
-- only, behind the app-layer owner gate in app/actions/org-credentials.ts.
--
-- APPLY THIS BEFORE MERGING THE PR.

create table if not exists public.org_credential_records (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  credential_id uuid not null references public.org_credentials (id) on delete cascade,
  -- who it is with: the insurer, or the authority that issued the licence
  issuer        text,
  -- the policy or licence number as printed on THIS certificate. It can change
  -- between terms — a new insurer means a new number — which is precisely why
  -- it belongs on the record and not only on the credential.
  number        text,
  -- what the paper says it covers: the classes of work on a licence, the
  -- interest insured on a policy. As printed; never summarised.
  cover         text,
  -- insurance: the limit of liability (e.g. 20000000). Null on a licence.
  sum_insured   numeric(14, 2) check (sum_insured is null or sum_insured >= 0),
  -- what the term cost, GST inclusive, as printed. Null = the document didn't say.
  premium       numeric(12, 2) check (premium is null or premium >= 0),
  excess        numeric(12, 2) check (excess is null or excess >= 0),
  starts_on     date,
  expires_on    date not null,
  -- the scanned document this row was read from; null if entered by hand
  document_id   uuid,
  source        text check (source is null or source in ('scan', 'manual')),
  created_at    timestamptz not null default now()
);

comment on table public.org_credential_records is
  'One row per term of a business licence or insurance policy. The newest expires_on is current; older rows are the history, and org_credentials caches the newest.';

-- The read: one credential's history, newest first.
create index if not exists org_credential_records_cred_idx
  on public.org_credential_records (credential_id, expires_on desc);

create index if not exists org_credential_records_org_idx
  on public.org_credential_records (org_id);

alter table public.org_credential_records enable row level security;

-- ---------------------------------------------------------------------------
-- The paperwork. `org_credential_id` is the OWNER (this file belongs to this
-- credential); `credential_record_id` is the FILING (it belongs under this
-- term). Same pair vehicle_id/policy_id makes for the fleet, and for the same
-- reason: a certificate filed under the 2026 term is still the credential's
-- file when that term becomes history.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists org_credential_id uuid
    references public.org_credentials (id) on delete set null,
  add column if not exists credential_record_id uuid
    references public.org_credential_records (id) on delete set null;

create index if not exists documents_org_credential_idx
  on public.documents (org_credential_id)
  where org_credential_id is not null;

create index if not exists documents_credential_record_idx
  on public.documents (credential_record_id)
  where credential_record_id is not null;

-- Two new kinds, not one "credential" with a flag. THE KIND IS WHAT STOPS THE
-- WRONG OWNER ADOPTING A FILE: `licence` is a STAFF ticket and must not be
-- adoptable by the company's credential wall, and `insurance_policy` is a
-- VEHICLE policy — filing the business's public liability there would put it
-- on a van's renewal screen. Keep this list and DocumentKind in step;
-- documents_kind_catchup.sql is what happens otherwise.
alter table public.documents drop constraint if exists documents_kind_check;

alter table public.documents add constraint documents_kind_check check (
  kind = any (array[
    'notice_attachment'::text,
    'receipt'::text,
    'fuel_receipt'::text,
    'medical_certificate'::text,
    'licence'::text,
    'work_rights'::text,
    'org_logo'::text,
    'staff_photo'::text,
    'project_file'::text,
    'job_file'::text,
    'purchase_invoice'::text,
    'insurance_policy'::text,
    'rego_notice'::text,
    'green_slip'::text,
    'vehicle_photo'::text,
    'finance_agreement'::text,
    'org_licence'::text,
    'org_insurance'::text,
    'other'::text
  ])
);

-- ---------------------------------------------------------------------------
-- REMIND ME, on the same terms as a vehicle's. A reminder is still a TASK
-- (task_reminders.sql), due `lead_days` before the expiry, nudged that morning
-- by the bell and carried in the day's reminder email. renewal_kind stays NULL
-- on these — its check constraint names the three vehicle renewals, and a
-- business policy is not one of them; org_credential_id is what says what this
-- reminder is about.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists org_credential_id uuid
    references public.org_credentials (id) on delete cascade;

comment on column public.tasks.org_credential_id is
  'Set on a business licence/insurance reminder: the credential whose expiry it counts down to. Null on every other task.';

create index if not exists tasks_org_credential_idx
  on public.tasks (org_id, org_credential_id)
  where org_credential_id is not null and status = 'open';

-- ---------------------------------------------------------------------------
-- Backfill: every credential that already carries an expiry becomes its own
-- first record, so nothing that is on screen today disappears when the screen
-- starts reading records. A credential with NO expiry (an ABN-style licence
-- that doesn't lapse) gets no record — there is no term to describe — and the
-- screen reads it as "no expiry recorded", which is what it already says.
-- `where not exists` keeps this re-runnable.
-- ---------------------------------------------------------------------------
insert into public.org_credential_records
  (org_id, credential_id, issuer, number, expires_on, source)
select c.org_id, c.id, nullif(trim(c.issuer), ''), nullif(trim(c.number), ''), c.expiry_date, 'manual'
from public.org_credentials c
where c.expiry_date is not null
  and not exists (
    select 1 from public.org_credential_records r where r.credential_id = c.id
  );
