-- Right to work becomes a HISTORY of CHECKS — the third and last table of this
-- shape, after vehicle_policies.sql, org_credential_records.sql and
-- staff_licence_records.sql. It is also the one that does NOT copy their rule,
-- and the difference is the whole point of this comment.
--
-- WHY IT IS THE SAME PROBLEM. `staff_profiles` holds one status, one visa type,
-- one expiry, one hours condition and one check date. Recording this year's
-- check overwrites last year's, so there is no answer to "what did we check,
-- and what did it say, on the day we put this person on that site" — which,
-- under the employer-sanction provisions of the Migration Act, is precisely the
-- question an employer is expected to be able to answer. A licence history is
-- convenient; this one is the evidence.
--
-- WHY "CURRENT" IS A DIFFERENT RULE HERE, and this is the important part:
--
--   A LICENCE'S CURRENT TERM IS THE LATEST EXPIRY. You hold the old card and
--   the new one, and the one that runs longest is the one that governs.
--
--   WORK RIGHTS' CURRENT RECORD IS THE LATEST CHECK. Status can go BACKWARDS —
--   a substantive visa lapses to a bridging visa, full rights become
--   conditional, a visa is cancelled — and the most recent thing the employer
--   actually verified is what they are entitled to rely on. Sorting by expiry
--   would let a stale record from 2024 with a longer date silently outrank a
--   check made this morning that says the person can no longer work.
--
-- SO `checked_on` IS THE SPINE, not `expires_on`, and it is NOT NULL for the
-- same reason: a record nobody can date is not evidence of anything.
--
-- AND `expires_on` IS NULLABLE, unlike every other table of this shape. An
-- Australian citizen and a permanent resident have full work rights and NO
-- expiry (lib/staff/work-rights.ts::isNoVisa, and the card unmounts the visa
-- block for them). That is the majority case, not an edge one.
--
-- POSTURE: RLS on with no policies. Enforcement is app-layer: your own record
-- is intrinsic, someone else's needs `team` — the same gate the rest of the
-- staff card carries, chosen deliberately over a tighter one so that the tab
-- appears for exactly the admins who can already open the card.
--
-- APPLY THIS BEFORE MERGING THE PR.

create table if not exists public.staff_work_rights_records (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  staff_profile_id uuid not null,
  -- one of lib/staff/work-rights.ts::WORK_RIGHTS, as it stood when checked
  status           text not null,
  -- the visa as the grant names it ("482 TSS", "Student 500"). Null for a
  -- citizen or permanent resident, who hold no visa at all.
  visa_type        text,
  -- the work limitation as printed ("No work limitation", "48 hours per
  -- fortnight"). As printed; never summarised into a number.
  hours_condition  text,
  -- inclusive last day the entitlement is valid. NULL = does not expire, which
  -- is the citizen and permanent-resident case and not a missing value.
  expires_on       date,
  -- WHEN THE EMPLOYER ESTABLISHED THIS. The spine of the table: the newest
  -- checked_on is the record in force, and it is what the evidence is dated by.
  checked_on       date not null,
  -- how it was established: a VEVO entitlement check, a scanned grant notice,
  -- or somebody typing what they were shown
  source           text check (source is null or source in ('vevo', 'scan', 'manual')),
  -- the grant notice or VEVO printout this row was read from
  document_id      uuid,
  created_at       timestamptz not null default now()
);

comment on table public.staff_work_rights_records is
  'One row per time an employer established a person''s right to work. The newest checked_on is current — NOT the latest expiry, because status can go backwards and the most recent check is what may be relied on.';

-- The read: one person's checks, newest first.
create index if not exists staff_work_rights_records_staff_idx
  on public.staff_work_rights_records (org_id, staff_profile_id, checked_on desc);

alter table public.staff_work_rights_records enable row level security;

-- ---------------------------------------------------------------------------
-- The evidence. `work_rights` has been a DocumentKind since the documents
-- track was built and `beginUpload` has always treated it as intrinsic — a
-- document about your own right to work is one you must be able to supply
-- whatever capabilities you hold. NOTHING HAS EVER OWNED ONE. These two
-- columns are what finally do, exactly as staff_licence_records.sql did for
-- the `licence` kind.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists work_rights_staff_id uuid,
  add column if not exists work_rights_record_id uuid
    references public.staff_work_rights_records (id) on delete set null;

create index if not exists documents_work_rights_staff_idx
  on public.documents (work_rights_staff_id)
  where work_rights_staff_id is not null;

create index if not exists documents_work_rights_record_idx
  on public.documents (work_rights_record_id)
  where work_rights_record_id is not null;

-- ---------------------------------------------------------------------------
-- REMIND ME, on the same terms as everything else of this shape: a reminder is
-- a TASK, due `lead_days` before the expiry, nudged by the bell that morning
-- and carried in the day's reminder email. It is the VIEWER's own.
--
-- Keyed on the PERSON, not on a record, because unlike a licence the thing you
-- want warning about is "this person's right to work", which survives the
-- record that currently describes it.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists work_rights_staff_id uuid;

comment on column public.tasks.work_rights_staff_id is
  'Set on a work-rights reminder: the person whose visa expiry it counts down to. Null on every other task.';

create index if not exists tasks_work_rights_idx
  on public.tasks (org_id, work_rights_staff_id)
  where work_rights_staff_id is not null and status = 'open';

-- ---------------------------------------------------------------------------
-- Backfill: everyone whose card already carries a status becomes their own
-- first record, so nothing on screen today disappears when the screen starts
-- reading records.
--
-- `checked_on` is NOT NULL and we must not invent one, so this carries the
-- check date the card already holds and, where there is none, falls back to
-- the day the staff card was created — with `source` left NULL, which is this
-- table's way of saying "nobody recorded how this was established". A row that
-- claimed to be a VEVO check that never happened would be worse than no row.
--
-- Someone with no status at all gets no record: there is nothing to describe,
-- and the compliance chip already reads that as "not set up yet" rather than
-- as a finding. Re-runnable.
-- ---------------------------------------------------------------------------
insert into public.staff_work_rights_records
  (org_id, staff_profile_id, status, visa_type, hours_condition, expires_on, checked_on, source)
select
  p.org_id,
  p.id,
  trim(p.work_rights_status),
  nullif(trim(p.visa_type), ''),
  nullif(trim(p.hours_condition), ''),
  p.visa_expiry,
  coalesce(p.vevo_checked_at, p.created_at::date, current_date),
  case when p.vevo_checked_at is not null then 'vevo' else null end
from public.staff_profiles p
where coalesce(trim(p.work_rights_status), '') <> ''
  and not exists (
    select 1 from public.staff_work_rights_records r where r.staff_profile_id = p.id
  );
