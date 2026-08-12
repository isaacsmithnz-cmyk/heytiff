-- Medical certificates on a leave request.
--
-- APPLY BEFORE MERGE. Both columns are additive and nullable, and every reader
-- falls back to "no threshold, no certificate", so nothing breaks if this lands
-- late — but until it is applied, an attached certificate silently fails to
-- adopt and the settings stepper fails to persist.
--
-- WHY THIS EXISTS: the approver's screen has always carried a bullet reading
-- "confirm a certificate if required" on a sick day, and until now the word
-- `certificate` appeared in exactly one source file — that bullet. There was no
-- field, nothing to upload and nothing that recorded one. The prompt was the
-- whole mechanism.

-- ── the file ──────────────────────────────────────────────────────────────
-- A hard column on `documents`, exactly like `notice_id` and
-- `expense_claim_id`: an owner a foreign key can protect, rather than a
-- (type, id) pair nothing checks. Upload-then-adopt, the same three steps the
-- expense receipt uses — the bytes go straight to storage against a signed
-- slot, and the request claims the row on submit.
alter table public.documents
  add column if not exists leave_request_id uuid;

create index if not exists documents_leave_request_idx
  on public.documents (leave_request_id)
  where leave_request_id is not null;

-- The row goes when the request does. A certificate belongs to the request it
-- was given for and has no life of its own — `on delete cascade` rather than
-- `set null`, which is the difference between this and a receipt: an orphaned
-- receipt is a docket somebody may still want, an orphaned medical certificate
-- is health information nobody is looking after.
alter table public.documents
  drop constraint if exists documents_leave_request_fkey;
alter table public.documents
  add constraint documents_leave_request_fkey
  foreign key (leave_request_id)
  references public.leave_requests (id) on delete cascade;

-- ── when one is expected ──────────────────────────────────────────────────
-- NULL = never ask, which is what every existing org gets, so nobody wakes up
-- to a new warning on a form they were already using. A number is the count of
-- WORKING days at or above which personal leave should carry one — 2 is the
-- usual reading of "two or more consecutive days" and what most AU workplaces
-- run. 1 means always.
--
-- It is a PROMPT, never a gate. A person is often not holding the certificate
-- at the moment they book, and a workspace that blocked the request would push
-- the absence off the books entirely rather than get the document sooner.
alter table public.pay_settings
  add column if not exists certificate_after_days smallint;

alter table public.pay_settings
  drop constraint if exists pay_settings_cert_days_range;
alter table public.pay_settings
  add constraint pay_settings_cert_days_range
  check (certificate_after_days is null or certificate_after_days between 1 and 14);
