-- Job money on the ServiceM8 mirror, and the key that makes a mirrored claim
-- idempotent. Reverses one line of sm8_mirror.sql's doctrine deliberately —
-- see the rewritten paragraph there.
--
-- WHY MONEY IS NOW MIRRORED. The original charter kept every money field out
-- of the mirror on a "less PII is less liability" argument. That argument was
-- about PII; a job's own invoice total is the business's own number, and the
-- Workboard cannot answer "where is the money on this job?" without it. What
-- protects it now is a READ gate, not an absence: capability `workboard_money`
-- (owner-tier, granted per person), enforced by the loaders never selecting
-- these columns for anyone who lacks it.
--
-- NO NEW OAUTH SCOPE. Every column below rides on the Job object under
-- `read_jobs`, which this integration has always held — verified against
-- developer.servicem8.com/reference/listjobs.md, 2026-08-12. We were already
-- receiving these values on every sync page and dropping them in the shaper.
-- The JobPayment endpoint (per-payment records) is deliberately NOT adopted:
-- its scope is `manage_job_payments`, a WRITE scope, and the read-only charter
-- outranks the extra detail. `payment_received` answers paid-or-not, which is
-- the question the board asks.
--
-- STILL DELIBERATELY ABSENT, and the shaper's test pins it: badges (write
-- scope), lat/lng, billing_address, client ABNs, staff email/mobile/GPS, and
-- the four DEPRECATED on-job payment_* detail fields (payment_method,
-- payment_date, payment_amount, payment_note) which ServiceM8's own docs
-- redirect to the JobPayment endpoint.
--
-- TYPING: amounts arrive as STRINGS ("1234.5600") and stay TEXT like every
-- other ServiceM8-native field — parsed to cents at read by
-- parseSm8AmountToCents, never by SQL. Stamps stay naive local strings.
-- Flags are the shaper's coerced integers.
--
-- APPLY THIS BEFORE MERGING THE PR, and run the cursor reset at the bottom:
-- without it the existing 3,446 mirrored jobs keep NULL money until each one
-- happens to be edited in ServiceM8 again.

-- ── the seven columns ──────────────────────────────────────────────────────
alter table public.sm8_jobs
  add column if not exists total_invoice_amount text,
  add column if not exists invoice_sent integer,
  add column if not exists invoice_date text,
  add column if not exists quote_sent integer,
  add column if not exists quote_sent_stamp text,
  add column if not exists payment_received integer,
  add column if not exists payment_received_stamp text;

comment on column public.sm8_jobs.total_invoice_amount is
  'ServiceM8''s own job total, verbatim as a string. Read-only over there. Parse with parseSm8AmountToCents; never sum in SQL.';
comment on column public.sm8_jobs.payment_received is
  'ServiceM8''s full-payment flag (0/1). The whole paid-ness story we mirror — per-payment rows need a write scope.';

-- ── one mirrored claim per (project, job) ──────────────────────────────────
-- project_claims already carried `source` and `remote_ref` for exactly this;
-- what it lacked was the key that makes the upsert idempotent. Two page loads
-- racing the mirror tail would otherwise write the same invoice twice, and a
-- doubled claim overstates what has been claimed — the money equivalent of the
-- job-number trigger that burned 612 numbers in an hour.
--
-- Scoped by project as well as org because the same ServiceM8 job may be
-- linked to two projects (project_jobs allows it and the UI warns rather than
-- refuses); each project then carries its own honest claim row.
--
-- NOT A PARTIAL INDEX, and the reason is load-bearing. The obvious spelling is
-- `where remote_ref is not null`, since only mirrored rows have one. But
-- PostgREST's upsert emits `ON CONFLICT (cols)` with no predicate, and
-- Postgres will not infer a PARTIAL index from that — it fails outright with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". Verified on this database before choosing.
--
-- The full index is safe because NULLS ARE DISTINCT in a unique index by
-- default: every manual claim carries remote_ref = null and therefore never
-- collides with another. Do NOT "tidy" this with NULLS NOT DISTINCT (PG15+) —
-- that would allow exactly one manual claim per project, silently.
create unique index if not exists project_claims_remote_uniq
  on public.project_claims (org_id, project_id, source, remote_ref);

-- ── make the backfill re-read the last 24 months ───────────────────────────
-- The cursor is a max edit_date watermark; clearing it (and un-finishing the
-- backfill) sends the jobs object back through its 24-month window on the next
-- kick. ~4 pages against a 25-page budget, and every row upserts onto its
-- existing primary key, so nothing is lost and nothing duplicates. Only the
-- jobs object is touched; the other eight keep their watermarks.
update public.sm8_sync_state
   set cursor = null,
       backfill_done = false
 where object = 'jobs';
