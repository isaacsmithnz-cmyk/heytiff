import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { todayInAu } from "@/lib/au-dates";
import { missingTable } from "@/lib/dashboard/task-events";
import { suburbOf } from "@/lib/mobile/wrapped-others";
import { jobHue } from "@/lib/workboard/job-hue";
import { lineFromRow, type QuoteLine } from "@/lib/quotes/lines";
import { byHandOf } from "@/lib/quotes/lines-job";
import { markAccepted } from "@/lib/quotes/lines-job-server";
import { namesBySignIn } from "@/lib/quotes/lines-server";
import { unitSpecsOf } from "@/lib/quotes/fit-server";
import { readSuppliers } from "@/lib/quotes/price-book-server";
import { BUILT_IN_SUPPLIERS } from "@/lib/quotes/price-book";
import { putAcceptedOnJob } from "@/lib/quotes/accepted-materials-server";
import { addEvents, readSession } from "@/lib/quotes/session/store-server";
import { makeTasksFromQuote } from "@/lib/workboard/visit-tasks-server";
import {
  allocate,
  byBooking,
  DUCT_KEY,
  jobState,
  needsOf,
  NO_MARK,
  optionChoice,
  orderedAfter,
  ordersOf,
  shoppingList,
  weekOf,
  type Item,
  type JobNeeds,
  type JobState,
  type Mark,
  type Specs,
  type StockJob,
  type SupplierOrder,
  type Week,
} from "./stock";

/* STOCK, READ AND TICKED (lib/stock/stock.ts says what's on it). The week's
   jobs come from ServiceM8's scheduled bookings; what each needs from its
   HeyTiff quote; what's in and ordered from stock_marks. Until that table is
   on the database (docs/migrations/stock_marks.sql) Stock reads as not set
   up and every tick is refused: nothing is written anywhere. */

const QUOTE_COLS =
  "id, sm8_job_uuid, option_index, system, grp, position, name, code, supplier_key, kind, qty, unit, cost_cents, sell_cents, source, why, duct, visit, estimate, version, updated_at, updated_by";

export type StockJobView = {
  job: StockJob;
  state: JobState;
  /** where its list came from: the accepted option, the only one, the one ServiceM8 kept */
  from: "accepted" | "only" | "servicem8" | null;
  needs: (JobNeeds["needs"][number] & { inStockName: string | null; orderedName: string | null })[];
  /** two options and none taken: the names to choose from */
  choose: { index: number; name: string }[] | null;
};

export type StockView =
  | { ready: false }
  | {
      ready: true;
      week: Week;
      from: string;
      to: string;
      jobs: StockJobView[];
      items: Item[];
      orders: (SupplierOrder & { supplierName: string })[];
      /** booked, but no quote in HeyTiff to read */
      noQuote: StockJob[];
      /** a quote, but no units on what it took */
      noUnits: StockJob[];
    };

type Act = { job_uuid: string; start_date: string; staff_uuid: string | null };
type MarkRow = { sm8_job_uuid: string; item_key: string; in_stock: number; ordered: number; ordered_from: string | null; in_stock_by: string | null; in_stock_at: string | null; ordered_by: string | null; ordered_at: string | null };

/** Is the table there? A read that the database can't find. */
export async function stockReady(orgId: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from("stock_marks").select("id").eq("org_id", orgId).limit(1);
  return !error || !missingTable(error.code);
}

/** The week's jobs, each at its first booking, earliest first. */
async function weekJobs(orgId: string, from: string, to: string): Promise<StockJob[]> {
  const { data: acts } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("job_uuid, start_date, staff_uuid")
    .eq("org_id", orgId)
    .eq("active", 1)
    .eq("activity_was_scheduled", 1)
    .gte("start_date", `${from} 00:00:00`)
    .lte("start_date", `${to} 23:59:59`);
  /* a job's bookings, by the job however ServiceM8 cased its uuid */
  const by = new Map<string, Act[]>();
  for (const a of (acts ?? []) as Act[]) by.set(a.job_uuid.toLowerCase(), [...(by.get(a.job_uuid.toLowerCase()) ?? []), a]);
  const first = new Map<string, { at: string; staff: Set<string> }>();
  for (const [k, list] of by) {
    const at = list.reduce((m, a) => (a.start_date < m ? a.start_date : m), list[0]!.start_date);
    const day = at.slice(0, 10);
    first.set(k, { at, staff: new Set(list.filter((a) => a.start_date.slice(0, 10) === day && a.staff_uuid).map((a) => a.staff_uuid!)) });
  }
  if (!first.size) return [];
  const ids = [...new Set(((acts ?? []) as Act[]).flatMap((a) => [a.job_uuid, a.job_uuid.toLowerCase()]))];
  const { data: jobs } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, job_address, company_uuid, category_uuid, status, active")
    .eq("org_id", orgId)
    .in("uuid", ids);
  const rows = ((jobs ?? []) as { uuid: string; generated_job_id: string | null; job_address: string | null; company_uuid: string | null; category_uuid: string | null; status: string | null; active: number | null }[]).filter((j) => j.active !== 0);
  const companies = [...new Set(rows.map((r) => r.company_uuid).filter((c): c is string => !!c))];
  const cats = [...new Set(rows.map((r) => r.category_uuid).filter((c): c is string => !!c))];
  const [{ data: co }, { data: ca }] = await Promise.all([
    companies.length ? supabaseAdmin.from("sm8_companies").select("uuid, name").eq("org_id", orgId).in("uuid", companies) : Promise.resolve({ data: [] }),
    cats.length ? supabaseAdmin.from("sm8_categories").select("uuid, name, colour").eq("org_id", orgId).in("uuid", cats) : Promise.resolve({ data: [] }),
  ]);
  const coName = new Map(((co ?? []) as { uuid: string; name: string | null }[]).map((c) => [c.uuid, c.name]));
  const cat = new Map(((ca ?? []) as { uuid: string; name: string | null; colour: string | null }[]).map((c) => [c.uuid, c]));
  return rows
    .map((r) => {
      const f = first.get(r.uuid.toLowerCase())!;
      const c = r.category_uuid ? cat.get(r.category_uuid) : undefined;
      return {
        uuid: r.uuid,
        number: r.generated_job_id,
        client: (r.company_uuid ? coName.get(r.company_uuid) : null)?.trim() || null,
        suburb: suburbOf(r.job_address),
        hue: jobHue(c?.colour ? `#${c.colour}` : null, r.status),
        kind: c?.name?.trim() || null,
        firstAt: f.at,
        crew: Math.max(1, f.staff.size),
      };
    })
    .sort(byBooking);
}

/** The cheapest supplier in the book for each code; the quote line's where the book hasn't it. */
async function cheapest(orgId: string, codes: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, { key: string; cents: number }>();
  if (!codes.length) return new Map();
  const { data } = await supabaseAdmin.from("quote_price_items").select("supplier_key, code, cents").eq("org_id", orgId).eq("current", true).in("code", codes);
  for (const r of (data ?? []) as { supplier_key: string; code: string; cents: number | null }[]) {
    const k = r.code.toUpperCase();
    if (r.cents == null) continue;
    const had = out.get(k);
    if (!had || r.cents < had.cents) out.set(k, { key: r.supplier_key, cents: r.cents });
  }
  return new Map([...out].map(([k, v]) => [k, v.key]));
}

export async function supplierNames(orgId: string): Promise<Map<string, string>> {
  const names = new Map(BUILT_IN_SUPPLIERS.map((s) => [s.key, s.name]));
  for (const s of await readSuppliers(orgId).catch(() => [])) names.set(s.key, s.name);
  return names;
}

export async function readStock(orgId: string, week: Week, now = new Date()): Promise<StockView> {
  if (!(await stockReady(orgId))) return { ready: false };
  const { from, to } = weekOf(todayInAu(now), week);
  const jobs = await weekJobs(orgId, from, to);
  const ids = jobs.map((j) => j.uuid);
  if (!ids.length) return { ready: true, week, from, to, jobs: [], items: [], orders: [], noQuote: [], noUnits: [] };
  const [{ data: lineRows }, { data: drafts }, { data: mats }, { data: markRows }] = await Promise.all([
    supabaseAdmin.from("quote_lines").select(QUOTE_COLS).eq("org_id", orgId).in("sm8_job_uuid", ids),
    supabaseAdmin.from("quote_drafts").select("sm8_job_uuid, draft").eq("org_id", orgId).in("sm8_job_uuid", ids),
    supabaseAdmin.from("sm8_job_materials").select("job_uuid, name").eq("org_id", orgId).eq("active", 1).in("job_uuid", ids),
    supabaseAdmin.from("stock_marks").select("sm8_job_uuid, item_key, in_stock, ordered, ordered_from, in_stock_by, in_stock_at, ordered_by, ordered_at").eq("org_id", orgId).in("sm8_job_uuid", ids),
  ]);
  const linesBy = new Map<string, QuoteLine[]>();
  for (const r of (lineRows ?? []) as Record<string, unknown>[]) {
    const l = lineFromRow(r);
    if (!l) continue;
    const k = String(r.sm8_job_uuid);
    linesBy.set(k, [...(linesBy.get(k) ?? []), l]);
  }
  const draftBy = new Map(((drafts ?? []) as { sm8_job_uuid: string; draft: unknown }[]).map((d) => [d.sm8_job_uuid, d.draft]));
  const matsBy = new Map<string, string[]>();
  for (const m of (mats ?? []) as { job_uuid: string; name: string | null }[]) matsBy.set(m.job_uuid, [...(matsBy.get(m.job_uuid) ?? []), m.name ?? ""]);
  const marks = new Map(((markRows ?? []) as MarkRow[]).map((m) => [`${m.sm8_job_uuid}|${m.item_key}`, m]));
  const allLines = [...linesBy.values()].flat();
  const specsRaw = await unitSpecsOf(allLines, orgId).catch(() => new Map());
  const specs = new Map<string, Specs>([...specsRaw].map(([id, s]) => [id, s ? { role: s.role, coolKw: s.coolKw } : null]));
  const names = await namesBySignIn(orgId, ((markRows ?? []) as MarkRow[]).flatMap((m) => [m.in_stock_by ?? "", m.ordered_by ?? ""]));

  const views: StockJobView[] = [];
  const noQuote: StockJob[] = [];
  const noUnits: StockJob[] = [];
  for (const job of jobs) {
    const lines = linesBy.get(job.uuid) ?? [];
    if (!lines.length) {
      noQuote.push(job);
      continue;
    }
    const b = byHandOf(draftBy.get(job.uuid) ?? null);
    const choice = optionChoice(lines, b.accepted, b.variations.map((v) => v.option), matsBy.get(job.uuid) ?? []);
    if (choice.taken === null) {
      views.push({ job, state: "check", from: null, needs: [], choose: choice.options.map((i) => ({ index: i, name: b.names[i]?.trim() || `Option ${i + 1}` })) });
      continue;
    }
    const needs = needsOf(lines, choice.taken, specs).map((n) => {
      const m = marks.get(`${job.uuid}|${n.key}`);
      const mark: Mark = m ? { inStock: m.in_stock, ordered: m.ordered, orderedFrom: m.ordered_from, inStockBy: m.in_stock_by, inStockAt: m.in_stock_at, orderedBy: m.ordered_by, orderedAt: m.ordered_at } : NO_MARK;
      return { ...n, ...mark, need: n.qty, inStockName: mark.inStockBy ? names[mark.inStockBy] ?? null : null, orderedName: mark.orderedBy ? names[mark.orderedBy] ?? null : null };
    });
    if (!needs.some((n) => n.group !== "duct")) {
      noUnits.push(job);
      continue;
    }
    views.push({ job, state: jobState(needs), from: choice.how, needs, choose: null });
  }
  const items = shoppingList(views.filter((v) => v.needs.length).map((v) => ({ job: v.job, needs: v.needs })));
  const [best, supNames] = await Promise.all([cheapest(orgId, [...new Set(items.map((i) => i.code).filter((c): c is string => !!c))]), supplierNames(orgId)]);
  const orders = ordersOf(items, (it) => (it.code ? best.get(it.code.toUpperCase()) : undefined) ?? it.supplierKey).map((o) => ({
    ...o,
    supplierName: o.supplierKey ? supNames.get(o.supplierKey) ?? o.supplierKey : "No supplier",
  }));
  return { ready: true, week, from, to, jobs: views, items, orders, noQuote, noUnits };
}

type Done = { ok: true } | { ok: false; reason: string };
const NOT_READY: Done = { ok: false, reason: "Stock isn't set up on this workspace yet." };

async function upsert(orgId: string, rows: Record<string, unknown>[]): Promise<Done> {
  if (!rows.length) return { ok: true };
  const { error } = await supabaseAdmin.from("stock_marks").upsert(rows.map((r) => ({ org_id: orgId, updated_at: new Date().toISOString(), ...r })), { onConflict: "org_id,sm8_job_uuid,item_key" });
  if (error) return missingTable(error.code) ? NOT_READY : { ok: false, reason: "Couldn't save that. Try again." };
  return { ok: true };
}

/** "We've got `total`" of an item on the week's list (null: all of them),
    shared out earliest booking first. What's ordered for a job its share now
    covers comes off the order. */
export async function setInStock(orgId: string, by: string, week: Week, key: string, total: number | null): Promise<Done> {
  const v = await readStock(orgId, week);
  if (!v.ready) return NOT_READY;
  const it = v.items.find((i) => i.key === key);
  if (!it) return { ok: false, reason: "That's no longer on the list." };
  const share = allocate(total ?? it.need, it.jobs.map((j) => j.need));
  const at = new Date().toISOString();
  const itemKey = it.group === "duct" ? DUCT_KEY : it.key;
  return upsert(
    orgId,
    it.jobs.map((j, i) => {
      const n = share[i]!;
      return { sm8_job_uuid: j.uuid, item_key: itemKey, in_stock: n, ordered: orderedAfter(j.need, n, j.ordered), ...(n !== j.inStock ? { in_stock_by: by, in_stock_at: at } : {}) };
    }),
  );
}

/** The order sent to a supplier: everything still to order from it, on each job. */
export async function markOrdered(orgId: string, by: string, week: Week, supplierKey: string | null): Promise<Done> {
  const v = await readStock(orgId, week);
  if (!v.ready) return NOT_READY;
  const o = v.orders.find((x) => x.supplierKey === supplierKey);
  if (!o) return { ok: false, reason: "Nothing's left to order from them." };
  const at = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const line of o.lines) {
    const it = v.items.find((i) => i.key === line.key);
    for (const j of line.jobs) {
      const had = it?.jobs.find((x) => x.uuid === j.uuid);
      rows.push({ sm8_job_uuid: j.uuid, item_key: line.key, in_stock: had?.inStock ?? 0, ordered: (had ? orderedAfter(had.need, had.inStock, had.ordered) : 0) + j.qty, ordered_from: supplierKey, ordered_by: by, ordered_at: at });
    }
  }
  return upsert(orgId, rows);
}

/** Undo of Mark ordered: the counts put back as they were. */
export async function putMarksBack(orgId: string, rows: readonly { uuid: string; key: string; inStock: number; ordered: number }[]): Promise<Done> {
  return upsert(orgId, rows.map((r) => ({ sm8_job_uuid: r.uuid, item_key: r.key, in_stock: r.inStock, ordered: r.ordered })));
}

/** The client's choice, pressed on Stock: the option marked accepted on the
    quote, as the quote's own Accept does it (its parts on the job's
    materials, its tasks, the milestone in Tiff's thread). Refused once an
    option is accepted, so a second press never takes the mark off. */
export async function takeOption(orgId: string, by: string, jobUuid: string, option: number): Promise<Done> {
  const { data } = await supabaseAdmin.from("quote_drafts").select("draft").eq("org_id", orgId).eq("sm8_job_uuid", jobUuid).maybeSingle();
  if (byHandOf((data as { draft: unknown } | null)?.draft ?? null).accepted.length) return { ok: false, reason: "An option's already accepted on that quote." };
  const i = Math.max(0, Math.min(19, Math.round(option)));
  const marked = await markAccepted(orgId, jobUuid, i, by);
  if (!marked.ok) return { ok: false, reason: marked.reason };
  const session = await readSession(orgId, jobUuid).catch(() => null);
  if (session) await addEvents(orgId, session.id, null, [{ kind: "milestone", author: by, body: { text: `Option ${i + 1} accepted` } }]).catch(() => null);
  await putAcceptedOnJob(orgId, by, jobUuid).catch(() => null);
  await makeTasksFromQuote(orgId, by, jobUuid, { quoteOnly: true }).catch(() => null);
  return { ok: true };
}
