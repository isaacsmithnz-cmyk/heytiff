/* The sync engine's pure half — every decision that can be wrong in an
   interesting way, kept out of the HTTP/database plumbing so jest can hold it
   still (the drift.ts / drift-sweep.ts split, applied to ServiceM8).

   THE OBJECT LIST IS DATA. Each entry names its endpoint, its scope and its
   shaping function, so one wrong endpoint 404s into that object's own
   last_error instead of ending the sweep, and a 403 can say WHICH grant to
   reconnect for. Order matters only for coherence — names land before the
   jobs that reference them — never for correctness: no mirror FKs another,
   which is what lets walkOrderFor rotate a run's start mid-backfill.

   TIME IS TEXT HERE. ServiceM8 timestamps are naive local strings in the
   account's timezone ('YYYY-MM-DD HH:MM:SS') with '0000-00-00 00:00:00' as
   the null sentinel. They sort lexicographically, so the cursor is just the
   max string seen — and the one place arithmetic happens (the gt-only
   operator forces a one-second overlap) parses as UTC, subtracts, and
   reformats WITHOUT any timezone conversion, because the zone cancels out. */

export type Sm8ObjectName =
  | "companies"
  | "company_contacts"
  | "jobs"
  | "job_contacts"
  | "job_activities"
  | "job_checklists"
  | "attachments"
  | "staff"
  | "categories"
  | "queues";

type Raw = Record<string, unknown>;
export type MirrorRow = Record<string, string | number | null>;

export type Sm8ObjectSpec = {
  object: Sm8ObjectName;
  /** Exact endpoint file under /api_1.0/ — verified per reference page. */
  endpoint: string;
  table: string;
  /** The scope that powers it, for the 403 "reconnect to grant X" note. */
  scope: string;
  /** What the screen calls it. */
  label: string;
  /** Months of history the first pull reaches back; null = everything. */
  backfillMonths: number | null;
  /** Raw API row → mirror columns. Null when the row is unusable (no uuid) —
      dropped, never allowed to abort a page. */
  shape: (row: Raw) => MirrorRow | null;
};

/* ── field coercers — the whole zero-trust boundary in four functions ── */

/** Text fields: strings pass through, empty becomes null, anything else null. */
export function textOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return v === "" ? null : v;
}

/** Date/timestamp fields: as textOrNull, plus ServiceM8's zero sentinel
    ('0000-00-00…', and the zero DATE '0000-00-00') becomes null. */
export function dateOrNull(v: unknown): string | null {
  const s = textOrNull(v);
  if (!s) return null;
  return s.startsWith("0000-") ? null : s;
}

/** Integer flags (active, sort_order): numbers truncate, numeric strings
    parse, anything else nulls — a malformed flag degrades one field, it does
    not kill a 1000-row upsert. */
export function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return null;
}

function uuidOf(row: Raw): string | null {
  const u = row.uuid;
  return typeof u === "string" && u.length > 0 ? u : null;
}

/* ── per-object shapes ── */

const shapeCompany = (r: Raw): MirrorRow | null => {
  const uuid = uuidOf(r);
  if (!uuid) return null;
  return {
    uuid,
    name: textOrNull(r.name),
    address: textOrNull(r.address),
    parent_company_uuid: textOrNull(r.parent_company_uuid),
    is_individual: intOrNull(r.is_individual),
    active: intOrNull(r.active),
    edit_date: dateOrNull(r.edit_date),
  };
};

const contactShape = (parentKey: "company_uuid" | "job_uuid") =>
  (r: Raw): MirrorRow | null => {
    const uuid = uuidOf(r);
    if (!uuid) return null;
    return {
      uuid,
      [parentKey]: textOrNull(r[parentKey]),
      first: textOrNull(r.first),
      last: textOrNull(r.last),
      email: textOrNull(r.email),
      mobile: textOrNull(r.mobile),
      phone: textOrNull(r.phone),
      type: textOrNull(r.type),
      active: intOrNull(r.active),
      edit_date: dateOrNull(r.edit_date),
    };
  };

const shapeJob = (r: Raw): MirrorRow | null => {
  const uuid = uuidOf(r);
  if (!uuid) return null;
  /* MONEY IS MIRRORED, AND GATED AT READ. The job's own total, the two
     sent-flags and the payment flag ride on this object under `read_jobs` —
     the scope this integration has always held — so they arrive on every page
     whether we keep them or not. Keeping them is what lets the board answer
     "where's the money on this job?"; what protects them is the capability
     `workboard_money`, enforced by loaders that don't SELECT these columns for
     anyone without it. An absence in the mirror was never the safeguard it
     looked like: it protected the columns from the OWNER of the data.

     Still deliberately absent, and the pick list IS that boundary — the test
     below pins it: badges (the only badge scope is a WRITE scope), lat/lng,
     billing_address, and the four DEPRECATED on-job payment detail fields
     (payment_method / payment_date / payment_amount / payment_note), which
     ServiceM8's own docs redirect to the JobPayment endpoint. That endpoint
     stays unadopted: its scope is `manage_job_payments`, a write scope, and
     the read-only charter outranks per-payment detail. `payment_received`
     answers paid-or-not, which is the question the board actually asks.

     Amounts stay TEXT exactly as sent ("1234.5600") like every other
     ServiceM8-native field; parseSm8AmountToCents does the reading. */
  return {
    uuid,
    generated_job_id: textOrNull(r.generated_job_id),
    status: textOrNull(r.status),
    company_uuid: textOrNull(r.company_uuid),
    job_address: textOrNull(r.job_address),
    geo_city: textOrNull(r.geo_city),
    geo_state: textOrNull(r.geo_state),
    geo_postcode: textOrNull(r.geo_postcode),
    category_uuid: textOrNull(r.category_uuid),
    queue_uuid: textOrNull(r.queue_uuid),
    queue_expiry_date: dateOrNull(r.queue_expiry_date),
    queue_assigned_staff_uuid: textOrNull(r.queue_assigned_staff_uuid),
    date: dateOrNull(r.date),
    quote_date: dateOrNull(r.quote_date),
    work_order_date: dateOrNull(r.work_order_date),
    completion_date: dateOrNull(r.completion_date),
    job_description: textOrNull(r.job_description),
    work_done_description: textOrNull(r.work_done_description),
    purchase_order_number: textOrNull(r.purchase_order_number),
    total_invoice_amount: textOrNull(r.total_invoice_amount),
    invoice_sent: intOrNull(r.invoice_sent),
    invoice_date: dateOrNull(r.invoice_date),
    quote_sent: intOrNull(r.quote_sent),
    quote_sent_stamp: dateOrNull(r.quote_sent_stamp),
    payment_received: intOrNull(r.payment_received),
    payment_received_stamp: dateOrNull(r.payment_received_stamp),
    active: intOrNull(r.active),
    edit_date: dateOrNull(r.edit_date),
  };
};

const shapeActivity = (r: Raw): MirrorRow | null => {
  const uuid = uuidOf(r);
  if (!uuid) return null;
  return {
    uuid,
    job_uuid: textOrNull(r.job_uuid),
    staff_uuid: textOrNull(r.staff_uuid),
    start_date: dateOrNull(r.start_date),
    end_date: dateOrNull(r.end_date),
    activity_was_scheduled: intOrNull(r.activity_was_scheduled),
    active: intOrNull(r.active),
    edit_date: dateOrNull(r.edit_date),
  };
};

const shapeChecklist = (r: Raw): MirrorRow | null => {
  const uuid = uuidOf(r);
  if (!uuid) return null;
  return {
    uuid,
    job_uuid: textOrNull(r.job_uuid),
    name: textOrNull(r.name),
    item_type: textOrNull(r.item_type),
    section_name: textOrNull(r.section_name),
    sort_order: intOrNull(r.sort_order),
    completed_timestamp: dateOrNull(r.completed_timestamp),
    completed_by_staff_uuid: textOrNull(r.completed_by_staff_uuid),
    active: intOrNull(r.active),
    edit_date: dateOrNull(r.edit_date),
  };
};

/* Names and titles ONLY. The raw staff object also carries email, mobile,
   lat/lng, navigation state and status messages — none of it is picked, and
   the test asserts the ones that must never appear. */
const shapeStaff = (r: Raw): MirrorRow | null => {
  const uuid = uuidOf(r);
  if (!uuid) return null;
  return {
    uuid,
    first: textOrNull(r.first),
    last: textOrNull(r.last),
    job_title: textOrNull(r.job_title),
    active: intOrNull(r.active),
    edit_date: dateOrNull(r.edit_date),
  };
};

const shapeCategory = (r: Raw): MirrorRow | null => {
  const uuid = uuidOf(r);
  if (!uuid) return null;
  return {
    uuid,
    name: textOrNull(r.name),
    colour: textOrNull(r.colour),
    active: intOrNull(r.active),
    edit_date: dateOrNull(r.edit_date),
  };
};

const shapeQueue = (r: Raw): MirrorRow | null => {
  const uuid = uuidOf(r);
  if (!uuid) return null;
  return {
    uuid,
    name: textOrNull(r.name),
    active: intOrNull(r.active),
    edit_date: dateOrNull(r.edit_date),
  };
};

/* METADATA ONLY, and less than the API sends, deliberately. The raw
   attachment also carries extracted_info (the file's OCR'd text — content,
   not metadata), metadata (free-form JSON), signature_data (signer identity)
   and lat/lng (photo GPS) — none of it is picked, for the same reasons
   sm8_staff drops email and GPS. The bytes themselves are the NEXT PR's lazy
   cache in the documents bucket; a mirror row stays cheap on purpose. The
   test asserts the ones that must never appear. */
const shapeAttachment = (r: Raw): MirrorRow | null => {
  const uuid = uuidOf(r);
  if (!uuid) return null;
  return {
    uuid,
    related_object: textOrNull(r.related_object),
    related_object_uuid: textOrNull(r.related_object_uuid),
    attachment_name: textOrNull(r.attachment_name),
    file_type: textOrNull(r.file_type),
    attachment_source: textOrNull(r.attachment_source),
    tags: textOrNull(r.tags),
    photo_width: intOrNull(r.photo_width),
    photo_height: intOrNull(r.photo_height),
    is_favourite: intOrNull(r.is_favourite),
    created_by_staff_uuid: textOrNull(r.created_by_staff_uuid),
    timestamp: dateOrNull(r.timestamp),
    active: intOrNull(r.active),
    edit_date: dateOrNull(r.edit_date),
  };
};

/* ── the list itself, in sync order ── */

export const SM8_OBJECTS: Sm8ObjectSpec[] = [
  { object: "staff", endpoint: "staff.json", table: "sm8_staff", scope: "read_staff", label: "Staff", backfillMonths: null, shape: shapeStaff },
  { object: "categories", endpoint: "category.json", table: "sm8_categories", scope: "read_job_categories", label: "Categories", backfillMonths: null, shape: shapeCategory },
  { object: "queues", endpoint: "queue.json", table: "sm8_queues", scope: "read_job_queues", label: "Queues", backfillMonths: null, shape: shapeQueue },
  { object: "companies", endpoint: "company.json", table: "sm8_companies", scope: "read_customers", label: "Clients", backfillMonths: null, shape: shapeCompany },
  { object: "company_contacts", endpoint: "companycontact.json", table: "sm8_company_contacts", scope: "read_customer_contacts", label: "Client contacts", backfillMonths: null, shape: contactShape("company_uuid") },
  { object: "jobs", endpoint: "job.json", table: "sm8_jobs", scope: "read_jobs", label: "Jobs", backfillMonths: 24, shape: shapeJob },
  { object: "job_contacts", endpoint: "jobcontact.json", table: "sm8_job_contacts", scope: "read_job_contacts", label: "Job contacts", backfillMonths: 24, shape: contactShape("job_uuid") },
  { object: "job_activities", endpoint: "jobactivity.json", table: "sm8_job_activities", scope: "read_schedule", label: "Schedule", backfillMonths: 24, shape: shapeActivity },
  { object: "job_checklists", endpoint: "jobchecklist.json", table: "sm8_job_checklists", scope: "read_job_checklists", label: "Checklists", backfillMonths: 24, shape: shapeChecklist },
  { object: "attachments", endpoint: "attachment.json", table: "sm8_attachments", scope: "read_job_attachments", label: "Attachments", backfillMonths: 24, shape: shapeAttachment },
];

/** Everything disconnect wipes — the mirrors AND the bookkeeping, because a
    cursor into data we no longer hold is a lie waiting for a reconnect. */
export const SM8_WIPE_TABLES: string[] = [
  ...SM8_OBJECTS.map((s) => s.table),
  "sm8_vendor",
  "sm8_sync_state",
  "sm8_sync_runs",
];

/* ── the order one run walks it ── */

/** The walk order for one run: canonical until some backfill is unfinished,
    then ROTATED to start at the first unfinished object, wrapped so every
    object still appears exactly once.

    WHY A ROTATION EXISTS: PAGE_BUDGET caps a run and cursors move only on
    COMPLETED walks — so a backfill bigger than the budget it inherits
    re-walks the same pages from the same floor every run, and everything
    after it in the list is never reached at all: no mirror rows, no
    sync-state row, not even an error. job_checklists, last in the list, sat
    invisible for two weeks of live runs exactly that way. Starting at the
    first unfinished backfill hands the hungriest object the WHOLE budget —
    any window up to PAGE_BUDGET pages completes in one run — and the start
    advances as backfills finish, so an object can wait runs, never forever.
    All done → canonical order, whose only job is coherence; a rotated run can
    land jobs before the companies they name, and that is the whole cost. */
export function walkOrderFor(backfillDone: ReadonlySet<string>): Sm8ObjectSpec[] {
  const first = SM8_OBJECTS.findIndex((s) => !backfillDone.has(s.object));
  if (first <= 0) return SM8_OBJECTS;
  return [...SM8_OBJECTS.slice(first), ...SM8_OBJECTS.slice(0, first)];
}

/* ── cursor & window arithmetic (naive strings, deliberately) ── */

const SM8_DATE_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** Format a UTC millisecond instant in ServiceM8's naive shape. Only ever
    paired with parseSm8 below — the fake "UTC" reading cancels out. */
export function fmtSm8(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function parseSm8(s: string): number | null {
  const m = SM8_DATE_RE.exec(s);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** One second before the cursor, in the same naive shape. ServiceM8's $filter
    has gt and no ge, so filtering `gt cursor` would skip rows that share the
    cursor's exact second; `gt (cursor − 1s)` re-reads that second instead,
    and idempotent upserts make the re-read free. Null for anything that
    doesn't parse — the caller falls back to the backfill window. */
export function cursorFloor(cursor: string | null | undefined): string | null {
  if (!cursor) return null;
  const ms = parseSm8(cursor);
  if (ms === null) return null;
  return fmtSm8(ms - 1000);
}

/** First-pull floor for a windowed object: `months` back from now. A naive
    string built from UTC "now" can sit up to a timezone-offset away from the
    account's wall clock — irrelevant against a 24-month window, and worth
    zero timezone plumbing. */
export function backfillFloor(nowMs: number, months: number): string {
  const d = new Date(nowMs);
  d.setUTCMonth(d.getUTCMonth() - months);
  return fmtSm8(d.getTime());
}

/** The $filter for this object's next pull, or null for "everything".
    Field name is case-sensitive over there; value quoting happens here so
    the reader can't get it wrong. */
export function filterFor(
  spec: Pick<Sm8ObjectSpec, "backfillMonths">,
  cursor: string | null | undefined,
  nowMs: number
): string | null {
  const floor =
    cursorFloor(cursor) ??
    (spec.backfillMonths !== null ? backfillFloor(nowMs, spec.backfillMonths) : null);
  return floor ? `edit_date gt '${floor}'` : null;
}

/** The next cursor candidate: max edit_date STRING seen, carried across
    pages. Lexicographic max is correct because the format is fixed-width
    big-endian; rows with no readable edit_date simply don't advance it. */
export function maxEditDate(rows: MirrorRow[], seed: string | null): string | null {
  let max = seed;
  for (const r of rows) {
    const d = r.edit_date;
    if (typeof d === "string" && (max === null || d > max)) max = d;
  }
  return max;
}

/* ── the one sentence a failure kind carries ── */

/** ServiceM8's 402, worded. Documented as "Your ServiceM8 account is not in
    good standing" — an EXPIRED TRIAL answers with it too, which is how the
    first live connection here (2026-07-30) spent a morning reading as a
    network fault while the real fix was choosing a plan.

    It lives in the pure module, not beside the other sentences in sm8-read,
    because the ENGINE says it: sm8-read is the module the engine's tests
    replace wholesale for I/O, and a sentence imported from a mock is an
    undefined that quietly falls through to "paused". */
export const SM8_BILLING =
  "ServiceM8 isn't accepting requests for this account — its trial has ended or an invoice is outstanding. Choose a plan in ServiceM8, then sync.";

/* ── run budgets ── */

/** Pages (≤1000 rows each) one run may spend before handing back. Keeps a
    connect-time backfill inside a serverless window; the next kick resumes
    where this one stopped because walkOrderFor starts it at the first
    unfinished backfill and cursors only advance on COMPLETED walks. */
export const PAGE_BUDGET = 25;

/** Self-imposed per-org daily call ceiling — a tenth of ServiceM8's 20k/day
    account cap, so our own worst bug can't eat a customer's real quota. */
export const DAILY_CALL_BUDGET = 2000;

/** Rows per upsert chunk — comfortably under PostgREST payload limits while
    keeping a 1000-row page to three round trips. */
export const UPSERT_CHUNK = 400;

export function chunk<T>(rows: T[], size: number = UPSERT_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
