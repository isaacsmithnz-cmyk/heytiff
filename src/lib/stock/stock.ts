import type { Hue } from "@/components/parts/state";
import type { QuoteLine } from "@/lib/quotes/lines";
import { visitDays } from "@/lib/quotes/line-visit";

/* STOCK (Isaac, 11 November 2026, the mock
   https://claude.ai/artifact/WQ1yppLgALMhXbHM5XWLDq): what the jobs booked
   next week, or the week after, need, as one shopping list. Walk the factory
   ticking what's there; each one goes to the earliest booking; what's left
   is ordered, supplier by supplier.

   ORDERING (13 November 2026, https://claude.ai/artifact/MpMUX46rk45j6dP6ZYnEsu,
   "Build it"): an order goes to the factory or straight to the job's site,
   with the day it lands; what we already have elsewhere (on site, in a van,
   the customer's) counts as covered; a job over many visits needs each item
   at one of them, so the units for an Install a month out stay off this
   week's list; and Later is everything the accepted jobs need past the two
   weeks, for buying ahead.

   What a job needs is read from its quote each time, never stored: the
   accepted option's unit lines, and its controls (controllers, zoning kits,
   zone motors, sensors) as firm rows; its duct lines as one suggestion. Only
   what people did is kept (docs/migrations/stock_marks.sql,
   stock_ordering.sql). Universal: a unit is a line of kind `unit`, a control
   is named as one, ductwork is a line marked `duct`; no business's codes or
   suppliers. Pure. */

export type Week = "next" | "after" | "later";
export type Group = "unit" | "control" | "duct";
export type HadWhere = "site" | "van" | "customer";
export type OrderedTo = "factory" | "site";

const addDays = (day: string, n: number) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Monday to Sunday of next week, or the week after, from today (yyyy-mm-dd);
    Later runs from the Monday after those two, with no end. */
export function weekOf(today: string, week: Week): { from: string; to: string } {
  const d = new Date(`${today}T12:00:00Z`);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const monday = addDays(today, 8 - dow + (week === "after" ? 7 : week === "later" ? 14 : 0));
  return { from: monday, to: week === "later" ? "9999-12-31" : addDays(monday, 6) };
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
  /** a unit's side, to tell which visit hangs it */
  role: "indoor" | "outdoor" | null;
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
    else out.set(key, { key, code: l.code?.trim() || null, title, detail: l.code?.trim() || bareName(l.name), group: g, qty: l.qty, supplierKey: l.supplierKey, role: g === "unit" ? (s?.role ?? null) : null });
  }
  const list = [...out.values()].map((n) => ({ ...n, qty: Math.max(1, Math.ceil(n.qty)) }));
  if (duct.length) list.push({ key: DUCT_KEY, code: null, title: "Ductwork, suggested", detail: duct.join(", "), group: "duct", qty: 1, supplierKey: null, role: null });
  return list;
}

/* ---------- A JOB OVER MANY VISITS ---------- */

/** A visit the quote plans, in order, and the booking it falls on. */
export type PlanVisit = {
  /** counted from 1, in the quote's order */
  n: number;
  stage: string;
  tasks: string[];
  /** whole days it takes: a part day is a day of its own */
  days: number;
  /** its first booked day's start ("2026-12-07 07:00:00"), or null: not booked yet */
  at: string | null;
};

/** The visits the taken options' labour lines plan, in the quote's order. */
export function planOf(lines: readonly QuoteLine[], taken: readonly number[]): Omit<PlanVisit, "n" | "at">[] {
  return lines
    .filter((l) => l.kind === "labour" && l.visit && taken.includes(l.optionIndex))
    .sort((a, b) => taken.indexOf(a.optionIndex) - taken.indexOf(b.optionIndex) || a.position - b.position)
    .map((l) => ({ stage: l.visit!.stage, tasks: l.visit!.tasks.map((t) => t.task), days: Math.max(1, Math.ceil((visitDays(l.visit!) ?? 1) - 1e-9)) }));
}

/** Each visit on the job's booked days, in order: visit 1 on the first day,
    visit 2 on the day after visit 1's last, and so on, as the wrap-up's What
    got done counts them. `booked` is each booked day's start, one a day. */
export function bookVisits(plan: readonly Omit<PlanVisit, "n" | "at">[], booked: readonly string[]): PlanVisit[] {
  const days = [...new Map([...booked].sort().map((b) => [b.slice(0, 10), b])).values()];
  let i = 0;
  return plan.map((v, k) => {
    const at = days[i] ?? null;
    i += v.days;
    return { ...v, n: k + 1, at };
  });
}

const VERB = /\b(hang|hung|hanging|mount|mounted|mounting|place|placed|fit|fitted|fitting|install|installed|hoist|hoisted|lift|lifted|position)\b|\bset\b(?![\s-]*(out|up)\b)/i;
const INDOOR = /\b(indoors?|heads?|bulkheads?|cassettes?|consoles?|high ?walls?|ducted|fan ?coils?)\b/i;
const OUTDOOR = /\b(outdoors?|condens(er|ers|ing))\b/i;
const ANY_UNIT = /\b(units?|indoors?|outdoors?|heads?)\b/i;
const DAMPER = /\b(dampers?|motors?)\b/i;
const SENSOR = /\b(sensors?|receivers?)\b/i;
const CONTROLLER = /\b(controllers?|interfaces?|wi-?fi|thermostats?|remotes?)\b/i;
const BRACKET = /\bbrackets?\b/i;
const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The visit the quote needs an item at: the first whose tasks fit or hang
    it ("Hang 3 bulkhead heads", "5 zone dampers fitted in their runs"); with
    none that says, a unit or control at the first Install (else Fit-off),
    zone motors and ductwork at the first Rough-in. Null with one visit or
    none: the job's first booking is the day. */
export function quoteVisit(n: Pick<Need, "group" | "title" | "code" | "role">, visits: readonly Pick<PlanVisit, "n" | "stage" | "tasks">[]): number | null {
  if (visits.length < 2) return null;
  const code = n.code ? alnum(n.code).slice(0, 8) : "";
  const kind = n.group === "control" ? (DAMPER.test(n.title) ? DAMPER : SENSOR.test(n.title) ? SENSOR : CONTROLLER) : null;
  const says = (t: string) => {
    if (code.length >= 5 && alnum(t).includes(code)) return true;
    if (n.group === "duct" || !VERB.test(t)) return false;
    /* "Fit 2 outdoor wall brackets" readies the wall, not the unit */
    if (BRACKET.test(t) && !/\b(units?|heads?)\b/i.test(t)) return false;
    if (kind) return kind.test(t);
    return n.role === "indoor" ? INDOOR.test(t) : n.role === "outdoor" ? OUTDOOR.test(t) : ANY_UNIT.test(t);
  };
  const hit = visits.find((v) => v.tasks.some(says));
  if (hit) return hit.n;
  const stage = (re: RegExp) => visits.find((v) => re.test(v.stage))?.n ?? null;
  if (n.group === "duct" || kind === DAMPER) return stage(/rough/i) ?? stage(/install/i) ?? visits[0]!.n;
  return stage(/install/i) ?? stage(/fit|commission/i) ?? visits[visits.length - 1]!.n;
}

/* ---------- WHAT PEOPLE DID ---------- */

export type Mark = {
  inStock: number;
  ordered: number;
  orderedFrom: string | null;
  orderedTo: OrderedTo;
  orderedDue: string | null;
  orderRef: string | null;
  had: number;
  hadWhere: HadWhere | null;
  hadWho: string | null;
  /** the visit it's needed at, changed by hand */
  neededAt: number | null;
  inStockBy: string | null;
  inStockAt: string | null;
  orderedBy: string | null;
  orderedAt: string | null;
};
export const NO_MARK: Mark = { inStock: 0, ordered: 0, orderedFrom: null, orderedTo: "factory", orderedDue: null, orderRef: null, had: 0, hadWhere: null, hadWho: null, neededAt: null, inStockBy: null, inStockAt: null, orderedBy: null, orderedAt: null };

export type StockJob = {
  uuid: string;
  number: string | null;
  client: string | null;
  suburb: string | null;
  /** where an order to site goes */
  address: string | null;
  hue: Hue;
  kind: string | null;
  /** its first booking in the week, "2026-11-16 07:00:00", local wall time; null when it has none (Later) */
  firstAt: string | null;
  /** people booked on that first day */
  crew: number;
};

/** Earliest booking first: by day and start time, then the job's number; unbooked last. */
export const byBooking = (a: { at: string | null; number: string | null }, b: { at: string | null; number: string | null }) =>
  (a.at ?? "~").localeCompare(b.at ?? "~") || (a.number ?? "").localeCompare(b.number ?? "", undefined, { numeric: true });

/** `total` on the shelf, shared out earliest booking first: each job's share. */
export function allocate(total: number, needs: readonly number[]): number[] {
  let left = Math.max(0, Math.floor(total));
  return needs.map((n) => {
    const give = Math.min(Math.max(0, n), left);
    left -= give;
    return give;
  });
}

/** What's ordered stays only where the shelf, and what we had, don't already cover it. */
export const orderedAfter = (need: number, inStock: number, ordered: number, had = 0) => Math.max(0, Math.min(ordered, need - inStock - had));

type Counts = { need: number; inStock: number; ordered: number; had: number; orderedTo: OrderedTo };
/** Covered: in the factory, already had elsewhere, or ordered straight to site. */
export const coveredOf = (n: Counts) => Math.min(n.need, n.inStock + n.had + (n.orderedTo === "site" ? orderedAfter(n.need, n.inStock, n.ordered, n.had) : 0));
/** Still to order: neither in, had, nor ordered. */
export const openOf = (n: Counts) => Math.max(0, n.need - n.inStock - n.had - orderedAfter(n.need, n.inStock, n.ordered, n.had));
/** Ordered, and the supplier said a day later than the visit it's for. */
export const lateOf = (n: Counts & { orderedDue: string | null; at: string | null }) => orderedAfter(n.need, n.inStock, n.ordered, n.had) > 0 && !!n.orderedDue && !!n.at && n.orderedDue > n.at.slice(0, 10);

export type JobState = "in" | "late" | "ordered" | "order" | "check" | "none";

/** A job's word: everything covered (it folds), something due after its day,
    everything covered or ordered, still to order. Ductwork is left out. */
export function jobState(needs: readonly (Counts & { group: Group; orderedDue: string | null; at: string | null })[]): JobState {
  const firm = needs.filter((n) => n.group !== "duct");
  if (!firm.length) return "none";
  if (firm.every((n) => coveredOf(n) >= n.need)) return "in";
  if (firm.some(lateOf)) return "late";
  if (firm.every((n) => openOf(n) === 0)) return "ordered";
  return "order";
}

/** A need on a job, with what's been done about it and when it's wanted. */
export type JobNeed = Need &
  Mark & {
    need: number;
    /** the visit it's needed at, and when that's booked; null with no visits */
    visit: { n: number; stage: string; byHand: boolean } | null;
    /** when it's wanted: its visit's booking, or the job's first in the week; null: not booked */
    at: string | null;
  };
export type JobNeeds = { job: StockJob; needs: JobNeed[] };

export type ItemJob = {
  uuid: string;
  number: string | null;
  at: string | null;
  need: number;
  inStock: number;
  ordered: number;
  had: number;
  orderedTo: OrderedTo;
  orderedDue: string | null;
  orderRef: string | null;
  hadWhere: HadWhere | null;
  hadWho: string | null;
  visit: JobNeed["visit"];
};
export type Item = {
  key: string;
  code: string | null;
  title: string;
  detail: string;
  group: Group;
  need: number;
  inStock: number;
  ordered: number;
  had: number;
  /** covered: in, had, or ordered to site */
  covered: number;
  /** neither in, had, nor ordered */
  open: number;
  /** an order due after the visit it's for */
  late: boolean;
  supplierKey: string | null;
  jobs: ItemJob[];
};

/** The shopping list: every firm need across the jobs added up by item, and
    each job's ductwork as its own row; jobs in each by when they're wanted. */
export function shoppingList(jobs: readonly JobNeeds[]): Item[] {
  const items = new Map<string, Item>();
  const all = jobs.flatMap(({ job, needs }) => needs.map((n) => ({ job, n })));
  all.sort((a, b) => byBooking({ at: a.n.at, number: a.job.number }, { at: b.n.at, number: b.job.number }));
  for (const { job, n } of all) {
    const key = n.group === "duct" ? `${DUCT_KEY}:${job.uuid}` : n.key;
    const it = items.get(key) ?? { key, code: n.code, title: n.group === "duct" ? `For ${job.number ?? "a job"}` : n.title, detail: n.detail, group: n.group, need: 0, inStock: 0, ordered: 0, had: 0, covered: 0, open: 0, late: false, supplierKey: n.supplierKey, jobs: [] };
    it.need += n.need;
    it.inStock += Math.min(n.inStock, n.need);
    it.had += Math.min(n.had, Math.max(0, n.need - n.inStock));
    it.ordered += orderedAfter(n.need, n.inStock, n.ordered, n.had);
    it.covered += coveredOf(n);
    it.open += openOf(n);
    it.late ||= lateOf(n);
    it.jobs.push({ uuid: job.uuid, number: job.number, at: n.at, need: n.need, inStock: n.inStock, ordered: n.ordered, had: n.had, orderedTo: n.orderedTo, orderedDue: n.orderedDue, orderRef: n.orderRef, hadWhere: n.hadWhere, hadWho: n.hadWho, visit: n.visit });
    items.set(key, it);
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
    const jobs = it.jobs.map((j) => ({ uuid: j.uuid, number: j.number, qty: openOf(j) })).filter((j) => j.qty > 0);
    const qty = jobs.reduce((s, j) => s + j.qty, 0);
    if (!qty) continue;
    const s = supplierOf(it);
    by.set(s, [...(by.get(s) ?? []), { key: it.key, code: it.code, title: it.title, qty, jobs }]);
  }
  return [...by.entries()].map(([supplierKey, lines]) => ({ supplierKey, lines })).sort((a, b) => (a.supplierKey === null ? 1 : b.supplierKey === null ? -1 : a.supplierKey.localeCompare(b.supplierKey)));
}

/** A supplier's lot split by where it goes: the factory, then each job sent to its site. */
export function dropsOf(o: SupplierOrder, toSite: ReadonlySet<string>): { site: string | null; lines: OrderLine[] }[] {
  const factory: OrderLine[] = [];
  const sites = new Map<string, OrderLine[]>();
  for (const l of o.lines) {
    const f = l.jobs.filter((j) => !toSite.has(j.uuid));
    if (f.length) factory.push({ ...l, qty: f.reduce((s, j) => s + j.qty, 0), jobs: f });
    for (const j of l.jobs.filter((x) => toSite.has(x.uuid))) sites.set(j.uuid, [...(sites.get(j.uuid) ?? []), { ...l, qty: j.qty, jobs: [j] }]);
  }
  return [...(factory.length ? [{ site: null, lines: factory }] : []), ...[...sites].map(([site, lines]) => ({ site, lines }))];
}

/** Every unit and control the jobs need, by supplier, with how many of each
    are still to order and what they come to at the book's price: Later's
    list, for a bulk order or a supplier's deal. */
export type LaterLine = { key: string; code: string | null; title: string; qty: number; cents: number | null; jobs: { uuid: string; number: string | null; qty: number; at: string | null }[] };
export type LaterSupplier = { supplierKey: string | null; units: number; jobs: number; cents: number; unpriced: number; lines: LaterLine[] };
export function laterOf(items: readonly Item[], supplierOf: (it: Item) => string | null, centsOf: (it: Item) => number | null): LaterSupplier[] {
  const by = new Map<string | null, LaterLine[]>();
  for (const it of items) {
    if (it.group === "duct") continue;
    const jobs = it.jobs.map((j) => ({ uuid: j.uuid, number: j.number, qty: openOf(j), at: j.at })).filter((j) => j.qty > 0);
    const qty = jobs.reduce((s, j) => s + j.qty, 0);
    if (!qty) continue;
    const s = supplierOf(it);
    by.set(s, [...(by.get(s) ?? []), { key: it.key, code: it.code, title: it.title, qty, cents: centsOf(it), jobs }]);
  }
  return [...by.entries()]
    .map(([supplierKey, lines]) => ({
      supplierKey,
      units: lines.reduce((s, l) => s + l.qty, 0),
      jobs: new Set(lines.flatMap((l) => l.jobs.map((j) => j.uuid))).size,
      cents: lines.reduce((s, l) => s + (l.cents ?? 0) * l.qty, 0),
      unpriced: lines.filter((l) => l.cents == null).reduce((s, l) => s + l.qty, 0),
      lines,
    }))
    .sort((a, b) => b.units - a.units || (a.supplierKey ?? "~").localeCompare(b.supplierKey ?? "~"));
}

/** The order as text for a supplier's quick order: a line an item. */
export function orderText(lines: readonly OrderLine[]): string {
  return lines.map((l) => `${l.qty} x ${l.code ?? l.title}`).join("\n");
}

/* ---------- THE WORDS ON A ROW ---------- */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Tue" for a day this fortnight, "Mon 7 Dec" past it. */
export function dayWord(day: string, today: string): string {
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  const near = day.slice(0, 10) <= addDays(today, 13);
  return near ? DAYS[d.getUTCDay()]! : `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString("en-AU", { month: "short", timeZone: "UTC" })}`;
}

export const HAD_WORDS: Record<HadWhere, string> = { site: "On site", van: "In a van", customer: "Customer's" };
/** "In Luke's van", "On site", "Customer's". */
export const hadWord = (where: HadWhere, who: string | null) => (where === "van" && who?.trim() ? `In ${who.trim().split(/\s+/)[0]}'s van` : HAD_WORDS[where]);

export type RowWord = { tone: "good" | "look" | "info" | "wrong"; word: string } | null;
/** An item's word on its row: due after its day (red), still to order, ordered
    to the factory, to site, already had, in stock; a count when nothing's done. */
export function rowWord(it: Pick<Item, "need" | "inStock" | "ordered" | "had" | "covered" | "open" | "late" | "group" | "jobs">, today: string): RowWord {
  if (it.group === "duct") return it.inStock >= it.need ? { tone: "good", word: "In stock" } : null;
  if (it.late) {
    const j = it.jobs.find((x) => lateOf(x));
    return { tone: "wrong", word: j?.at ? `Due after ${dayWord(j.at, today)}` : "Due after" };
  }
  if (it.open > 0) return it.inStock + it.had + it.ordered > 0 ? { tone: "look", word: `${it.open} to order` } : null;
  if (it.inStock >= it.need) return { tone: "good", word: "In stock" };
  if (it.covered < it.need) return { tone: "info", word: "Ordered" };
  const site = it.jobs.find((j) => j.orderedTo === "site" && orderedAfter(j.need, j.inStock, j.ordered, j.had) > 0);
  if (site) return { tone: "good", word: site.orderedDue ? `To site, ${dayWord(site.orderedDue, today)}` : "To site" };
  const had = it.jobs.find((j) => j.had > 0 && j.hadWhere);
  if (had) return { tone: "good", word: hadWord(had.hadWhere!, had.hadWho) };
  return { tone: "good", word: "In stock" };
}

/** One need as a row's word: the shopping list's, for its one job. */
export function needWordOf(n: JobNeed, today: string): RowWord {
  const job: StockJob = { uuid: "job", number: null, client: null, suburb: null, address: null, hue: "grey", kind: null, firstAt: n.at, crew: 1 };
  return rowWord(shoppingList([{ job, needs: [n] }])[0]!, today);
}

/** A job's equipment for its card: each item, when it's wanted, and its word. */
export type EquipmentRow = { key: string; title: string; detail: string; qty: number; group: Group; when: string | null; word: RowWord };
export function equipmentOf(needs: readonly JobNeed[], today: string): EquipmentRow[] {
  const order: Record<Group, number> = { unit: 0, control: 1, duct: 2 };
  return [...needs]
    .sort((a, b) => order[a.group] - order[b.group] || (a.at ?? "~").localeCompare(b.at ?? "~"))
    .map((n) => {
      const w = needWordOf(n, today);
      return {
        key: n.key,
        title: n.title,
        detail: n.detail,
        qty: n.need,
        group: n.group,
        when: n.visit ? `${n.visit.stage}, ${n.at ? dayWord(n.at, today) : "not booked yet"}` : null,
        word: w ?? (n.group === "duct" ? null : { tone: "look", word: "To order" }),
      };
    });
}
