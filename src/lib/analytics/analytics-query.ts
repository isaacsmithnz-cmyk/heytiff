import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { cleanBrief } from "@/lib/workboard/quote-worklist";
import { isPartialInvoiceLine, splitJobNumber } from "@/lib/workboard/job-family";
import { decisionsFrom, type Decisions } from "./decisions";
import { analyticsKindOf, type AnalyticsJob } from "./job-analytics";

/* THE JOBS THE ANALYTICS READ, off the ServiceM8 mirror.

   Every job raised since `floor`, and every job completed since then that was
   raised before it, so a long job finished this year still counts toward the
   work completed. Paged, a thousand rows a read: PostgREST hands back no more
   than that, and a short answer would read as a quiet year. The cap is far
   above a real account (the live one holds 3,455 jobs in all) and the page
   says so when it binds.

   DATES ARE STRINGS: the mirror's naive local stamps compare against a bare
   day, as everywhere else (all-jobs-query).

   WHAT THE LIVE ACCOUNT TAUGHT IT (2026-10-07, read against the mirror):
   - MONEY IS THE JOB'S LINES, EX GST. `total_invoice_amount` and
     `quote_sent_stamp` only exist on jobs edited in ServiceM8 since the money
     columns arrived (mid-August 2026): 1,111 of the year's 1,561 jobs had no
     total, 847 of them with priced lines. On all 342 jobs that had both, the
     lines times 1.1 equal the total to the dollar, so the lines are the one
     source that covers every job. ServiceM8's netting rows on a parent
     ("Partial invoice #2380A", quantity -1; job-family) are left out, so a
     job is worth the whole of its work and not what is left after its claims.
   - A PROGRESS CLAIM IS NOT A JOB. ServiceM8 bills one by cloning the job
     (#2380A, #2380B); a clone is left out entirely, or the year counts 191
     extra jobs and their money twice.
   - THE QUOTE DATE is read too: it says a job was a Quote before it was a
     Work Order, where the sent stamp was never recorded (job-analytics).

   NO SESSION HERE: the page has already asked for `workboard_money`. */

const PAGE = 1000;
/** Pages one read may take before it stops and says the cap bound. */
const MAX_PAGES = 30;

const COLUMNS =
  "uuid, generated_job_id, status, date, quote_date, quote_sent_stamp, work_order_date, completion_date, " +
  "payment_received, category_uuid, company_uuid, geo_city, job_description";

type Row = {
  uuid: string;
  generated_job_id: string | null;
  status: string | null;
  date: string | null;
  quote_date: string | null;
  quote_sent_stamp: string | null;
  work_order_date: string | null;
  completion_date: string | null;
  payment_received: number | null;
  category_uuid: string | null;
  company_uuid: string | null;
  geo_city: string | null;
  job_description: string | null;
};

export type AnalyticsJobsRead = { jobs: AnalyticsJob[]; truncated: boolean };

const dayOf = (stamp: string | null) => (stamp && stamp.length >= 10 ? stamp.slice(0, 10) : null);

async function pages(orgId: string, column: "date" | "completion_date", floor: string): Promise<{ rows: Row[]; truncated: boolean } | null> {
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin
      .from("sm8_jobs")
      .select(COLUMNS)
      .eq("org_id", orgId)
      .eq("active", 1)
      .gte(column, floor)
      .order("uuid", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      console.error(`[analytics] couldn't read org ${orgId}'s jobs by ${column}:`, error);
      return null;
    }
    const got = (data ?? []) as unknown as Row[];
    rows.push(...got);
    if (got.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** The jobs raised or completed since `floor` (a bare day), shaped for the
    figures; null when the mirror can't be read. */
export async function readAnalyticsJobs(orgId: string, floor: string): Promise<AnalyticsJobsRead | null> {
  const [raised, completed, cats, accepted, lines] = await Promise.all([
    pages(orgId, "date", floor),
    pages(orgId, "completion_date", floor),
    supabaseAdmin.from("sm8_categories").select("uuid, name").eq("org_id", orgId),
    acceptedProposals(orgId),
    jobLines(orgId),
  ]);
  if (!raised || !completed || !lines) return null;
  if (cats.error) console.error(`[analytics] couldn't read org ${orgId}'s categories:`, cats.error);
  const category = new Map(((cats.data ?? []) as { uuid: string; name: string | null }[]).map((c) => [c.uuid, c.name]));

  const seen = new Set<string>();
  const jobs: AnalyticsJob[] = [];
  for (const r of [...raised.rows, ...completed.rows]) {
    if (seen.has(r.uuid)) continue;
    seen.add(r.uuid);
    /* a progress claim is part of its parent, never a job of its own */
    if (splitJobNumber(r.generated_job_id)?.suffix) continue;
    const own = lines.get(r.uuid);
    const categoryName = r.category_uuid ? (category.get(r.category_uuid) ?? null) : null;
    jobs.push({
      id: r.uuid,
      status: r.status,
      raisedOn: dayOf(r.date),
      quoteSentOn: dayOf(r.quote_sent_stamp),
      quotedOn: dayOf(r.quote_date),
      wonOn: dayOf(r.work_order_date),
      completedOn: dayOf(r.completion_date),
      valueCents: own && own.cents > 0 ? own.cents : null,
      kind: analyticsKindOf(r.job_description, own?.names ?? [], categoryName),
      category: categoryName,
      paid: r.payment_received === 1,
      acceptedInHeyTiff: accepted.has(r.uuid),
      number: r.generated_job_id,
      suburb: r.geo_city,
      brief: cleanBrief(r.job_description),
      clientId: r.company_uuid,
    });
  }
  return { jobs, truncated: raised.truncated || completed.truncated };
}

/** The jobs whose HeyTiff proposal has an option marked accepted. Only the
    marks are read, not the drafts. A read that fails names none (logged):
    then no Quote is asked about for being accepted. */
async function acceptedProposals(orgId: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin
      .from("quote_drafts")
      .select("sm8_job_uuid, accepted:draft->accepted")
      .eq("org_id", orgId)
      .order("sm8_job_uuid", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      console.error(`[analytics] couldn't read org ${orgId}'s accepted proposals:`, error);
      return out;
    }
    const rows = (data ?? []) as unknown as { sm8_job_uuid: string; accepted: unknown }[];
    for (const r of rows) if (Array.isArray(r.accepted) && r.accepted.length > 0) out.add(r.sm8_job_uuid);
    if (rows.length < PAGE) return out;
  }
  return out;
}

/** PostgREST's word for a table that isn't there, and Postgres's: the
    decisions table before its migration is applied. */
const NO_TABLE = new Set(["PGRST205", "42P01"]);

export type DecisionsRead = { decisions: Decisions; ready: boolean };

/** Every answer given on the To decide tab. `ready` is false while the table
    hasn't been made yet: the tab then asks, but says it can't keep answers. */
export async function readDecisions(orgId: string): Promise<DecisionsRead> {
  const rows: { sm8_job_uuid: string; question: string; answer: string }[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin
      .from("job_analytics_decisions")
      .select("sm8_job_uuid, question, answer")
      .eq("org_id", orgId)
      .order("sm8_job_uuid", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      if (!NO_TABLE.has((error as { code?: string }).code ?? "")) console.error(`[analytics] couldn't read org ${orgId}'s decisions:`, error);
      return { decisions: new Map(), ready: false };
    }
    const got = (data ?? []) as { sm8_job_uuid: string; question: string; answer: string }[];
    rows.push(...got);
    if (got.length < PAGE) break;
  }
  return { decisions: decisionsFrom(rows), ready: true };
}

/** Client names for the To decide rows only, by ServiceM8 company uuid,
    two hundred to a read; a failure names none (logged). */
export async function readClientNames(orgId: string, ids: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const want = [...new Set(ids)];
  for (let i = 0; i < want.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from("sm8_companies")
      .select("uuid, name")
      .eq("org_id", orgId)
      .in("uuid", want.slice(i, i + 200));
    if (error) {
      console.error(`[analytics] couldn't read org ${orgId}'s client names:`, error);
      return out;
    }
    for (const c of (data ?? []) as { uuid: string; name: string | null }[]) if (c.name) out[c.uuid] = c.name;
  }
  return out;
}

/** Every live line on the account's jobs, made each job's value ex GST and
    the names of what went on it. Null when the lines can't be read: a job
    with no value would read as a quiet year. */
async function jobLines(orgId: string): Promise<Map<string, { cents: number; names: string[] }> | null> {
  const out = new Map<string, { cents: number; names: string[] }>();
  for (let page = 0; page < MAX_PAGES * 2; page++) {
    const { data, error } = await supabaseAdmin
      .from("sm8_job_materials")
      .select("uuid, job_uuid, name, quantity, price")
      .eq("org_id", orgId)
      .eq("active", 1)
      .order("uuid", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      console.error(`[analytics] couldn't read org ${orgId}'s job lines:`, error);
      return null;
    }
    const rows = (data ?? []) as { job_uuid: string | null; name: string | null; quantity: unknown; price: unknown }[];
    for (const r of rows) {
      if (!r.job_uuid) continue;
      const name = r.name ?? "";
      const quantity = num(r.quantity);
      if (isPartialInvoiceLine({ name, quantity })) continue;
      const job = out.get(r.job_uuid) ?? { cents: 0, names: [] };
      job.cents += Math.round((quantity ?? 0) * (num(r.price) ?? 0) * 100);
      if (name) job.names.push(name);
      out.set(r.job_uuid, job);
    }
    if (rows.length < PAGE) return out;
  }
  return out;
}

/** A ServiceM8 number as text ("2.0000") or a number; null when unreadable. */
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
