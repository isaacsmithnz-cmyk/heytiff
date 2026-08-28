/* The whole book of jobs, loaded once — the flat side of the Workboard.

   ONE LOADER, NO PER-TAB FETCHING, like both boards beside it. The decisions
   about what goes where live in all-jobs.ts (pure, tested); this file only
   fetches, joins the names, and hands over slim rows. The job SHEET fetches
   its own detail on open, so a list of 1,500 never carries 1,500 descriptions
   in full.

   NAMES ARE JOINED IN APP CODE, not SQL. The mirror has no foreign keys by
   doctrine — nothing may FK into a disposable cache — so a job's client and
   category are looked up through their own tables and matched here, exactly
   as searchMirrorJobs already does.

   DATES ARE STRINGS. ServiceM8 timestamps are naive local text in the
   account's zone; comparisons are lexicographic against a constructed floor,
   never a Date. That is the house pattern and it is correct: the zone cancels
   out on both sides.

   NO SESSION HERE — callers establish the right to ask. `includeMoney` is
   handed in, and when it is false the money columns are never selected. */

import { supabaseAdmin } from "@/lib/supabase-server";
import {
  readJobMediaGroups,
  type JobMediaGroupsRead,
  type MediaSource,
} from "./job-media-query";
import { plusDays } from "./dates";
import { jobMoneyOf, parseSm8AmountToCents, SM8_JOB_MONEY_COLUMNS } from "./job-money";
import { materialLineOf, type JobMaterialLine, type JobPaymentEntry } from "./job-ledger";
import {
  deriveFamilyMoney,
  familyNumbersFor,
  isFamilyMember,
  isPartialInvoiceLine,
  isPartialInvoiceStubNote,
  splitJobNumber,
  type FamilyLines,
  type FamilyMoney,
} from "./job-family";
import {
  ALL_JOBS_HORIZON_DAYS,
  sm8CategoryColour,
  sm8DateFacts,
  sm8MinutesBetween,
  type AllJobsMirrorJob,
  type JobChecklistItem,
} from "./all-jobs";

/** How many open jobs one board load will carry. Far above anything a real
    account has open (the live workspace: 841), and the panel SAYS when it
    binds — a silent truncation reads as "that's everything" when it isn't. */
export const ALL_JOBS_OPEN_CAP = 1500;

/** How much of one job family's ledger a single read will carry. Live the
    busiest family holds 36 material lines and 7 payments across its members;
    these are the walls, not the working numbers — see readJobFamily. */
const MAX_FAMILY_LINES = 600;
const MAX_FAMILY_PAYMENTS = 300;

export type AllJobsData = {
  jobs: AllJobsMirrorJob[];
  /** True when the cap bound — the panel says so out loud. */
  truncated: boolean;
  /** ServiceM8 job uuid → the project that links it, for the tracked chip. */
  projectLinks: { remoteId: string; projectId: string }[];
};

export const EMPTY_ALL_JOBS: AllJobsData = { jobs: [], truncated: false, projectLinks: [] };

type JobRow = {
  uuid: string;
  generated_job_id: string | null;
  status: string | null;
  company_uuid: string | null;
  geo_city: string | null;
  category_uuid: string | null;
  job_description: string | null;
  date: string | null;
  quote_date: string | null;
  completion_date: string | null;
  total_invoice_amount?: string | null;
  invoice_sent?: number | null;
  invoice_date?: string | null;
  quote_sent?: number | null;
  quote_sent_stamp?: string | null;
  payment_received?: number | null;
  payment_received_stamp?: string | null;
};

/** One line of a description, capped — the list shows a glance, the sheet
    shows the whole thing. Newlines collapse so a multi-line note can't take
    six rows' worth of height. */
function oneLine(text: string | null, max = 160): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Supabase caps a URL's length, and `.in()` rides in the query string —
    chunk anything that could be thousands wide. */
async function inChunks<T>(
  values: string[],
  size: number,
  run: (chunk: string[]) => Promise<T[]>
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(...(await run(values.slice(i, i + size))));
  }
  return out;
}

export async function loadAllJobs(
  orgId: string,
  today: string,
  opts: { includeMoney?: boolean } = {}
): Promise<AllJobsData> {
  const includeMoney = opts.includeMoney ?? true;
  const base =
    "uuid, generated_job_id, status, company_uuid, geo_city, category_uuid, " +
    "job_description, date, quote_date, completion_date";
  const columns = includeMoney ? `${base}, ${SM8_JOB_MONEY_COLUMNS}` : base;

  /* Open work is unbounded in age — a work order raised two years ago and
     never closed is exactly the row this tab exists to surface. Finished work
     is windowed to the same 56 days the boards use; older than that is found
     through search, which reaches the whole mirror. */
  const doneFloor = `${plusDays(today, -ALL_JOBS_HORIZON_DAYS)} 00:00:00`;

  const [{ data: openRows }, { data: doneRows }, { data: projectJobRows }] = await Promise.all([
    supabaseAdmin
      .from("sm8_jobs")
      .select(columns)
      .eq("org_id", orgId)
      .eq("active", 1)
      .not("status", "in", '("Completed","Unsuccessful")')
      .order("date", { ascending: false })
      .limit(ALL_JOBS_OPEN_CAP + 1),
    supabaseAdmin
      .from("sm8_jobs")
      .select(columns)
      .eq("org_id", orgId)
      .eq("active", 1)
      .in("status", ["Completed", "Unsuccessful"])
      .gte("completion_date", doneFloor)
      .order("completion_date", { ascending: false })
      .limit(ALL_JOBS_OPEN_CAP),
    supabaseAdmin
      .from("project_jobs")
      .select("project_id, remote_id")
      .eq("org_id", orgId)
      .eq("provider", "servicem8")
      .not("remote_id", "is", null),
  ]);

  const openAll = (openRows ?? []) as unknown as JobRow[];
  const truncated = openAll.length > ALL_JOBS_OPEN_CAP;
  const rows = [...openAll.slice(0, ALL_JOBS_OPEN_CAP), ...((doneRows ?? []) as unknown as JobRow[])];

  if (rows.length === 0) {
    return {
      ...EMPTY_ALL_JOBS,
      projectLinks: ((projectJobRows ?? []) as { project_id: string; remote_id: string }[]).map(
        (r) => ({ remoteId: r.remote_id, projectId: r.project_id })
      ),
    };
  }

  const companyIds = [...new Set(rows.map((r) => r.company_uuid).filter(Boolean) as string[])];
  const categoryIds = [...new Set(rows.map((r) => r.category_uuid).filter(Boolean) as string[])];
  const jobIds = rows.map((r) => r.uuid);

  const [companies, categories, activities, payments] = await Promise.all([
    inChunks(companyIds, 200, async (chunk) => {
      const { data } = await supabaseAdmin
        .from("sm8_companies")
        .select("uuid, name")
        .eq("org_id", orgId)
        .in("uuid", chunk);
      return (data ?? []) as { uuid: string; name: string | null }[];
    }),
    inChunks(categoryIds, 200, async (chunk) => {
      const { data } = await supabaseAdmin
        .from("sm8_categories")
        .select("uuid, name, colour")
        .eq("org_id", orgId)
        .in("uuid", chunk);
      return (data ?? []) as { uuid: string; name: string | null; colour: string | null }[];
    }),
    /* The next diary block per job. Floored at today so a booking from last
       March can't read as "booked"; ordered ascending so the FIRST row seen
       for a job is its soonest. Only scheduled diary blocks count — recorded
       time-on-site sessions (activity_was_scheduled=0) are not bookings. */
    inChunks(jobIds, 200, async (chunk) => {
      const { data } = await supabaseAdmin
        .from("sm8_job_activities")
        .select("job_uuid, start_date")
        .eq("org_id", orgId)
        .eq("active", 1)
        .eq("activity_was_scheduled", 1)
        .in("job_uuid", chunk)
        .gte("start_date", `${today} 00:00:00`)
        .order("start_date", { ascending: true });
      return (data ?? []) as { job_uuid: string; start_date: string | null }[];
    }),
    /* WHAT HAS ACTUALLY BEEN PAID, per job. This is the collection story —
       the flags are not. `payment_received` is set on 45 jobs while 1,819
       completed ones carry payment rows, so a flag read would call 1,774 paid
       jobs unpaid. Deposits count: money in the bank is money in the bank.
       Skipped entirely without the money grant, like every other money read. */
    includeMoney
      ? inChunks(jobIds, 200, async (chunk) => {
          const { data } = await supabaseAdmin
            .from("sm8_job_payments")
            .select("job_uuid, amount")
            .eq("org_id", orgId)
            .eq("active", 1)
            .in("job_uuid", chunk);
          return (data ?? []) as { job_uuid: string; amount: string | null }[];
        })
      : Promise.resolve([] as { job_uuid: string; amount: string | null }[]),
  ]);

  const companyName = new Map(companies.map((c) => [c.uuid, c.name]));
  /* Live category names carry trailing spaces ("Annual Maintenance "). Trim
     at the boundary so nothing downstream has to remember. Colours arrive as
     bare hex and are sanitised here for the same reason. */
  const categoryInfo = new Map(
    categories.map((c) => [
      c.uuid,
      { name: c.name?.trim() || null, colour: sm8CategoryColour(c.colour) },
    ])
  );

  const nextBooking = new Map<string, string>();
  for (const a of activities) {
    if (!a.start_date) continue;
    if (!nextBooking.has(a.job_uuid)) nextBooking.set(a.job_uuid, a.start_date);
  }

  /* Summed here rather than in SQL, through the same parser the rest of the
     money uses — an amount is a ServiceM8 string, and one place reads them. */
  const paidByJob = new Map<string, number>();
  for (const p of payments) {
    const cents = parseSm8AmountToCents(p.amount);
    if (cents === null) continue;
    paidByJob.set(p.job_uuid, (paidByJob.get(p.job_uuid) ?? 0) + cents);
  }

  const jobs: AllJobsMirrorJob[] = rows.map((r) => ({
    remoteId: r.uuid,
    jobNumber: r.generated_job_id,
    status: r.status,
    clientName: r.company_uuid ? companyName.get(r.company_uuid) ?? null : null,
    description: oneLine(r.job_description),
    suburb: r.geo_city,
    categoryName: r.category_uuid ? categoryInfo.get(r.category_uuid)?.name ?? null : null,
    categoryColour: r.category_uuid ? categoryInfo.get(r.category_uuid)?.colour ?? null : null,
    date: r.date,
    quoteDate: r.quote_date,
    completionDate: r.completion_date,
    nextBooking: nextBooking.get(r.uuid) ?? null,
    money: includeMoney ? jobMoneyOf(r) : null,
    paidCents: includeMoney ? paidByJob.get(r.uuid) ?? 0 : 0,
  }));

  return {
    jobs,
    truncated,
    projectLinks: ((projectJobRows ?? []) as { project_id: string; remote_id: string }[]).map(
      (r) => ({ remoteId: r.remote_id, projectId: r.project_id })
    ),
  };
}

/* ── one job, in full, for the sheet ── */

export type MirrorJobDetail = {
  remoteId: string;
  jobNumber: string | null;
  status: string | null;
  clientName: string | null;
  description: string | null;
  workDone: string | null;
  address: string | null;
  suburb: string | null;
  /** "Rose Bay NSW 2029" — the geo columns joined, for a job with no written
      address. Never appended to one that has: job_address usually already
      carries the suburb line, and doubling it would read as two addresses. */
  geoLine: string | null;
  categoryName: string | null;
  categoryColour: string | null;
  purchaseOrder: string | null;
  date: string | null;
  quoteDate: string | null;
  workOrderDate: string | null;
  completionDate: string | null;
  nextBooking: { start: string; end: string | null; staffName: string | null } | null;
  /** Recorded time across the job — the sum of NON-scheduled activity rows,
      which is what ServiceM8's own billing tab calls Job Time. Validated
      against the live account: job #3137 sums to exactly its 18h 30m. */
  timeOnSite: { minutes: number; sessions: number } | null;
  /** WHICH DAY THIS CARD IS SHOWN BY, and what to call it — derived here,
      where the account's own clock is known. The sheet cannot compute it: a
      clock read in a render body breaks hydration for the whole tree, and the
      row it was opened from may belong to a different job entirely (a clone
      opens its parent). Same helper the board row uses. */
  dateOn: string | null;
  dateLabel: string;
  /** The same sessions, UNAGGREGATED — one row per day somebody was on site,
      with who went. The card shows the last three and opens the rest in
      place; the tally above them is `timeOnSite`. Newest first. */
  visits: JobVisit[];
  /** The dispatch queue this job sits in, if any — mirrored since day one,
      rendered here first. */
  queue: { name: string; expiry: string | null; staffName: string | null } | null;
  checklist: JobChecklistItem[];
  contacts: {
    name: string;
    type: string | null;
    /** The number to ring first — the mobile when there is one. */
    phone: string | null;
    /** The OTHER number, when the contact has two and they differ. The sheet
        used to keep only the mobile and drop the landline silently. */
    altPhone: string | null;
    email: string | null;
  }[];
  money: ReturnType<typeof jobMoneyOf> | null;
  /** Studio designs started FROM this job. Empty for a reader without
      `studio` — the caller decides, the same way money does. */
  designs: JobDesign[];
  /** The account's own IANA zone, for the diary's handful of timestamptz
      inputs (designs, picklist). ServiceM8's stamps are already naive
      account-local strings and never need it. */
  timezone: string | null;
};

/** One day somebody was on site, as the Visits list renders it. */
export type JobVisit = {
  /** The day itself — ServiceM8's naive stamp, sliced. */
  day: string;
  /** Minutes recorded across every session that day. */
  minutes: number;
  /** Who went, in the order they first clocked on. TRAVEL TIME IS ABSENT ON
      PURPOSE: ServiceM8's own diary shows it, but `sm8_job_activities` has no
      travel column, so there is nothing here to say. */
  crew: string[];
};

/** A Studio design that names this job, slimmed to what a row says. */
export type JobDesign = {
  id: string;
  name: string;
  mode: "plan" | "blank";
  floorCount: number;
  systemCount: number;
  /** ISO — the row says how long ago, the studio says the rest. */
  updatedAt: string;
};

/** Naive stamp → its date part, without parsing a wall clock into a Date. */
const dateOf = (stamp: string | null | undefined): string | null =>
  typeof stamp === "string" && stamp.length >= 10 ? stamp.slice(0, 10) : null;

/* ── the job's written record, and its ledger ── */

export type JobNoteEntry = {
  remoteId: string;
  text: string;
  writtenOn: string | null;
  /** The whole naive stamp, to the minute — the diary orders a day by it. */
  writtenAt: string | null;
  writtenBy: string | null;
  /** ServiceM8's own "action required" flag on the note. */
  actionRequired: boolean;
  /** The claim's job number when this was written on a clone, null on the
      job's own notes — the diary badge that says where a note was filed. */
  fromClaim: string | null;
};

export type JobLedgerRead = {
  materials: JobMaterialLine[];
  payments: JobPaymentEntry[];
};

export const EMPTY_LEDGER: JobLedgerRead = { materials: [], payments: [] };

/** What was written on the job. NOT money-gated — a note is the work's own
    record, and the same reader who sees the description should see it.
    Notes hang off related_object_uuid, not job_uuid.

    HANDED THE CLAIMS, it reads the family's writing as one stream — a note
    typed while a progress invoice was open is about the WORK, exactly like
    the photos the gallery already lifts, and each one says which claim it
    was filed against. Callers that want one job's own notes (the claim
    modal) simply pass none. */
export async function readJobNotes(
  orgId: string,
  jobUuid: string,
  claims: readonly { remoteId: string; claimNumber: string | null }[] = []
): Promise<JobNoteEntry[]> {
  const sources = [
    { remoteId: jobUuid, claimNumber: null },
    ...claims.filter((c) => c.remoteId !== jobUuid),
  ];
  const claimOf = new Map(sources.map((c) => [c.remoteId, c.claimNumber]));

  const { data } = await supabaseAdmin
    .from("sm8_job_notes")
    .select("uuid, note, create_date, action_required, edit_by_staff_uuid, related_object_uuid")
    .eq("org_id", orgId)
    .in(
      "related_object_uuid",
      sources.map((c) => c.remoteId)
    )
    .eq("active", 1)
    .order("create_date", { ascending: false })
    .limit(60);

  const rows = (data ?? []) as {
    uuid: string;
    note: string | null;
    create_date: string | null;
    action_required: string | null;
    edit_by_staff_uuid: string | null;
    related_object_uuid: string;
  }[];
  const withText = rows.filter((r) => !!r.note?.trim());
  if (withText.length === 0) return [];

  const staffName = await namesForStaff(
    orgId,
    withText.map((r) => r.edit_by_staff_uuid)
  );

  return withText.map((r) => ({
    remoteId: r.uuid,
    text: r.note!.trim(),
    writtenOn: dateOf(r.create_date),
    writtenAt: r.create_date,
    writtenBy: r.edit_by_staff_uuid ? staffName.get(r.edit_by_staff_uuid) ?? null : null,
    /* ServiceM8 sends the flag as "1"/"0" text, like every boolean it owns. */
    actionRequired: r.action_required === "1",
    fromClaim: claimOf.get(r.related_object_uuid) ?? null,
  }));
}

/** The job's line items and payments. MONEY — the caller must hold
    `workboard_money`, and this is never called without it. */
export async function readJobLedger(orgId: string, jobUuid: string): Promise<JobLedgerRead> {
  const [{ data: matRows }, { data: payRows }] = await Promise.all([
    supabaseAdmin
      .from("sm8_job_materials")
      .select(
        "uuid, name, quantity, price, displayed_amount, displayed_amount_is_tax_inclusive, sort_order"
      )
      .eq("org_id", orgId)
      .eq("job_uuid", jobUuid)
      .eq("active", 1)
      .order("sort_order", { ascending: true })
      .limit(200),
    supabaseAdmin
      .from("sm8_job_payments")
      .select("uuid, amount, method, note, actioned_by_uuid, is_deposit, timestamp")
      .eq("org_id", orgId)
      .eq("job_uuid", jobUuid)
      .eq("active", 1)
      .order("timestamp", { ascending: false })
      .limit(60),
  ]);

  const pays = (payRows ?? []) as {
    uuid: string;
    amount: string | null;
    method: string | null;
    note: string | null;
    actioned_by_uuid: string | null;
    is_deposit: number | null;
    timestamp: string | null;
  }[];

  const staffName = await namesForStaff(
    orgId,
    pays.map((p) => p.actioned_by_uuid)
  );

  return {
    materials: ((matRows ?? []) as Parameters<typeof materialLineOf>[0][]).map(materialLineOf),
    payments: pays.map((p) => ({
      remoteId: p.uuid,
      amountCents: parseSm8AmountToCents(p.amount),
      method: p.method?.trim() || null,
      note: p.note?.trim() || null,
      takenOn: dateOf(p.timestamp),
      takenAt: p.timestamp,
      isDeposit: p.is_deposit === 1,
      takenBy: p.actioned_by_uuid ? staffName.get(p.actioned_by_uuid) ?? null : null,
    })),
  };
}

/** One staff read for a set of uuids — the same batching the detail read
    does, so a page of notes costs one query rather than one per author. */
async function namesForStaff(
  orgId: string,
  ids: readonly (string | null)[]
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const { data } = await supabaseAdmin
    .from("sm8_staff")
    .select("uuid, first, last")
    .eq("org_id", orgId)
    .in("uuid", wanted);
  for (const s of (data ?? []) as { uuid: string; first: string | null; last: string | null }[]) {
    const name = [s.first, s.last].filter(Boolean).join(" ").trim();
    if (name) out.set(s.uuid, name);
  }
  return out;
}

/** The sheet's read. The uuid is a CHOICE handed in by a client, so it is
    re-resolved inside this org's mirror — a foreign id finds nothing. */
export async function readMirrorJobDetail(
  orgId: string,
  remoteId: string,
  today: string,
  opts: { includeMoney?: boolean; includeDesigns?: boolean; timezone?: string | null } = {}
): Promise<MirrorJobDetail | null> {
  const includeMoney = opts.includeMoney ?? true;
  const includeDesigns = opts.includeDesigns ?? false;
  const base =
    "uuid, generated_job_id, status, company_uuid, job_address, geo_city, geo_state, geo_postcode, " +
    "category_uuid, queue_uuid, queue_expiry_date, queue_assigned_staff_uuid, " +
    "job_description, work_done_description, purchase_order_number, " +
    "date, quote_date, work_order_date, completion_date";

  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select(includeMoney ? `${base}, ${SM8_JOB_MONEY_COLUMNS}` : base)
    .eq("org_id", orgId)
    .eq("uuid", remoteId)
    .eq("active", 1)
    .maybeSingle();

  const job = data as (JobRow & {
    job_address: string | null;
    geo_state: string | null;
    geo_postcode: string | null;
    queue_uuid: string | null;
    queue_expiry_date: string | null;
    queue_assigned_staff_uuid: string | null;
    work_done_description: string | null;
    purchase_order_number: string | null;
    work_order_date: string | null;
  }) | null;
  if (!job) return null;

  /* Activities arrive WHOLE, not just the next one: the past, non-scheduled
     rows are the recorded on-site time, and the future, scheduled ones hold
     the next booking. One ordered read serves both. */
  const [
    { data: companyRow },
    { data: categoryRow },
    { data: actRows },
    { data: contactRows },
    { data: checkRows },
    { data: queueRow },
    { data: designRows },
  ] = await Promise.all([
    job.company_uuid
      ? supabaseAdmin
          .from("sm8_companies")
          .select("name")
          .eq("org_id", orgId)
          .eq("uuid", job.company_uuid)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    job.category_uuid
      ? supabaseAdmin
          .from("sm8_categories")
          .select("name, colour")
          .eq("org_id", orgId)
          .eq("uuid", job.category_uuid)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from("sm8_job_activities")
      .select("start_date, end_date, staff_uuid, activity_was_scheduled")
      .eq("org_id", orgId)
      .eq("active", 1)
      .eq("job_uuid", remoteId)
      .order("start_date", { ascending: true }),
    supabaseAdmin
      .from("sm8_job_contacts")
      .select("first, last, type, mobile, phone, email")
      .eq("org_id", orgId)
      .eq("active", 1)
      .eq("job_uuid", remoteId),
    supabaseAdmin
      .from("sm8_job_checklists")
      .select("name, item_type, section_name, sort_order, completed_timestamp, completed_by_staff_uuid")
      .eq("org_id", orgId)
      .eq("active", 1)
      .eq("job_uuid", remoteId)
      .order("sort_order", { ascending: true }),
    job.queue_uuid
      ? supabaseAdmin
          .from("sm8_queues")
          .select("name")
          .eq("org_id", orgId)
          .eq("uuid", job.queue_uuid)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    /* The other direction of the studio's job link. `sm8_job_uuid` is written
       out of the design document on every save precisely so this is an index
       hit rather than a scan of every jsonb blob in the table — see
       studio_designs_sm8_job.sql. Rides the existing Promise.all, so a reader
       with `studio` waits no longer than one without. */
    includeDesigns
      ? supabaseAdmin
          .from("studio_designs")
          .select("id, name, mode, floor_count, system_count, updated_at")
          .eq("org_id", orgId)
          .eq("sm8_job_uuid", remoteId)
          .order("updated_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] }),
  ]);

  const acts = (actRows ?? []) as {
    start_date: string | null;
    end_date: string | null;
    staff_uuid: string | null;
    activity_was_scheduled: number | null;
  }[];
  const todayFloor = `${today} 00:00:00`;
  /* Only a dispatched booking may say "next on site". A recorded session
     (activity_was_scheduled=0) can share the same day — and its clock-off
     end time reads as nonsense in a booking line. */
  const next =
    acts.find(
      (a) =>
        a.activity_was_scheduled === 1 && a.start_date !== null && a.start_date >= todayFloor
    ) ?? null;

  /* The sessions, counted AND kept. The tally is what the header says; the
     per-day rows are the Visits list, which is the same read the sheet was
     already paying for and then throwing away. Two techs on one day are ONE
     visit with two names on it — that is how a job is talked about. */
  let minutes = 0;
  let sessions = 0;
  const byDay = new Map<string, { minutes: number; crew: string[] }>();
  for (const a of acts) {
    if (a.activity_was_scheduled !== 0 || !a.start_date || !a.end_date) continue;
    const m = sm8MinutesBetween(a.start_date, a.end_date);
    if (m === null || m <= 0) continue;
    minutes += m;
    sessions += 1;
    const day = dateOf(a.start_date);
    if (!day) continue;
    const entry = byDay.get(day) ?? { minutes: 0, crew: [] };
    entry.minutes += m;
    entry.crew.push(a.staff_uuid ?? "");
    byDay.set(day, entry);
  }

  const checks = (checkRows ?? []) as {
    name: string | null;
    item_type: string | null;
    section_name: string | null;
    sort_order: number | null;
    completed_timestamp: string | null;
    completed_by_staff_uuid: string | null;
  }[];

  /* One staff read for every name the sheet will say — the booking's tech,
     the queue's assignee, whoever ticked each checklist item. */
  const staffIds = [
    ...new Set(
      [
        next?.staff_uuid ?? null,
        job.queue_assigned_staff_uuid,
        ...checks.map((c) => c.completed_by_staff_uuid),
        ...acts.map((a) => a.staff_uuid),
      ].filter((id): id is string => !!id)
    ),
  ];
  const staffName = new Map<string, string>();
  if (staffIds.length) {
    const { data: staffRows } = await supabaseAdmin
      .from("sm8_staff")
      .select("uuid, first, last")
      .eq("org_id", orgId)
      .in("uuid", staffIds);
    for (const s of (staffRows ?? []) as { uuid: string; first: string | null; last: string | null }[]) {
      const name = [s.first, s.last].filter(Boolean).join(" ").trim();
      if (name) staffName.set(s.uuid, name);
    }
  }

  const geoLine =
    [job.geo_city, job.geo_state, job.geo_postcode]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ") || null;

  const queueName = (queueRow as { name: string | null } | null)?.name?.trim() || null;
  const category = categoryRow as { name: string | null; colour: string | null } | null;

  return {
    remoteId: job.uuid,
    jobNumber: job.generated_job_id,
    status: job.status,
    clientName: (companyRow as { name: string | null } | null)?.name ?? null,
    description: job.job_description,
    workDone: job.work_done_description,
    address: job.job_address,
    suburb: job.geo_city,
    geoLine,
    categoryName: category?.name?.trim() || null,
    categoryColour: sm8CategoryColour(category?.colour ?? null),
    purchaseOrder: job.purchase_order_number,
    date: job.date,
    quoteDate: job.quote_date,
    workOrderDate: job.work_order_date,
    completionDate: job.completion_date,
    nextBooking: next?.start_date
      ? {
          start: next.start_date,
          end: next.end_date,
          staffName: next.staff_uuid ? staffName.get(next.staff_uuid) ?? null : null,
        }
      : null,
    timeOnSite: sessions > 0 ? { minutes, sessions } : null,
    ...(() => {
      const facts = sm8DateFacts(
        {
          status: job.status,
          date: job.date,
          quoteDate: job.quote_date,
          completionDate: job.completion_date,
          nextBooking: next?.start_date ?? null,
        },
        today
      );
      return { dateOn: facts.date, dateLabel: facts.label };
    })(),
    visits: [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, v]) => ({
        day,
        minutes: v.minutes,
        crew: [
          ...new Set(
            v.crew.map((id) => staffName.get(id) ?? null).filter((n): n is string => !!n)
          ),
        ],
      })),
    queue: queueName
      ? {
          name: queueName,
          expiry: dateOf(job.queue_expiry_date),
          staffName: job.queue_assigned_staff_uuid
            ? staffName.get(job.queue_assigned_staff_uuid) ?? null
            : null,
        }
      : null,
    checklist: checks
      .filter((c) => !!c.name?.trim())
      .map((c) => {
        const done = !!c.completed_timestamp?.trim();
        return {
          name: c.name!.trim(),
          itemType: c.item_type,
          section: c.section_name?.trim() || null,
          done,
          doneOn: done ? dateOf(c.completed_timestamp) : null,
          doneAt: done ? c.completed_timestamp!.trim() : null,
          doneBy:
            done && c.completed_by_staff_uuid
              ? staffName.get(c.completed_by_staff_uuid) ?? null
              : null,
        };
      }),
    contacts: ((contactRows ?? []) as {
      first: string | null;
      last: string | null;
      type: string | null;
      mobile: string | null;
      phone: string | null;
      email: string | null;
    }[])
      .map((c) => {
        const mobile = c.mobile?.trim() || null;
        const landline = c.phone?.trim() || null;
        return {
          name: [c.first, c.last].filter(Boolean).join(" ").trim(),
          type: c.type,
          phone: mobile || landline,
          altPhone: mobile && landline && mobile !== landline ? landline : null,
          email: c.email?.trim() || null,
        };
      })
      .filter((c) => c.name || c.phone || c.email),
    money: includeMoney ? jobMoneyOf(job) : null,
    designs: ((designRows ?? []) as {
      id: string;
      name: string | null;
      mode: string | null;
      floor_count: number | null;
      system_count: number | null;
      updated_at: string;
    }[]).map((d) => ({
      id: d.id,
      /* A design is always named — `createDesign` defaults it — but the
         column is the document's copy and a blank one would render as a row
         you cannot read. */
      name: d.name?.trim() || "Untitled design",
      mode: d.mode === "plan" ? ("plan" as const) : ("blank" as const),
      floorCount: d.floor_count ?? 0,
      systemCount: d.system_count ?? 0,
      updatedAt: d.updated_at,
    })),
    timezone: opts.timezone ?? null,
  };
}

/* ── the family behind one job ── */

/** Every job row ServiceM8 cloned out of this one, read as ONE ledger.

    THE FAMILY IS ASKED FOR BY NAME, not by prefix. `ilike '15%'` would ask
    for #15, #150–#159 and every #15xx in the account — hundreds of rows — and
    a capped window over them can return without one of #15's own members in
    it, so the family would read as empty or, worse, partial. The twenty-seven
    numbers this family could wear are enumerated instead (familyNumbersFor),
    which has no window to overflow and cannot drag a longer number in.
    isFamilyMember still re-tests every row, as defence in depth.

    A HEADLESS FAMILY IS STILL A FAMILY. Live, 42 variants have no active
    parent — deleted, or never mirrored — and the derivation is built to
    tolerate it: the members it can see are the claims it speaks for.

    MONEY, so the caller must hold `workboard_money` — the same gate the
    ledger read is behind, and for the same reason. */
export async function readJobFamily(
  orgId: string,
  remoteId: string,
  today: string,
  termsDays: number | null
): Promise<FamilyMoney | null> {
  /* The NUMBER is resolved here rather than handed in: the caller holds a
     uuid the client chose, and a job number arriving from a browser would
     let someone ask for a family they aren't looking at. */
  const { data: self } = await supabaseAdmin
    .from("sm8_jobs")
    .select("generated_job_id")
    .eq("org_id", orgId)
    .eq("uuid", remoteId)
    .eq("active", 1)
    .maybeSingle();

  const parts = splitJobNumber((self as { generated_job_id: string | null } | null)?.generated_job_id);
  if (!parts) return null;

  const { data: jobRows } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, total_invoice_amount, invoice_date, date")
    .eq("org_id", orgId)
    .eq("active", 1)
    .in("generated_job_id", familyNumbersFor(parts.base));

  const members = ((jobRows ?? []) as {
    uuid: string;
    generated_job_id: string | null;
    total_invoice_amount: string | null;
    invoice_date: string | null;
    date: string | null;
  }[]).filter((r) => isFamilyMember(parts.base, r.generated_job_id));
  if (members.length === 0) return null;

  const ids = members.map((m) => m.uuid);
  const [{ data: matRows }, { data: payRows }] = await Promise.all([
    supabaseAdmin
      .from("sm8_job_materials")
      .select("uuid, name, quantity, price, displayed_amount, displayed_amount_is_tax_inclusive, job_uuid")
      .eq("org_id", orgId)
      .eq("active", 1)
      .in("job_uuid", ids)
      .limit(MAX_FAMILY_LINES),
    supabaseAdmin
      .from("sm8_job_payments")
      .select("amount, timestamp, job_uuid")
      .eq("org_id", orgId)
      .eq("active", 1)
      .in("job_uuid", ids)
      .limit(MAX_FAMILY_PAYMENTS),
  ]);

  /* One member's lines, netted — and NULL the moment they can't honestly be
     added: an unpriced line, or two lines that disagree about tax.

     THE PARENT'S NEGATIVE ROWS STAY IN. Dropping them here would be the whole
     bug back again: "Partial invoice #2380A × −1" is what turns the parent's
     $27,960 quote into the $6,268 BALANCE, and the balance is exactly what
     the parent's claim is worth. They are hidden from the materials LIST on
     the card, which is a different question — see isPartialInvoiceLine. */
  /* A CAP THAT IS REACHED IS A NUMBER THAT IS WRONG. Live the busiest family
     holds 36 material lines and 7 payments across its members, so these walls
     sit at twenty-fold headroom — but if one is ever hit, the rows that went
     unread are money that went uncounted, and every figure below would be
     quietly short.

     THE ANSWER IS TO SAY NOTHING, not to patch the inputs. Nulling the lines
     was tried and is worse: `lines === null` means "this claim has no lines",
     which lets a PART payment stand as the claim's whole value — the exact
     misread amountOf exists to prevent. Declining outright drops the sheet
     back to the job's own labelled total, which is what it showed for two
     years and cannot be a new wrong number. */
  if ((matRows ?? []).length >= MAX_FAMILY_LINES || (payRows ?? []).length >= MAX_FAMILY_PAYMENTS) {
    return null;
  }

  /* "UNREADABLE" IS NOT "NONE". A member with an unpriced row or two rows
     disagreeing about tax is a member we cannot price; a member with no rows
     is one ServiceM8 never itemised. amountOf treats the second as "nothing
     to check a payment against" and lets the payment stand as the claim — so
     handing it the first under the same name turned a part payment into a
     claim's whole value, the very misread the cap below declines a read to
     avoid. */
  const linesByJob = new Map<string, Exclude<FamilyLines, null>>();
  for (const raw of (matRows ?? []) as (Parameters<typeof materialLineOf>[0] & {
    job_uuid: string;
  })[]) {
    const line = materialLineOf(raw);
    const soFar = linesByJob.get(raw.job_uuid);
    if (soFar === "unreadable") continue; // already so
    if (line.lineCents === null) {
      linesByJob.set(raw.job_uuid, "unreadable");
      continue;
    }
    if (soFar === undefined) {
      linesByJob.set(raw.job_uuid, { cents: line.lineCents, taxInclusive: line.taxInclusive });
      continue;
    }
    if (soFar.taxInclusive !== line.taxInclusive) {
      linesByJob.set(raw.job_uuid, "unreadable");
      continue;
    }
    linesByJob.set(raw.job_uuid, {
      cents: soFar.cents + line.lineCents,
      taxInclusive: soFar.taxInclusive,
    });
  }

  const paidByJob = new Map<string, { cents: number; lastOn: string | null }>();
  for (const p of (payRows ?? []) as {
    amount: string | null;
    timestamp: string | null;
    job_uuid: string;
  }[]) {
    const cents = parseSm8AmountToCents(p.amount);
    if (cents === null) continue;
    const day = dateOf(p.timestamp);
    const soFar = paidByJob.get(p.job_uuid);
    paidByJob.set(p.job_uuid, {
      cents: (soFar?.cents ?? 0) + cents,
      lastOn:
        day && (!soFar?.lastOn || day > soFar.lastOn) ? day : soFar?.lastOn ?? null,
    });
  }

  return deriveFamilyMoney({
    members: members.map((m) => {
      const paid = paidByJob.get(m.uuid);
      return {
        remoteId: m.uuid,
        jobNumber: m.generated_job_id,
        totalCents: parseSm8AmountToCents(m.total_invoice_amount),
        paidCents: paid?.cents ?? 0,
        lastPaidOn: paid?.lastOn ?? null,
        lines: linesByJob.get(m.uuid) ?? null,
        /* A clone carries no invoice_date of its own (14 of 478 live), and
           the day it was created IS the day the progress invoice went out. */
        raisedOn: dateOf(m.invoice_date) ?? (splitJobNumber(m.generated_job_id)?.suffix
          ? dateOf(m.date)
          : null),
      };
    }),
    today,
    termsDays,
  });
}

/* ── which card a job row opens ── */

export type JobCardTarget = {
  /** The card to open — the job itself, or the parent it is a claim of. */
  parentRemoteId: string;
  /** The claim to land on, when the row asked for was one. */
  focusRemoteId: string | null;
};

/** A ServiceM8 clone is a CLAIM, not a job, so opening #2380A opens #2380
    with that claim named in the header.

    AN ORPHAN KEEPS ITS CARD. 44 clones live have no active parent — deleted,
    or never mirrored — and they are not empty: 674 files sit on them, 92 on
    #1243A alone. There is nothing to be a claim OF, so they open as
    themselves and the family derivation already tolerates the headless shape.

    Never throws and never returns nothing: a number this can't read, or a
    parent that isn't there, both fall back to "this row opens itself", which
    is exactly today's behaviour. */
export async function resolveJobCard(orgId: string, remoteId: string): Promise<JobCardTarget> {
  const here: JobCardTarget = { parentRemoteId: remoteId, focusRemoteId: null };

  const { data: self } = await supabaseAdmin
    .from("sm8_jobs")
    .select("generated_job_id")
    .eq("org_id", orgId)
    .eq("uuid", remoteId)
    .eq("active", 1)
    .maybeSingle();

  const parts = splitJobNumber((self as { generated_job_id: string | null } | null)?.generated_job_id);
  if (!parts || parts.suffix === null) return here;

  const { data: parent } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid")
    .eq("org_id", orgId)
    .eq("active", 1)
    .eq("generated_job_id", parts.base)
    .maybeSingle();

  const parentId = (parent as { uuid: string } | null)?.uuid;
  return parentId ? { parentRemoteId: parentId, focusRemoteId: remoteId } : here;
}

/** The job's claims, as the media read needs them — uuid and number, nothing
    else. Its own read rather than a slice of readJobFamily, because the files
    arrive on their own clock and are NOT money: a reader without
    `workboard_money` still sees the photographs of their own work. */
export async function familyMediaSources(
  orgId: string,
  remoteId: string
): Promise<MediaSource[]> {
  const { data: self } = await supabaseAdmin
    .from("sm8_jobs")
    .select("generated_job_id")
    .eq("org_id", orgId)
    .eq("uuid", remoteId)
    .eq("active", 1)
    .maybeSingle();

  const parts = splitJobNumber((self as { generated_job_id: string | null } | null)?.generated_job_id);
  if (!parts) return [];

  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id")
    .eq("org_id", orgId)
    .eq("active", 1)
    .in("generated_job_id", familyNumbersFor(parts.base));

  return ((data ?? []) as { uuid: string; generated_job_id: string | null }[])
    .filter((r) => r.uuid !== remoteId && isFamilyMember(parts.base, r.generated_job_id))
    .map((r) => ({ remoteId: r.uuid, claimNumber: r.generated_job_id }));
}

/* ── one claim, for the modal that opens on it ── */

export type ClaimDetailRead = {
  ledger: JobLedgerRead;
  notes: JobNoteEntry[];
  media: JobMediaGroupsRead;
};

/** What a progress claim knows about itself — and NOTHING the job owns.

    The modal is deliberately small: lines, money, writing, paper. The moment
    it grows a description or a visits list it has become a card again, which
    is the thing this whole slice exists to stop.

    MONEY, so the caller must hold `workboard_money`. */
export async function readClaimDetail(
  orgId: string,
  remoteId: string
): Promise<ClaimDetailRead> {
  const [ledger, notes, media] = await Promise.all([
    readJobLedger(orgId, remoteId),
    readJobNotes(orgId, remoteId),
    /* No claims handed in: this reads the claim's OWN files, which is where
       its "Partial Invoice #2380A" PDF lives — the one file the job's gallery
       deliberately left behind. */
    readJobMediaGroups(orgId, remoteId),
  ]);

  return {
    ledger: {
      /* The parent is a claim too, and its lines carry ServiceM8's netting
         rows. They are bookkeeping about the OTHER claims, so they no more
         belong in this modal than in the job's materials list. */
      materials: ledger.materials.filter((m) => !isPartialInvoiceLine(m)),
      payments: ledger.payments,
    },
    /* 406 of the 618 notes on clones are ServiceM8 announcing that it made a
       clone. The claim ledger says it better. */
    notes: notes.filter((n) => !isPartialInvoiceStubNote(n.text)),
    media,
  };
}

/* ── search, reaching past the loaded window ── */

/** The whole mirror, not just what's on screen — this is how a job finished
    six months ago is found. Deliberately literal about typed words, like the
    ledger searches: someone typing "medical" means medical. */
export async function searchAllMirrorJobs(
  orgId: string,
  query: string,
  today: string,
  opts: { includeMoney?: boolean; limit?: number } = {}
): Promise<AllJobsMirrorJob[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const limit = opts.limit ?? 30;
  const includeMoney = opts.includeMoney ?? true;
  const base =
    "uuid, generated_job_id, status, company_uuid, geo_city, category_uuid, " +
    "job_description, date, quote_date, completion_date";
  const columns = includeMoney ? `${base}, ${SM8_JOB_MONEY_COLUMNS}` : base;
  const safe = q.replace(/[%,()]/g, " ").trim();
  if (!safe) return [];

  const [{ data: byNumber }, { data: companyRows }] = await Promise.all([
    supabaseAdmin
      .from("sm8_jobs")
      .select(columns)
      .eq("org_id", orgId)
      .eq("active", 1)
      .ilike("generated_job_id", `${safe}%`)
      .limit(limit),
    supabaseAdmin
      .from("sm8_companies")
      .select("uuid, name")
      .eq("org_id", orgId)
      .eq("active", 1)
      .ilike("name", `%${safe}%`)
      .limit(20),
  ]);

  const companies = (companyRows ?? []) as { uuid: string; name: string | null }[];
  const [{ data: byClient }, { data: byText }] = await Promise.all([
    companies.length
      ? supabaseAdmin
          .from("sm8_jobs")
          .select(columns)
          .eq("org_id", orgId)
          .eq("active", 1)
          .in("company_uuid", companies.map((c) => c.uuid))
          .order("date", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [] }),
    supabaseAdmin
      .from("sm8_jobs")
      .select(columns)
      .eq("org_id", orgId)
      .eq("active", 1)
      .or(`job_description.ilike.%${safe}%,geo_city.ilike.%${safe}%`)
      .order("date", { ascending: false })
      .limit(limit),
  ]);

  const seen = new Set<string>();
  const rows: JobRow[] = [];
  for (const list of [byNumber, byClient, byText]) {
    for (const r of (list ?? []) as unknown as JobRow[]) {
      if (seen.has(r.uuid)) continue;
      seen.add(r.uuid);
      rows.push(r);
    }
  }
  const found = rows.slice(0, limit);
  if (found.length === 0) return [];

  const nameById = new Map(companies.map((c) => [c.uuid, c.name]));
  const missing = [
    ...new Set(
      found
        .map((r) => r.company_uuid)
        .filter((id): id is string => !!id && !nameById.has(id))
    ),
  ];
  if (missing.length) {
    const extra = await inChunks(missing, 200, async (chunk) => {
      const { data } = await supabaseAdmin
        .from("sm8_companies")
        .select("uuid, name")
        .eq("org_id", orgId)
        .in("uuid", chunk);
      return (data ?? []) as { uuid: string; name: string | null }[];
    });
    for (const c of extra) nameById.set(c.uuid, c.name);
  }

  const categoryIds = [...new Set(found.map((r) => r.category_uuid).filter(Boolean) as string[])];
  const cats = await inChunks(categoryIds, 200, async (chunk) => {
    const { data } = await supabaseAdmin
      .from("sm8_categories")
      .select("uuid, name, colour")
      .eq("org_id", orgId)
      .in("uuid", chunk);
    return (data ?? []) as { uuid: string; name: string | null; colour: string | null }[];
  });
  const catById = new Map(
    cats.map((c) => [c.uuid, { name: c.name?.trim() || null, colour: sm8CategoryColour(c.colour) }])
  );

  const { data: actRows } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("job_uuid, start_date")
    .eq("org_id", orgId)
    .eq("active", 1)
    .eq("activity_was_scheduled", 1)
    .in("job_uuid", found.map((r) => r.uuid))
    .gte("start_date", `${today} 00:00:00`)
    .order("start_date", { ascending: true });
  const nextBooking = new Map<string, string>();
  for (const a of (actRows ?? []) as { job_uuid: string; start_date: string | null }[]) {
    if (a.start_date && !nextBooking.has(a.job_uuid)) nextBooking.set(a.job_uuid, a.start_date);
  }

  /* Payments here too, or the same job would report a different collection
     state depending on whether it was scrolled to or searched for. */
  const paidByJob = new Map<string, number>();
  if (includeMoney) {
    const { data: payRows } = await supabaseAdmin
      .from("sm8_job_payments")
      .select("job_uuid, amount")
      .eq("org_id", orgId)
      .eq("active", 1)
      .in("job_uuid", found.map((r) => r.uuid));
    for (const p of (payRows ?? []) as { job_uuid: string; amount: string | null }[]) {
      const cents = parseSm8AmountToCents(p.amount);
      if (cents === null) continue;
      paidByJob.set(p.job_uuid, (paidByJob.get(p.job_uuid) ?? 0) + cents);
    }
  }

  return found.map((r) => ({
    remoteId: r.uuid,
    jobNumber: r.generated_job_id,
    status: r.status,
    clientName: r.company_uuid ? nameById.get(r.company_uuid) ?? null : null,
    description: oneLine(r.job_description),
    suburb: r.geo_city,
    categoryName: r.category_uuid ? catById.get(r.category_uuid)?.name ?? null : null,
    categoryColour: r.category_uuid ? catById.get(r.category_uuid)?.colour ?? null : null,
    date: r.date,
    quoteDate: r.quote_date,
    completionDate: r.completion_date,
    nextBooking: nextBooking.get(r.uuid) ?? null,
    money: includeMoney ? jobMoneyOf(r) : null,
    paidCents: includeMoney ? paidByJob.get(r.uuid) ?? 0 : 0,
  }));
}
