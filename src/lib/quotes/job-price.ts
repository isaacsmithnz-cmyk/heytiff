import type { BuildLine, Visit } from "./buildup";
import { categoryOf } from "./categories";
import { COMPONENT_KEYS, matchesComponent, type ComponentKey } from "./components";
import type { Priced, PriceOf } from "./ducted-template";
import type { LabourAdvice } from "./labour-history";

/* THE JOB'S OWN LIST, PRICED (Isaac, 2026-10-04: "Switch it on now").

   A quote is priced from what is on the job — its Materials list, as Studio
   pushed it or a person typed or said it — at this business's own prices:
   its price book less its own discounts, its own preferred items, its own
   markups, its own day. No kit of anyone else's is added, and nothing is
   priced on a guess: a row HeyTiff can't match to the price book, or can't
   count, is listed as not priced, with why.

   How a row finds its price, first match wins:
   1. a unit — a model the data pack links to the business's order codes
      (a near code waits for the business to confirm it, and says so);
   2. the code it was added with (the price-book search keeps "code,
      supplier" under the row);
   3. pair coil by its sizes — the business's preferred coil for that pair;
   4. a common part by its name (isolator, drain hose…) — its preferred item;
   5. the row's name, as a code someone typed.
   Pure: the server loads the book and hands in the lookups. */

export type ListRow = { name: string; sub: string; qty: string };

export type UnitOffer = { buyCents: number; supplierKey: string; name: string; code: string };
export type ComponentPrice = { perUnitCents: number; supplierKey: string; code: string; name: string };

export type JobPriceDeps = {
  priceOf: PriceOf;
  /** a pack model's price through the codes it's linked to, or null */
  unitOffer: (model: string) => UnitOffer | null;
  /** a pack model's near order codes, waiting for the business to confirm */
  unitProposed?: (model: string) => string[];
  /** the business's chosen item for a common part, per metre or each */
  component: (key: ComponentKey) => ComponentPrice | null;
};

export type Unpriced = { name: string; qty: string; why: string };

/** A row's quantity, when it can be counted: "18 m", "3", "2 x", "1 set".
    Grams or kilos are refrigerant, bought by the bottle, not by the gram. */
export function countOf(qty: string): { n: number; unit: "m" | "each" } | null {
  const t = qty.trim().toLowerCase();
  if (!t) return { n: 1, unit: "each" };
  const m = /^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|mtrs?|ea|each|x|sets?|pcs?|pieces?|lengths?|no\.?)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  if (!(n > 0)) return null;
  return { n, unit: m[2] && /^m(e|t|$)/.test(m[2]) ? "m" : "each" };
}

/* "ø6.35 / ø9.52 pair coil" → the component for that liquid + gas pair */
const PAIR_MM: Record<string, ComponentKey> = {
  "6.35+9.52": "pair_coil_14_38",
  "6.35+12.7": "pair_coil_14_12",
  "6.35+15.88": "pair_coil_14_58",
  "9.52+15.88": "pair_coil_38_58",
  "9.52+19.05": "pair_coil_38_34",
};
const PAIR_ROW = /ø?\s*(\d+(?:\.\d+)?)\s*\/\s*ø?\s*(\d+(?:\.\d+)?)\s*pair\s*coil/i;

/** The code a row was added with from the price book: "PC1412, AAD" → PC1412. */
const codeIn = (sub: string): string | null => {
  const first = sub.split(",")[0]?.trim() ?? "";
  return /^[A-Z0-9][A-Z0-9\-/().#]{2,}$/i.test(first) && /\d/.test(first) ? first : null;
};

const isDuct = (name: string, code: string | null) => {
  const c = categoryOf(name, code ?? "");
  return c === "ducting" || c === "grilles";
};

export function priceJobList(rows: readonly ListRow[], deps: JobPriceDeps): { lines: BuildLine[]; unpriced: Unpriced[] } {
  const lines: BuildLine[] = [];
  const unpriced: Unpriced[] = [];
  rows.forEach((r, i) => {
    const key = `row-${i}`;
    const count = countOf(r.qty);
    if (!count) {
      unpriced.push({ name: r.name, qty: r.qty, why: /\d\s*(g|kg)\b/i.test(r.qty) ? "Bought by the bottle, not the gram" : "No quantity to price" });
      return;
    }
    const material = (p: Priced, code: string, extra: Partial<BuildLine> = {}): BuildLine => ({
      key,
      group: "Materials",
      name: r.name,
      code,
      supplierKey: p.supplierKey,
      qty: count.n,
      unitBuyCents: p.buyCents,
      kind: categoryOf(p.name, code) === "units" ? "unit" : "material",
      duct: isDuct(p.name, code),
      ...extra,
    });

    const unit = deps.unitOffer(r.name.trim());
    const waiting = unit ? [] : (deps.unitProposed?.(r.name.trim()) ?? []);
    if (waiting.length > 0) {
      unpriced.push({ name: r.name, qty: r.qty, why: `Confirm its order code (${waiting.slice(0, 2).join(" or ")}) in Quoting` });
      return;
    }
    if (unit) {
      lines.push({ key, group: "Units", name: r.name, code: unit.code, supplierKey: unit.supplierKey, qty: count.n, unitBuyCents: unit.buyCents, kind: "unit" });
      return;
    }
    const code = codeIn(r.sub);
    const byCode = code ? deps.priceOf(code) : null;
    if (code && byCode) return void lines.push(material(byCode, code));

    const pair = PAIR_ROW.exec(r.name);
    const compKey = pair ? PAIR_MM[`${Number(pair[1])}+${Number(pair[2])}`] : COMPONENT_KEYS.find((k) => matchesComponent(k, r.name));
    if (compKey) {
      const c = deps.component(compKey);
      if (!c) return void unpriced.push({ name: r.name, qty: r.qty, why: "No preferred item for it in Quoting" });
      lines.push({ key, group: "Materials", name: r.name, code: c.code, supplierKey: c.supplierKey, qty: count.n, unitBuyCents: c.perUnitCents, kind: "material", duct: false });
      return;
    }
    const byName = deps.priceOf(r.name.trim());
    if (byName) return void lines.push(material(byName, r.name.trim()));
    unpriced.push({ name: r.name, qty: r.qty, why: pair ? "No preferred coil for that size in Quoting" : "Not in your price book" });
  });
  return { lines, unpriced };
}

/** The labour a quote prices: the brief's visits, else the business's
    typical hours for the kind of work as one visit; none otherwise. Days
    come from the business's own working day. */
export function labourVisits(advice: LabourAdvice, dayHours: number): { visits: Visit[]; from: "brief" | "history" | "none" } {
  if (advice.from === "brief") {
    const visits = advice.labour.visits
      .map((v) => ({ stage: v.stage, people: v.people, days: v.days ?? (v.hours != null ? v.hours / dayHours : null) }))
      .filter((v): v is Visit => v.days != null && v.days > 0);
    return { visits, from: "brief" };
  }
  if (advice.from === "history") {
    return { visits: [{ stage: "Install", people: 1, days: advice.typical.hours / dayHours }], from: "history" };
  }
  return { visits: [], from: "none" };
}
