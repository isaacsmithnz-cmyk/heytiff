-- A staff licence becomes a HISTORY too — the same move
-- org_credential_records.sql just made for the business's own papers, and
-- vehicle_policies.sql made for the fleet before that.
--
-- WHY IT IS THE SAME PROBLEM. A driver licence, an ARC ticket and a white card
-- all RENEW: the same ticket comes back with a new expiry, often a new card
-- number, sometimes a new class. Today `staff_licences` holds one number and
-- one expiry, and the Compliance card has no edit at all — the only way to
-- record a renewal is to DELETE the licence and add it again, which throws the
-- old one away and takes its place in the history with it. There is no answer
-- to "was Bob ARC-licensed on the day of that install", which is the question
-- an insurer or a regulator actually asks.
--
-- THE ROW YOU ALREADY HAVE STAYS PUT. `staff_licences` keeps being the card —
-- what kind of ticket it is, its colour — and its `licence_number` and
-- `expiry_date` become a CACHE of the newest term. The dashboard chip
-- (lib/dashboard/query.ts), the Summary wall, the completeness strip and the
-- compliance label all read those two columns and none of them should have to
-- learn about terms.
--
-- THE PREVIOUS TERM IS NOT A SEPARATE STORE. It is an older row. "Current" is
-- the latest expires_on; everything under it is history by construction.
--
-- NO MONEY HERE, unlike the business's policies. A licence renewal has a fee,
-- but reimbursing it is what the expenses screen is for, and a column nobody
-- fills is a column that makes a card look unfinished.
--
-- POSTURE: RLS on with no policies, like every other table here — service-role
-- only, behind the app-layer gates in app/actions/{profile,staff}.ts (your own
-- card is intrinsic; somebody else's needs `team`).
--
-- APPLY THIS BEFORE MERGING THE PR.

create table if not exists public.staff_licence_records (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  licence_id       uuid not null references public.staff_licences (id) on delete cascade,
  -- denormalised so a read can scope to one person without joining, and so a
  -- write can be checked against the caller's own card the way every other
  -- staff write in this codebase is
  staff_profile_id uuid not null,
  -- who issued it: Service NSW, the Australian Refrigeration Council, a RTO
  issuer           text,
  -- the licence or card number AS PRINTED ON THIS CARD. It can change between
  -- terms — a replacement card carries a new number — which is exactly why it
  -- belongs on the term and not only on the licence.
  number           text,
  -- the classes, categories or conditions the ticket authorises, as printed
  -- (e.g. "C, LR" on a driver licence; "Split systems — install and
  -- decommission" on an ARC ticket). As printed; never summarised.
  classes          text,
  -- which jurisdiction issued it. A driver licence is state-issued and the
  -- state is part of the answer to "is this ticket valid for this job".
  issuing_state    text,
  starts_on        date,
  expires_on       date not null,
  -- the scanned document this row was read from; null if entered by hand
  document_id      uuid,
  source           text check (source is null or source in ('scan', 'manual')),
  created_at       timestamptz not null default now()
);

comment on table public.staff_licence_records is
  'One row per term of a staff licence or ticket. The newest expires_on is current; older rows are the history, and staff_licences caches the newest.';

-- The read: one licence's history, newest first.
create index if not exists staff_licence_records_licence_idx
  on public.staff_licence_records (licence_id, expires_on desc);

-- The wall's read: every term one person holds, in one query.
create index if not exists staff_licence_records_staff_idx
  on public.staff_licence_records (org_id, staff_profile_id);

alter table public.staff_licence_records enable row level security;

-- ---------------------------------------------------------------------------
-- The paperwork. `staff_licence_id` is the OWNER (this scan belongs to this
-- ticket); `licence_record_id` is the FILING (it belongs under this term).
-- Same pair the fleet and the org credentials use.
--
-- NO NEW DOCUMENT KIND. `licence` already exists and already means exactly
-- this, and beginUpload already treats it as INTRINSIC — a document about your
-- own right to work is one you must be able to supply yourself, whatever
-- capabilities you hold. Until now nothing owned a `licence` document; these
-- two columns are what finally do.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists staff_licence_id uuid
    references public.staff_licences (id) on delete set null,
  add column if not exists licence_record_id uuid
    references public.staff_licence_records (id) on delete set null;

create index if not exists documents_staff_licence_idx
  on public.documents (staff_licence_id)
  where staff_licence_id is not null;

create index if not exists documents_licence_record_idx
  on public.documents (licence_record_id)
  where licence_record_id is not null;

-- ---------------------------------------------------------------------------
-- REMIND ME, on the same terms as a vehicle's and the business's. A reminder
-- is a TASK (task_reminders.sql), due `lead_days` before the expiry, nudged by
-- the bell that morning and carried in the day's reminder email. It is the
-- VIEWER's own task: your reminder about your own ticket, or a manager's
-- reminder about someone else's, and neither one silences the other.
-- renewal_kind stays NULL — its check names the three vehicle renewals.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists staff_licence_id uuid
    references public.staff_licences (id) on delete cascade;

comment on column public.tasks.staff_licence_id is
  'Set on a staff licence reminder: the ticket whose expiry it counts down to. Null on every other task.';

create index if not exists tasks_staff_licence_idx
  on public.tasks (org_id, staff_licence_id)
  where staff_licence_id is not null and status = 'open';

-- ---------------------------------------------------------------------------
-- Backfill: every licence that already carries an expiry becomes its own first
-- term, so nothing on screen today disappears when the screen starts reading
-- terms. A licence with NO expiry (a white card, which does not lapse) gets no
-- term — there is no period to describe — and the card reads "No expiry",
-- which is what it already says. Re-runnable.
-- ---------------------------------------------------------------------------
insert into public.staff_licence_records
  (org_id, licence_id, staff_profile_id, number, expires_on, source)
select l.org_id, l.id, l.staff_profile_id, nullif(trim(l.licence_number), ''), l.expiry_date, 'manual'
from public.staff_licences l
where l.expiry_date is not null
  and not exists (
    select 1 from public.staff_licence_records r where r.licence_id = l.id
  );
