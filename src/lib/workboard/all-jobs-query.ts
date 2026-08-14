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
import { plusDays } from "./dates";
import { jobMoneyOf, parseSm8AmountToCents, SM8_JOB_MONEY_COLUMNS } from "./job-money";
import { materialLineOf, type JobMaterialLine, type JobPaymentEntry } from "./job-ledger";
import {
  ALL_JOBS_HORIZON_DAYS,
  sm8CategoryColour,
  sm8MinutesBetween,
  type AllJobsMirrorJob,
  type JobChecklistItem,
} from "./all-jobs";

/** How many open jobs one board load will carry. Far above anything a real
    account has open (the live workspace: 841), and the panel SAYS when it
    binds — a silent truncation reads as "that's everything" when it isn't. */
export const ALL_JOBS_OPEN_CAP = 1500;

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

  const [companies, categories, activities] = await Promise.all([
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
       for a job is its soonest. */
    inChunks(jobIds, 200, async (chunk) => {
      const { data } = await supabaseAdmin
        .from("sm8_job_activities")
        .select("job_uuid, start_date")
        .eq("org_id", orgId)
        .eq("active", 1)
        .in("job_uuid", chunk)
        .gte("start_date", `${today} 00:00:00`)
        .order("start_date", { ascending: true });
      return (data ?? []) as { job_uuid: string; start_date: string | null }[];
    }),
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
  /** The dispatch queue this job sits in, if any — mirrored since day one,
      rendered here first. */
  queue: { name: string; expiry: string | null; staffName: string | null } | null;
  checklist: JobChecklistItem[];
  contacts: { name: string; type: string | null; phone: string | null; email: string | null }[];
  money: ReturnType<typeof jobMoneyOf> | null;
  /** Studio designs started FROM this job. Empty for a reader without
      `studio` — the caller decides, the same way money does. */
  designs: JobDesign[];
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
  writtenBy: string | null;
};

export type JobLedgerRead = {
  materials: JobMaterialLine[];
  payments: JobPaymentEntry[];
};

export const EMPTY_LEDGER: JobLedgerRead = { materials: [], payments: [] };

/** What was written on the job. NOT money-gated — a note is the work's own
    record, and the same reader who sees the description should see it.
    Notes hang off related_object_uuid, not job_uuid. */
export async function readJobNotes(orgId: string, jobUuid: string): Promise<JobNoteEntry[]> {
  const { data } = await supabaseAdmin
    .from("sm8_job_notes")
    .select("uuid, note, create_date, edit_by_staff_uuid")
    .eq("org_id", orgId)
    .eq("related_object_uuid", jobUuid)
    .eq("active", 1)
    .order("create_date", { ascending: false })
    .limit(60);

  const rows = (data ?? []) as {
    uuid: string;
    note: string | null;
    create_date: string | null;
    edit_by_staff_uuid: string | null;
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
    writtenBy: r.edit_by_staff_uuid ? staffName.get(r.edit_by_staff_uuid) ?? null : null,
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
  opts: { includeMoney?: boolean; includeDesigns?: boolean } = {}
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

  let minutes = 0;
  let sessions = 0;
  for (const a of acts) {
    if (a.activity_was_scheduled !== 0 || !a.start_date || !a.end_date) continue;
    const m = sm8MinutesBetween(a.start_date, a.end_date);
    if (m !== null && m > 0) {
      minutes += m;
      sessions += 1;
    }
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
      .map((c) => ({
        name: [c.first, c.last].filter(Boolean).join(" ").trim(),
        type: c.type,
        phone: c.mobile || c.phone,
        email: c.email?.trim() || null,
      }))
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
    .in("job_uuid", found.map((r) => r.uuid))
    .gte("start_date", `${today} 00:00:00`)
    .order("start_date", { ascending: true });
  const nextBooking = new Map<string, string>();
  for (const a of (actRows ?? []) as { job_uuid: string; start_date: string | null }[]) {
    if (a.start_date && !nextBooking.has(a.job_uuid)) nextBooking.set(a.job_uuid, a.start_date);
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
  }));
}
