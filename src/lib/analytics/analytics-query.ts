import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { parseSm8AmountToCents } from "@/lib/workboard/job-money";
import { workKindOf } from "@/lib/quotes/labour-history";
import type { AnalyticsJob } from "./job-analytics";

/* THE JOBS THE ANALYTICS READ, off the ServiceM8 mirror.

   Every job raised since `floor`, and every job completed since then that was
   raised before it, so a long job finished this year still counts toward the
   work completed. Paged, a thousand rows a read: PostgREST hands back no more
   than that, and a short answer would read as a quiet year. The cap is far
   above a real account (the live one holds 3,455 jobs in all) and the page
   says so when it binds.

   DATES ARE STRINGS: the mirror's naive local stamps compare against a bare
   day, as everywhere else (all-jobs-query). MONEY is ServiceM8's job total,
   inc GST, parsed by the one parser for its strings (job-money).

   NO SESSION HERE: the page has already asked for `workboard_money`. */

const PAGE = 1000;
/** Pages one read may take before it stops and says the cap bound. */
const MAX_PAGES = 30;

const COLUMNS =
  "uuid, status, date, quote_sent_stamp, work_order_date, completion_date, total_invoice_amount, category_uuid, job_description";

type Row = {
  uuid: string;
  status: string | null;
  date: string | null;
  quote_sent_stamp: string | null;
  work_order_date: string | null;
  completion_date: string | null;
  total_invoice_amount: string | null;
  category_uuid: string | null;
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
  const [raised, completed, cats] = await Promise.all([
    pages(orgId, "date", floor),
    pages(orgId, "completion_date", floor),
    supabaseAdmin.from("sm8_categories").select("uuid, name").eq("org_id", orgId),
  ]);
  if (!raised || !completed) return null;
  if (cats.error) console.error(`[analytics] couldn't read org ${orgId}'s categories:`, cats.error);
  const category = new Map(((cats.data ?? []) as { uuid: string; name: string | null }[]).map((c) => [c.uuid, c.name]));

  const seen = new Set<string>();
  const jobs: AnalyticsJob[] = [];
  for (const r of [...raised.rows, ...completed.rows]) {
    if (seen.has(r.uuid)) continue;
    seen.add(r.uuid);
    jobs.push({
      id: r.uuid,
      status: r.status,
      raisedOn: dayOf(r.date),
      quoteSentOn: dayOf(r.quote_sent_stamp),
      wonOn: dayOf(r.work_order_date),
      completedOn: dayOf(r.completion_date),
      valueCents: parseSm8AmountToCents(r.total_invoice_amount),
      kind: workKindOf(r.job_description, r.category_uuid ? (category.get(r.category_uuid) ?? null) : null),
    });
  }
  return { jobs, truncated: raised.truncated || completed.truncated };
}
