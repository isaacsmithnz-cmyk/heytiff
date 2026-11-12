import type { Hue } from "@/components/parts/state";
import type { QuoteLine } from "@/lib/quotes/lines";

/* STOCK (Isaac, 11 November 2026, the mock
   https://claude.ai/artifact/WQ1yppLgALMhXbHM5XWLDq): what the jobs booked
   next week, or the week after, need, as one shopping list. Walk the factory
   ticking what's there; each one goes to the earliest booking; what's left
   is ordered, supplier by supplier.

   What a job needs is read from its quote each time, never stored: the
   accepted option's unit lines, and its controls (controllers, zoning kits,
   zone motors, sensors) as firm rows; its duct lines as one suggestion. Only
   what people did is kept (docs/migrations/stock_marks.sql). Universal: a
   unit is a line of kind `unit`, a control is named as one, ductwork is a
   line marked `duct`; no business's codes or suppliers. Pure. */

export type Week = "next" | "after";
export type Group = "unit" | "control" | "duct";

/** Monday to Sunday of next week, or the week after, from today (yyyy-mm-dd). */
export function weekOf(today: string, week: Week): { from: string; to: string } {
  const d = new Date(`${today}T12:00:00Z`);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const monday = new Date(d.getTime() + (8 - dow + (week === "after" ? 7 : 0)) * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

const CONTROL = /\b(controllers?|remotes?|zon(e|es|ing)|sensors?|receivers?|thermostats?|interface|dampers?|wi-?fi)\b/i;

/** What a quote line is to Stock, or null: labour, pipe, cable, consumables. */
export function groupOf(l: Pick<QuoteLine, "kind" | "name" | "code" | "duct">): Group | null {
  if (l.kind === "labour") return null;
  if (l.kind === "unit") return "unit";
  if (CONTROL.test(`${l.name} ${l.code ?? ""}`)) return "control";
  return l.duct ? "duct" : null;
}

/** An item's key on a job: its model code, upper-cased, or its name. */
export const itemKeyOf = (l: Pick<QuoteLine, "code" | "name">) => (l.code?.trim() ? l.code.trim().toUpperCase() : `NAME:${l.name.trim().toLowerCase()}`).slice(0, 120);
export const DUCT_KEY = "duct";

/** "Option.2", "Option 1": the option ServiceM8 still has on a job. */
export function sm8Options(names: readonly string[]): number[] {
  const out = new Set<number>();
  for (const n of names) {
    const m = /^\s*option[\s.#]*(\d{1,2})\b/i.exec(n);
    if (m) out.add(Number(m[1]) - 1);
  }
  return [...out].sort((a, b) => a - b);
}

export type OptionChoice = { taken: number[]; how: "accepted" | "only" | "servicem8" } | { taken: null; options: number[] };

/** Which option's lines a job needs: the accepted one; the only one; the one
    ServiceM8 still has where the office deleted the others; or none yet, and
    the job asks. */
export function optionChoice(lines: readonly Pick<QuoteLine, "optionIndex">[], accepted: readonly number[], variations: readonly number[], sm8Names: readonly string[]): OptionChoice {
  if (accepted.length) return { taken: [...accepted], how: "accepted" };
  const options = [...new Set(lines.map((l) => l.optionIndex))].filter((i) => !variations.includes(i)).sort((a, b) => a - b);
  if (options.length <= 1) return { taken: options, how: "only" };
  const left = sm8Options(sm8Names).filter((i) => options.includes(i));
  if (left.length === 1) return { taken: left, how: "servicem8" };
  return { taken: null, options };
}

export type Specs = { role: "indoor" | "outdoor"; coolKw: number | null } | null;

export type Need = {
  key: string;
  code: string | null;
  title: string;
  /** under the title: the line's own name, or the duct lines in a sentence */
  detail: string;
  group: Group;
  qty: number;
  supplierKey: string | null;
};

const kw = (n: number) => `${Math.round(n * 10) / 10} kW`;
const bareName = (name: string) => name.replace(/,\s*(room|zone)\b.*$/i, "").trim() || name;

/** What one job needs, from the lines of the options it took. */
export function needsOf(lines: readonly QuoteLine[], taken: readonly number[], specs: ReadonlyMap<string, Specs>): Need[] {
  const out = new Map<string, Need>();
  const duct: string[] = [];
  for (const l of lines) {
    if (!taken.includes(l.optionIndex)) continue;
    const g = groupOf(l);
    if (!g) continue;
    if (g === "duct") {
      duct.push(`${Math.round(l.qty * 10) / 10} x ${l.name}`);
      continue;
    }
    const key = itemKeyOf(l);
    const s = specs.get(l.id) ?? null;
    const title = g === "unit" && s ? `${s.role === "indoor" ? "Indoor" : "Outdoor"}${s.coolKw ? `, ${kw(s.coolKw)}` : ""}` : bareName(l.name);
    const had = out.get(key);
    if (had) had.qty += l.qty;
    else out.set(key, { key, code: l.code?.trim() || null, title, detail: l.code?.trim() || bareName(l.name), group: g, qty: l.qty, supplierKey: l.supplierKey });
  }
  const list = [...out.values()].map((n) => ({ ...n, qty: Math.max(1, Math.ceil(n.qty)) }));
  if (duct.length) list.push({ key: DUCT_KEY, code: null, title: "Ductwork, suggested", detail: duct.join(", "), group: "duct", qty: 1, supplierKey: null });
  return list;
}

export type Mark = { inStock: number; ordered: number; orderedFrom: string | null; inStockBy: string | null; inStockAt: string | null; orderedBy: string | null; orderedAt: string | null };
export const NO_MARK: Mark = { inStock: 0, ordered: 0, orderedFrom: null, inStockBy: null, inStockAt: null, orderedBy: null, orderedAt: null };

export type StockJob = {
  uuid: string;
  number: string | null;
  client: string | null;
  suburb: string | null;
  hue: Hue;
  kind: string | null;
  /** its first booking in the week, "2026-11-16 07:00:00", local wall time */
  firstAt: string;
  /** people booked on that first day */
  crew: number;
};

/** Earliest booking first: by day and start time, then the job's number. */
export const byBooking = (a: Pick<StockJob, "firstAt" | "number">, b: Pick<StockJob, "firstAt" | "number">) =>
  a.firstAt.localeCompare(b.firstAt) || (a.number ?? "").localeCompare(b.number ?? "", undefined, { numeric: true });

/** `total` on the shelf, shared out earliest booking first: each job's share. */
export function allocate(total: number, needs: readonly number[]): number[] {
  let left = Math.max(0, Math.floor(total));
  return needs.map((n) => {
    const give = Math.min(n, left);
    left -= give;
    return give;
  });
}

/** What's ordered stays only where the shelf doesn't already cover it. */
export const orderedAfter = (need: number, inStock: number, ordered: number) => Math.max(0, Math.min(ordered, need - inStock));

export type JobState = "in" | "ordered" | "order" | "check" | "none";

/** A job's word: everything in (it folds), everything in or ordered, still to order. */
export function jobState(needs: readonly { need: number; inStock: number; ordered: number; group: Group }[]): JobState {
  const firm = needs.filter((n) => n.group !== "duct");
  if (!firm.length) return "none";
  if (firm.every((n) => n.inStock >= n.need)) return "in";
  if (firm.every((n) => n.inStock + n.ordered >= n.need)) return "ordered";
  return "order";
}

export type ItemJob = { uuid: string; number: string | null; firstAt: string; need: number; inStock: number; ordered: number };
export type Item = {
  key: string;
  code: string | null;
  title: string;
  detail: string;
  group: Group;
  need: number;
  inStock: number;
  ordered: number;
  supplierKey: string | null;
  jobs: ItemJob[];
};

export type JobNeeds = { job: StockJob; needs: (Need & Mark & { need: number })[] };

/** The shopping list: every firm need across the week's jobs added up by
    item, and each job's ductwork as its own row; jobs in each earliest first. */
export function shoppingList(jobs: readonly JobNeeds[]): Item[] {
  const items = new Map<string, Item>();
  for (const { job, needs } of [...jobs].sort((a, b) => byBooking(a.job, b.job))) {
    for (const n of needs) {
      const key = n.group === "duct" ? `${DUCT_KEY}:${job.uuid}` : n.key;
      const it = items.get(key) ?? { key, code: n.code, title: n.group === "duct" ? `For ${job.number ?? "a job"}` : n.title, detail: n.detail, group: n.group, need: 0, inStock: 0, ordered: 0, supplierKey: n.supplierKey, jobs: [] };
      it.need += n.need;
      it.inStock += Math.min(n.inStock, n.need);
      it.ordered += orderedAfter(n.need, n.inStock, n.ordered);
      it.jobs.push({ uuid: job.uuid, number: job.number, firstAt: job.firstAt, need: n.need, inStock: n.inStock, ordered: n.ordered });
      items.set(key, it);
    }
  }
  const order: Record<Group, number> = { unit: 0, control: 1, duct: 2 };
  return [...items.values()].sort((a, b) => order[a.group] - order[b.group] || byBooking(a.jobs[0]!, b.jobs[0]!) || a.title.localeCompare(b.title));
}

export type OrderLine = { key: string; code: string | null; title: string; qty: number; jobs: { uuid: string; number: string | null; qty: number }[] };
export type SupplierOrder = { supplierKey: string | null; lines: OrderLine[] };

/** What's left to order, supplier by supplier (the supplier each item is
    bought from, `supplierOf`), ductwork left out as a suggestion. */
export function ordersOf(items: readonly Item[], supplierOf: (it: Item) => string | null): SupplierOrder[] {
  const by = new Map<string | null, OrderLine[]>();
  for (const it of items) {
    if (it.group === "duct") continue;
    const jobs = it.jobs.map((j) => ({ uuid: j.uuid, number: j.number, qty: Math.max(0, j.need - j.inStock - orderedAfter(j.need, j.inStock, j.ordered)) })).filter((j) => j.qty > 0);
    const qty = jobs.reduce((s, j) => s + j.qty, 0);
    if (!qty) continue;
    const s = supplierOf(it);
    by.set(s, [...(by.get(s) ?? []), { key: it.key, code: it.code, title: it.title, qty, jobs }]);
  }
  return [...by.entries()].map(([supplierKey, lines]) => ({ supplierKey, lines })).sort((a, b) => (a.supplierKey === null ? 1 : b.supplierKey === null ? -1 : a.supplierKey.localeCompare(b.supplierKey)));
}

/** The order as text for an email or a supplier's site: a line an item. */
export function orderText(o: SupplierOrder): string {
  return o.lines.map((l) => `${l.qty} x ${l.code ?? l.title}`).join("\n");
}
