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
  bookVisits,
  equipmentOf,
  type EquipmentRow,
  byBooking,
  DUCT_KEY,
  jobState,
  laterOf,
  needsOf,
  NO_MARK,
  openOf,
  optionChoice,
  orderedAfter,
  ordersOf,
  planOf,
  quoteVisit,
  shoppingList,
  weekOf,
  type HadWhere,
  type Item,
  type JobNeed,
  type JobState,
  type LaterSupplier,
  type Mark,
  type OrderedTo,
  type PlanVisit,
  type Specs,
  type StockJob,
  type SupplierOrder,
  type Week,
} from "./stock";

/* STOCK, READ AND TICKED (lib/stock/stock.ts says what's on it). The week's
   jobs come from ServiceM8's scheduled bookings; Later's from the jobs
   accepted (a Work Order, or an option accepted in HeyTiff) whose quote has
   units; what each needs from its HeyTiff quote, each item at the visit it's
   needed at; what's in, had and ordered from stock_marks. Until that table is
   on the database Stock reads as not set up and every press is refused. */

const QUOTE_COLS =
  "id, sm8_job_uuid, option_index, system, grp, position, name, code, supplier_key, kind, qty, unit, cost_cents, sell_cents, source, why, duct, visit, estimate, version, updated_at, updated_by";
const MARK_COLS = "sm8_job_uuid, item_key, in_stock, ordered, ordered_from, ordered_to, ordered_due, order_ref, had, had_where, had_who, needed_at, in_stock_by, in_stock_at, ordered_by, ordered_at";

export type NeedView = JobNeed & { inStockName: string | null; orderedName: string | null };

export type StockJobView = {
  job: StockJob;
  state: JobState;
  /** where its list came from: the accepted option, the only one, the one ServiceM8 kept */
  from: "accepted" | "only" | "servicem8" | null;
  needs: NeedView[];
  /** what it needs at a visit after this week, or one not booked yet */
  later: NeedView[];
  /** the quote's visits, with their bookings: the choices for Needed at */
  visits: Pick<PlanVisit, "n" | "stage" | "at">[];
  /** two options and none taken: the names to choose from */
  choose: { index: number; name: string }[] | null;
};

export type Price = { supplierKey: string; name: string; cents: number };

export type StockView =
  | { ready: false }
  | {
      ready: true;
      week: Week;
      today: string;
      from: string;
      to: string;
      jobs: StockJobView[];
      items: Item[];
      orders: (SupplierOrder & { supplierName: string; orderUrl: string | null })[];
      /** Later: what's still to order, by supplier, at the book's price */
      later: (LaterSupplier & { supplierName: string; orderUrl: string | null })[];
      /** each code's prices in the book, cheapest first: the choices for From */
      prices: Record<string, Price[]>;
      /** booked, but no quote in HeyTiff to read */
      noQuote: StockJob[];
      /** a quote, but no units on what it took */
      noUnits: StockJob[];
    };

type Act = { job_uuid: string; start_date: string; staff_uuid: string | null };
type JobRow = { uuid: string; generated_job_id: string | null; job_address: string | null; company_uuid: string | null; category_uuid: string | null; status: string | null; active: number | null; work_order_date: string | null };
type MarkRow = {
  sm8_job_uuid: string;
  item_key: string;
  in_stock: number;
  ordered: number;
  ordered_from: string | null;
  ordered_to: string | null;
  ordered_due: string | null;
  order_ref: string | null;
  had: number | null;
  had_where: string | null;
  had_who: string | null;
  needed_at: number | null;
  in_stock_by: string | null;
  in_stock_at: string | null;
  ordered_by: string | null;
  ordered_at: string | null;
};

const markOf = (m: MarkRow | undefined): Mark =>
  m
    ? {
        inStock: m.in_stock,
        ordered: m.ordered,
        orderedFrom: m.ordered_from,
        orderedTo: m.ordered_to === "site" ? "site" : "factory",
        orderedDue: m.ordered_due,
        orderRef: m.order_ref,
        had: m.had ?? 0,
        hadWhere: m.had_where === "site" || m.had_where === "van" || m.had_where === "customer" ? m.had_where : null,
        hadWho: m.had_who,
        neededAt: m.needed_at,
        inStockBy: m.in_stock_by,
        inStockAt: m.in_stock_at,
        orderedBy: m.ordered_by,
        orderedAt: m.ordered_at,
      }
    : NO_MARK;

/** Is the table there? A read that the database can't find. */
export async function stockReady(orgId: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from("stock_marks").select("id").eq("org_id", orgId).limit(1);
  return !error || !missingTable(error.code);
}

/** Every scheduled booking on these jobs, by the job however ServiceM8 cased its uuid. */
async function bookingsOf(orgId: string, uuids: readonly string[]): Promise<Map<string, Act[]>> {
  const by = new Map<string, Act[]>();
  for (let i = 0; i < uuids.length; i += 150) {
    const chunk = uuids.slice(i, i + 150);
    const { data } = await supabaseAdmin
      .from("sm8_job_activities")
      .select("job_uuid, start_date, staff_uuid")
      .eq("org_id", orgId)
      .eq("active", 1)
      .eq("activity_was_scheduled", 1)
      .in("job_uuid", [...new Set(chunk.flatMap((u) => [u, u.toLowerCase()]))]);
    for (const a of (data ?? []) as Act[]) if (a.start_date) by.set(a.job_uuid.toLowerCase(), [...(by.get(a.job_uuid.toLowerCase()) ?? []), a]);
  }
  return by;
}

/** The jobs as Stock shows them, each at its first booking from `from` (or its next from today in Later). */
async function jobsOf(orgId: string, rows: readonly JobRow[], acts: ReadonlyMap<string, Act[]>, from: string, to: string): Promise<StockJob[]> {
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
      const list = (acts.get(r.uuid.toLowerCase()) ?? []).filter((a) => a.start_date >= `${from} 00:00:00` && a.start_date <= `${to} 23:59:59`);
      const at = list.length ? list.reduce((m, a) => (a.start_date < m ? a.start_date : m), list[0]!.start_date) : null;
      const staff = at ? new Set(list.filter((a) => a.start_date.slice(0, 10) === at.slice(0, 10) && a.staff_uuid).map((a) => a.staff_uuid!)) : new Set<string>();
      const c = r.category_uuid ? cat.get(r.category_uuid) : undefined;
      return {
        uuid: r.uuid,
        number: r.generated_job_id,
        client: (r.company_uuid ? coName.get(r.company_uuid) : null)?.trim() || null,
        suburb: suburbOf(r.job_address),
        address: r.job_address?.replace(/\s*\n\s*/g, ", ").trim() || null,
        hue: jobHue(c?.colour ? `#${c.colour}` : null, r.status),
        kind: c?.name?.trim() || null,
        firstAt: at,
        crew: Math.max(1, staff.size),
      };
    })
    .sort((a, b) => byBooking({ at: a.firstAt, number: a.number }, { at: b.firstAt, number: b.number }));
}

const JOB_COLS = "uuid, generated_job_id, job_address, company_uuid, category_uuid, status, active, work_order_date";

/** The jobs to read for a week: those with a booking in it. For Later: the
    jobs accepted whose quote has units, not finished. */
async function candidates(orgId: string, week: Week, from: string, to: string): Promise<{ rows: JobRow[]; acts: Map<string, Act[]> }> {
  if (week !== "later") {
    const { data: acts } = await supabaseAdmin
      .from("sm8_job_activities")
      .select("job_uuid")
      .eq("org_id", orgId)
      .eq("active", 1)
      .eq("activity_was_scheduled", 1)
      .gte("start_date", `${from} 00:00:00`)
      .lte("start_date", `${to} 23:59:59`);
    const ids = [...new Set(((acts ?? []) as { job_uuid: string }[]).flatMap((a) => [a.job_uuid, a.job_uuid.toLowerCase()]))];
    if (!ids.length) return { rows: [], acts: new Map() };
    const { data } = await supabaseAdmin.from("sm8_jobs").select(JOB_COLS).eq("org_id", orgId).in("uuid", ids);
    const rows = ((data ?? []) as JobRow[]).filter((j) => j.active !== 0);
    return { rows, acts: await bookingsOf(orgId, rows.map((r) => r.uuid)) };
  }
  const { data: withUnits } = await supabaseAdmin.from("quote_lines").select("sm8_job_uuid").eq("org_id", orgId).eq("kind", "unit");
  const ids = [...new Set(((withUnits ?? []) as { sm8_job_uuid: string }[]).map((r) => r.sm8_job_uuid))];
  if (!ids.length) return { rows: [], acts: new Map() };
  const rows: JobRow[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabaseAdmin.from("sm8_jobs").select(JOB_COLS).eq("org_id", orgId).in("uuid", ids.slice(i, i + 150));
    rows.push(...((data ?? []) as JobRow[]).filter((j) => j.active !== 0 && j.status !== "Completed" && j.status !== "Unsuccessful"));
  }
  const { data: drafts } = rows.length ? await supabaseAdmin.from("quote_drafts").select("sm8_job_uuid, draft").eq("org_id", orgId).in("sm8_job_uuid", rows.map((r) => r.uuid)) : { data: [] };
  const accepted = new Set(((drafts ?? []) as { sm8_job_uuid: string; draft: unknown }[]).filter((d) => byHandOf(d.draft).accepted.length).map((d) => d.sm8_job_uuid));
  const taken = rows.filter((r) => r.status === "Work Order" || accepted.has(r.uuid));
  return { rows: taken, acts: await bookingsOf(orgId, taken.map((r) => r.uuid)) };
}

/** The book's prices for each code, cheapest first. */
async function pricesOf(orgId: string, codes: readonly string[], names: ReadonlyMap<string, string>): Promise<Record<string, Price[]>> {
  const out: Record<string, Price[]> = {};
  for (let i = 0; i < codes.length; i += 150) {
    const { data } = await supabaseAdmin.from("quote_price_items").select("supplier_key, code, cents").eq("org_id", orgId).eq("current", true).in("code", codes.slice(i, i + 150));
    for (const r of (data ?? []) as { supplier_key: string; code: string; cents: number | null }[]) {
      if (r.cents == null) continue;
      const k = r.code.toUpperCase();
      const list = (out[k] ??= []);
      const had = list.find((p) => p.supplierKey === r.supplier_key);
      if (had) had.cents = Math.min(had.cents, r.cents);
      else list.push({ supplierKey: r.supplier_key, name: names.get(r.supplier_key) ?? r.supplier_key, cents: r.cents });
    }
  }
  for (const k of Object.keys(out)) out[k]!.sort((a, b) => a.cents - b.cents);
  return out;
}

export async function supplierInfo(orgId: string): Promise<Map<string, { name: string; orderUrl: string | null }>> {
  const info = new Map(BUILT_IN_SUPPLIERS.map((s) => [s.key, { name: s.name, orderUrl: null as string | null }]));
  for (const s of await readSuppliers(orgId).catch(() => [])) info.set(s.key, { name: s.name, orderUrl: null });
  const { data } = await supabaseAdmin.from("quote_suppliers").select("key, order_url").eq("org_id", orgId);
  for (const r of (data ?? []) as { key: string; order_url: string | null }[]) {
    const had = info.get(r.key);
    if (had) had.orderUrl = r.order_url?.trim() || null;
  }
  return info;
}

/** Each job's needs, each at the visit it's needed at and when that's booked. */
async function needsOfJobs(orgId: string, jobs: readonly StockJob[], rows: readonly JobRow[], acts: ReadonlyMap<string, Act[]>, today: string) {
  const ids = jobs.map((j) => j.uuid);
  const [{ data: lineRows }, { data: drafts }, { data: mats }, { data: markRows }] = await Promise.all([
    supabaseAdmin.from("quote_lines").select(QUOTE_COLS).eq("org_id", orgId).in("sm8_job_uuid", ids),
    supabaseAdmin.from("quote_drafts").select("sm8_job_uuid, draft").eq("org_id", orgId).in("sm8_job_uuid", ids),
    supabaseAdmin.from("sm8_job_materials").select("job_uuid, name").eq("org_id", orgId).eq("active", 1).in("job_uuid", ids),
    supabaseAdmin.from("stock_marks").select(MARK_COLS).eq("org_id", orgId).in("sm8_job_uuid", ids),
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
  for (const m of (mats ?? []) as { job_uuid: string; name: string | null }[]) matsBy.set(m.job_uuid.toLowerCase(), [...(matsBy.get(m.job_uuid.toLowerCase()) ?? []), m.name ?? ""]);
  const marks = new Map(((markRows ?? []) as MarkRow[]).map((m) => [`${m.sm8_job_uuid}|${m.item_key}`, m]));
  const rowBy = new Map(rows.map((r) => [r.uuid, r]));
  const allLines = [...linesBy.values()].flat();
  const specsRaw = await unitSpecsOf(allLines, orgId).catch(() => new Map());
  const specs = new Map<string, Specs>([...specsRaw].map(([id, s]) => [id, s ? { role: s.role, coolKw: s.coolKw } : null]));
  const names = await namesBySignIn(orgId, ((markRows ?? []) as MarkRow[]).flatMap((m) => [m.in_stock_by ?? "", m.ordered_by ?? ""]));

  return jobs.map((job) => {
    const lines = linesBy.get(job.uuid) ?? [];
    if (!lines.length) return { job, lines: false as const };
    const b = byHandOf(draftBy.get(job.uuid) ?? null);
    const choice = optionChoice(lines, b.accepted, b.variations.map((v) => v.option), matsBy.get(job.uuid.toLowerCase()) ?? []);
    if (choice.taken === null) return { job, lines: true as const, how: null, choose: choice.options.map((i) => ({ index: i, name: b.names[i]?.trim() || `Option ${i + 1}` })), needs: [], visits: [] as PlanVisit[] };
    /* the job's booked days from its work order on, one start a day; with no
       work order yet (still a Quote in ServiceM8), from today: a booking
       before it was won was the measure or the quote visit, not one of its
       visits */
    const wo = (rowBy.get(job.uuid)?.work_order_date ?? "").slice(0, 10) || today;
    const booked = (acts.get(job.uuid.toLowerCase()) ?? []).map((a) => a.start_date).filter((s) => s.slice(0, 10) >= wo);
    const visits = bookVisits(planOf(lines, choice.taken), booked);
    const next = [...booked].sort().find((s) => s.slice(0, 10) >= today) ?? null;
    const needs: NeedView[] = needsOf(lines, choice.taken, specs).map((n) => {
      const m = markOf(marks.get(`${job.uuid}|${n.key}`));
      const pick = quoteVisit(n, visits);
      const chosen = m.neededAt && m.neededAt <= visits.length ? m.neededAt : pick;
      const v = chosen ? visits[chosen - 1]! : null;
      return {
        ...n,
        ...m,
        need: n.qty,
        visit: v ? { n: v.n, stage: v.stage, byHand: chosen !== pick } : null,
        at: v ? v.at : (job.firstAt ?? next),
        inStockName: m.inStockBy ? names[m.inStockBy] ?? null : null,
        orderedName: m.orderedBy ? names[m.orderedBy] ?? null : null,
      };
    });
    return { job, lines: true as const, how: choice.how, choose: null, needs, visits };
  });
}

const inRange = (at: string | null, from: string, to: string) => !!at && at.slice(0, 10) >= from && at.slice(0, 10) <= to;

export async function readStock(orgId: string, week: Week, now = new Date()): Promise<StockView> {
  if (!(await stockReady(orgId))) return { ready: false };
  const today = todayInAu(now);
  const { from, to } = weekOf(today, week);
  const twoWeeksEnd = weekOf(today, "after").to;
  const empty = { ready: true as const, week, today, from, to, jobs: [], items: [], orders: [], later: [], prices: {}, noQuote: [], noUnits: [] };
  const { rows, acts } = await candidates(orgId, week, from, to);
  if (!rows.length) return empty;
  /* Later: each job at its next booking from today, if it has one */
  const jobs = await jobsOf(orgId, rows, acts, week === "later" ? today : from, week === "later" ? "9999-12-31" : to);
  const read = await needsOfJobs(orgId, jobs, rows, acts, today);

  const views: StockJobView[] = [];
  const noQuote: StockJob[] = [];
  const noUnits: StockJob[] = [];
  for (const r of read) {
    if (!r.lines) {
      if (week !== "later") noQuote.push(r.job);
      continue;
    }
    if (r.choose) {
      if (week !== "later") views.push({ job: r.job, state: "check", from: null, needs: [], later: [], visits: [], choose: r.choose });
      continue;
    }
    if (!r.needs.some((n) => n.group !== "duct")) {
      if (week !== "later") noUnits.push(r.job);
      continue;
    }
    const mine =
      week === "later"
        ? r.needs.filter((n) => n.group !== "duct" && (n.at === null || n.at.slice(0, 10) > twoWeeksEnd))
        : r.needs.filter((n) => inRange(n.at, from, to));
    const later = week === "later" ? [] : r.needs.filter((n) => n.group !== "duct" && (n.at === null || n.at.slice(0, 10) > to));
    if (!mine.length && !later.length) continue;
    views.push({ job: r.job, state: jobState(mine), from: r.how, needs: mine, later, visits: r.visits.map((v) => ({ n: v.n, stage: v.stage, at: v.at })), choose: null });
  }
  const items = shoppingList(views.filter((v) => v.needs.length).map((v) => ({ job: v.job, needs: v.needs })));
  const info = await supplierInfo(orgId);
  const names = new Map([...info].map(([k, v]) => [k, v.name]));
  const prices = await pricesOf(orgId, [...new Set(items.map((i) => i.code?.toUpperCase()).filter((c): c is string => !!c))], names);
  const supplierOf = (it: Item) => (it.code ? prices[it.code.toUpperCase()]?.[0]?.supplierKey : undefined) ?? it.supplierKey;
  const named = <T extends { supplierKey: string | null }>(o: T) => ({
    ...o,
    supplierName: o.supplierKey ? info.get(o.supplierKey)?.name ?? o.supplierKey : "No supplier",
    orderUrl: o.supplierKey ? info.get(o.supplierKey)?.orderUrl ?? null : null,
  });
  if (week === "later") {
    const later = laterOf(items, supplierOf, (it) => (it.code ? prices[it.code.toUpperCase()]?.[0]?.cents ?? null : null)).map(named);
    return { ...empty, jobs: views, items, later, prices };
  }
  const orders = ordersOf(items, supplierOf).map(named);
  return { ...empty, jobs: views, items, orders, prices, noQuote, noUnits };
}

/** One job's equipment, every visit, for its card: what Stock knows of it. Empty when there's nothing to show. */
export async function readJobEquipment(orgId: string, jobUuid: string, now = new Date()): Promise<EquipmentRow[]> {
  const r = await readJobStock(orgId, jobUuid, now).catch(() => null);
  return r ? equipmentOf(r.needs, r.today) : [];
}

async function readJobStock(orgId: string, jobUuid: string, now = new Date()): Promise<{ today: string; needs: NeedView[]; address: string | null } | null> {
  if (!(await stockReady(orgId))) return null;
  const today = todayInAu(now);
  const { data } = await supabaseAdmin.from("sm8_jobs").select(JOB_COLS).eq("org_id", orgId).eq("uuid", jobUuid).maybeSingle();
  const row = data as JobRow | null;
  if (!row) return null;
  const acts = await bookingsOf(orgId, [row.uuid]);
  const [job] = await jobsOf(orgId, [row], acts, today, "9999-12-31");
  const [r] = await needsOfJobs(orgId, [job!], [row], acts, today);
  if (!r || !r.lines || r.choose || !r.needs.some((n) => n.group !== "duct")) return null;
  return { today, needs: r.needs, address: job!.address };
}

type Done = { ok: true } | { ok: false; reason: string };
const NOT_READY: Done = { ok: false, reason: "Stock isn't set up on this workspace yet." };

async function upsert(orgId: string, rows: Record<string, unknown>[]): Promise<Done> {
  if (!rows.length) return { ok: true };
  const { error } = await supabaseAdmin.from("stock_marks").upsert(rows.map((r) => ({ org_id: orgId, updated_at: new Date().toISOString(), ...r })), { onConflict: "org_id,sm8_job_uuid,item_key" });
  if (error) return missingTable(error.code) ? NOT_READY : { ok: false, reason: "Couldn't save that. Try again." };
  return { ok: true };
}

const keyOn = (it: Item) => (it.group === "duct" ? DUCT_KEY : it.key);

/** "We've got `total`" of an item on the week's list (null: all of them),
    shared out earliest booking first, after what each job already has
    elsewhere. What's ordered for a job its share now covers comes off the order. */
export async function setInStock(orgId: string, by: string, week: Week, key: string, total: number | null): Promise<Done> {
  const v = await readStock(orgId, week);
  if (!v.ready) return NOT_READY;
  const it = v.items.find((i) => i.key === key);
  if (!it) return { ok: false, reason: "That's no longer on the list." };
  const wants = it.jobs.map((j) => Math.max(0, j.need - j.had));
  const share = allocate(total ?? wants.reduce((s, n) => s + n, 0), wants);
  const at = new Date().toISOString();
  return upsert(
    orgId,
    it.jobs.map((j, i) => {
      const n = share[i]!;
      return { sm8_job_uuid: j.uuid, item_key: keyOn(it), in_stock: n, ordered: orderedAfter(j.need, n, j.ordered, j.had), ...(n !== j.inStock ? { in_stock_by: by, in_stock_at: at } : {}) };
    }),
  );
}

export type OrderHow = { supplierKey: string | null; to: OrderedTo; due: string | null; ref: string | null };
const dayOk = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const refOk = (r: string | null | undefined) => r?.trim().slice(0, 60) || null;

/** One item ordered on its own: what's still to order of it, on each job. */
export async function orderItem(orgId: string, by: string, week: Week, key: string, how: OrderHow): Promise<Done> {
  const v = await readStock(orgId, week);
  if (!v.ready) return NOT_READY;
  const it = v.items.find((i) => i.key === key);
  if (!it || it.group === "duct") return { ok: false, reason: "That's no longer on the list." };
  const at = new Date().toISOString();
  const rows = it.jobs
    .filter((j) => openOf(j) > 0)
    .map((j) => ({
      sm8_job_uuid: j.uuid,
      item_key: it.key,
      ordered: orderedAfter(j.need, j.inStock, j.ordered, j.had) + openOf(j),
      ordered_from: how.supplierKey,
      ordered_to: how.to,
      ordered_due: dayOk(how.due),
      order_ref: refOk(how.ref),
      ordered_by: by,
      ordered_at: at,
    }));
  if (!rows.length) return { ok: false, reason: "Nothing's left to order of it." };
  return upsert(orgId, rows);
}

/** A supplier's lot sent: everything still to order from it, each job's part
    to the factory or, for the jobs in `sites`, straight to its site, with the
    day each drop lands. */
export async function markOrdered(orgId: string, by: string, week: Week, supplierKey: string | null, drops: { sites: readonly string[]; due: { factory: string | null; sites: Record<string, string | null> }; ref: string | null }): Promise<Done> {
  const v = await readStock(orgId, week);
  if (!v.ready) return NOT_READY;
  const o = v.orders.find((x) => x.supplierKey === supplierKey);
  if (!o) return { ok: false, reason: "Nothing's left to order from them." };
  const at = new Date().toISOString();
  const sites = new Set(drops.sites);
  const rows: Record<string, unknown>[] = [];
  for (const line of o.lines) {
    const it = v.items.find((i) => i.key === line.key);
    for (const j of line.jobs) {
      const had = it?.jobs.find((x) => x.uuid === j.uuid);
      const site = sites.has(j.uuid);
      rows.push({
        sm8_job_uuid: j.uuid,
        item_key: line.key,
        ordered: (had ? orderedAfter(had.need, had.inStock, had.ordered, had.had) : 0) + j.qty,
        ordered_from: supplierKey,
        ordered_to: site ? "site" : "factory",
        ordered_due: dayOk(site ? drops.due.sites[j.uuid] : drops.due.factory),
        order_ref: refOk(drops.ref),
        ordered_by: by,
        ordered_at: at,
      });
    }
  }
  return upsert(orgId, rows);
}

/** Later's bulk order: what's still to order from a supplier, for the jobs ticked. */
export async function orderForJobs(orgId: string, by: string, supplierKey: string | null, jobUuids: readonly string[], how: Omit<OrderHow, "supplierKey">): Promise<Done> {
  const v = await readStock(orgId, "later");
  if (!v.ready) return NOT_READY;
  const s = v.later.find((x) => x.supplierKey === supplierKey);
  if (!s) return { ok: false, reason: "Nothing's left to order from them." };
  const pick = new Set(jobUuids);
  const at = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const line of s.lines) {
    const it = v.items.find((i) => i.key === line.key);
    for (const j of line.jobs.filter((x) => pick.has(x.uuid))) {
      const had = it?.jobs.find((x) => x.uuid === j.uuid);
      rows.push({
        sm8_job_uuid: j.uuid,
        item_key: line.key,
        ordered: (had ? orderedAfter(had.need, had.inStock, had.ordered, had.had) : 0) + j.qty,
        ordered_from: supplierKey,
        ordered_to: how.to,
        ordered_due: dayOk(how.due),
        order_ref: refOk(how.ref),
        ordered_by: by,
        ordered_at: at,
      });
    }
  }
  if (!rows.length) return { ok: false, reason: "Tick a job first." };
  return upsert(orgId, rows);
}

/** Already have them: what's still to order of an item, on each job, is had
    elsewhere: on site, in someone's van, or the customer's. */
export async function setHad(orgId: string, week: Week, key: string, where: HadWhere, who: string | null): Promise<Done> {
  const v = await readStock(orgId, week);
  if (!v.ready) return NOT_READY;
  const it = v.items.find((i) => i.key === key);
  if (!it || it.group === "duct") return { ok: false, reason: "That's no longer on the list." };
  const rows = it.jobs
    .filter((j) => openOf(j) > 0)
    .map((j) => ({ sm8_job_uuid: j.uuid, item_key: it.key, had: j.had + openOf(j), had_where: where, had_who: where === "van" ? who?.trim().slice(0, 80) || null : null }));
  if (!rows.length) return { ok: false, reason: "Nothing's left to order of it." };
  return upsert(orgId, rows);
}

/** Needed at: the visit an item is wanted on a job, changed by hand; null puts the quote's pick back. */
export async function setNeededAt(orgId: string, jobUuid: string, key: string, visit: number | null): Promise<Done> {
  const n = visit == null ? null : Math.max(1, Math.min(60, Math.round(visit)));
  return upsert(orgId, [{ sm8_job_uuid: jobUuid, item_key: key.slice(0, 120), needed_at: n }]);
}

export type MarkSnap = { uuid: string; key: string; inStock: number; ordered: number; had: number; orderedTo: OrderedTo; orderedDue: string | null; orderRef: string | null; hadWhere: HadWhere | null; hadWho: string | null };

/** Undo: the marks put back as they were. */
export async function putMarksBack(orgId: string, rows: readonly MarkSnap[]): Promise<Done> {
  return upsert(
    orgId,
    rows.map((r) => ({
      sm8_job_uuid: r.uuid,
      item_key: r.key,
      in_stock: Math.max(0, Math.round(r.inStock)),
      ordered: Math.max(0, Math.round(r.ordered)),
      had: Math.max(0, Math.round(r.had ?? 0)),
      ordered_to: r.orderedTo === "site" ? "site" : "factory",
      ordered_due: dayOk(r.orderedDue),
      order_ref: refOk(r.orderRef),
      had_where: r.hadWhere === "site" || r.hadWhere === "van" || r.hadWhere === "customer" ? r.hadWhere : null,
      had_who: r.hadWho?.slice(0, 80) ?? null,
    })),
  );
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

/** A supplier's ordering site, kept for Open their site; an empty one takes it off. */
export async function setOrderUrl(orgId: string, supplierKey: string, url: string): Promise<Done> {
  const u = url.trim();
  if (u && !/^https?:\/\/[^\s]+$/i.test(u)) return { ok: false, reason: "That doesn't look like a web address." };
  const { data, error } = await supabaseAdmin.from("quote_suppliers").update({ order_url: u ? u.slice(0, 300) : null }).eq("org_id", orgId).eq("key", supplierKey).select("key");
  if (error) return { ok: false, reason: "Couldn't save that. Try again." };
  if (!(data ?? []).length) return { ok: false, reason: "Add the supplier to the price book first." };
  return { ok: true };
}
