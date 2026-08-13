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
import { jobMoneyOf, SM8_JOB_MONEY_COLUMNS } from "./job-money";
import { ALL_JOBS_HORIZON_DAYS, type AllJobsMirrorJob } from "./all-jobs";

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
        .select("uuid, name")
        .eq("org_id", orgId)
        .in("uuid", chunk);
      return (data ?? []) as { uuid: string; name: string | null }[];
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
     at the boundary so nothing downstream has to remember. */
  const categoryName = new Map(categories.map((c) => [c.uuid, c.name?.trim() || null]));

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
    categoryName: r.category_uuid ? categoryName.get(r.category_uuid) ?? null : null,
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
  categoryName: string | null;
  purchaseOrder: string | null;
  date: string | null;
  quoteDate: string | null;
  completionDate: string | null;
  nextBooking: { start: string; staffName: string | null } | null;
  contacts: { name: string; type: string | null; phone: string | null }[];
  money: ReturnType<typeof jobMoneyOf> | null;
};

/** The sheet's read. The uuid is a CHOICE handed in by a client, so it is
    re-resolved inside this org's mirror — a foreign id finds nothing. */
export async function readMirrorJobDetail(
  orgId: string,
  remoteId: string,
  today: string,
  opts: { includeMoney?: boolean } = {}
): Promise<MirrorJobDetail | null> {
  const includeMoney = opts.includeMoney ?? true;
  const base =
    "uuid, generated_job_id, status, company_uuid, job_address, geo_city, category_uuid, " +
    "job_description, work_done_description, purchase_order_number, date, quote_date, completion_date";

  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select(includeMoney ? `${base}, ${SM8_JOB_MONEY_COLUMNS}` : base)
    .eq("org_id", orgId)
    .eq("uuid", remoteId)
    .eq("active", 1)
    .maybeSingle();

  const job = data as (JobRow & {
    job_address: string | null;
    work_done_description: string | null;
    purchase_order_number: string | null;
  }) | null;
  if (!job) return null;

  const [{ data: companyRow }, { data: categoryRow }, { data: actRows }, { data: contactRows }] =
    await Promise.all([
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
            .select("name")
            .eq("org_id", orgId)
            .eq("uuid", job.category_uuid)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin
        .from("sm8_job_activities")
        .select("start_date, staff_uuid")
        .eq("org_id", orgId)
        .eq("active", 1)
        .eq("job_uuid", remoteId)
        .gte("start_date", `${today} 00:00:00`)
        .order("start_date", { ascending: true })
        .limit(1),
      supabaseAdmin
        .from("sm8_job_contacts")
        .select("first, last, type, mobile, phone")
        .eq("org_id", orgId)
        .eq("active", 1)
        .eq("job_uuid", remoteId),
    ]);

  const act = ((actRows ?? []) as { start_date: string | null; staff_uuid: string | null }[])[0];
  let staffName: string | null = null;
  if (act?.staff_uuid) {
    const { data: staffRow } = await supabaseAdmin
      .from("sm8_staff")
      .select("first, last")
      .eq("org_id", orgId)
      .eq("uuid", act.staff_uuid)
      .maybeSingle();
    const s = staffRow as { first: string | null; last: string | null } | null;
    staffName = s ? [s.first, s.last].filter(Boolean).join(" ") || null : null;
  }

  return {
    remoteId: job.uuid,
    jobNumber: job.generated_job_id,
    status: job.status,
    clientName: (companyRow as { name: string | null } | null)?.name ?? null,
    description: job.job_description,
    workDone: job.work_done_description,
    address: job.job_address,
    suburb: job.geo_city,
    categoryName: (categoryRow as { name: string | null } | null)?.name?.trim() || null,
    purchaseOrder: job.purchase_order_number,
    date: job.date,
    quoteDate: job.quote_date,
    completionDate: job.completion_date,
    nextBooking: act?.start_date ? { start: act.start_date, staffName } : null,
    contacts: ((contactRows ?? []) as {
      first: string | null;
      last: string | null;
      type: string | null;
      mobile: string | null;
      phone: string | null;
    }[])
      .map((c) => ({
        name: [c.first, c.last].filter(Boolean).join(" ").trim(),
        type: c.type,
        phone: c.mobile || c.phone,
      }))
      .filter((c) => c.name || c.phone),
    money: includeMoney ? jobMoneyOf(job) : null,
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
      .select("uuid, name")
      .eq("org_id", orgId)
      .in("uuid", chunk);
    return (data ?? []) as { uuid: string; name: string | null }[];
  });
  const catById = new Map(cats.map((c) => [c.uuid, c.name?.trim() || null]));

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
    categoryName: r.category_uuid ? catById.get(r.category_uuid) ?? null : null,
    date: r.date,
    quoteDate: r.quote_date,
    completionDate: r.completion_date,
    nextBooking: nextBooking.get(r.uuid) ?? null,
    money: includeMoney ? jobMoneyOf(r) : null,
  }));
}
