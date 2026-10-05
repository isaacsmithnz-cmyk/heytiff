import type { BuildLine, Visit } from "./buildup";
import { categoryOf } from "./categories";
import { KIT, RUN_TO_ASK, WHERE_TO_ASK } from "./brief-rooms";
import { COMPONENT_KEYS, QUOTE_COMPONENTS, matchesComponent, type ComponentKey } from "./components";
import { ALLOWANCES, type AllowanceKey } from "./settings";
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
      (a near code waits for the business to confirm it, and says so). The
      units of one system — an indoor on its outdoor, a multi and its
      heads — come from ONE supplier (Isaac, 2026-10-05: "Anything that's a
      pair should come from one supplier, not mix and match"): the
      business's own pick for any of them when that supplier has them all,
      else the supplier with them all at the lowest total. Only when no one
      supplier has them all is each its own, and the line says so;
   2. the code it was added with (the price-book search keeps "code,
      supplier" under the row);
   3. pair coil by its sizes — the business's preferred coil for that pair;
   4. a common part by its name (isolator, drain hose…) — its preferred item;
   5. the row's name, as a code someone typed.
   Pure: the server loads the book and hands in the lookups. */

export type ListRow = {
  name: string;
  sub: string;
  qty: string;
  /** the system a unit is part of — an indoor on its outdoor, a multi and
      its heads — so the system's units come from one supplier */
  system?: number;
};

export type UnitOffer = {
  buyCents: number;
  supplierKey: string;
  name: string;
  code: string;
  supplierName?: string;
  /** the business's own pick — a supplier it chose for the model, or its
      preferred item — not merely the cheapest */
  chosen?: boolean;
};
export type ComponentPrice = {
  perUnitCents: number;
  supplierKey: string;
  code: string;
  name: string;
  /** one piece's length, for a part bought by the piece and needed by the
      metre (pipe cover); null when its name doesn't say */
  lengthM?: number | null;
};

export type JobPriceDeps = {
  priceOf: PriceOf;
  /** a pack model's price through the codes it's linked to, or null */
  unitOffer: (model: string) => UnitOffer | null;
  /** a pack model's near order codes, waiting for the business to confirm */
  unitProposed?: (model: string) => string[];
  /** every supplier's price for a pack model, so a system's units can come
      from one of them */
  unitOffers?: (model: string) => UnitOffer[];
  /** the business's chosen item for a common part, per metre or each */
  component: (key: ComponentKey) => ComponentPrice | null;
  /** the business's own allowance, at cost; null when it hasn't set it */
  allowance?: (key: AllowanceKey) => number | null;
};

/* A kit's rows by name: the part each is, priced by the business's own
   preferred item for it (Quoting), or its own allowance. */
const KIT_PART: Record<string, ComponentKey> = {
  [KIT.groundMount]: "ground_mount",
  [KIT.wallBracket]: "wall_bracket",
  [KIT.isolator]: "isolator",
  [KIT.pipeCover]: "pipe_cover",
  [KIT.drainHose]: "drain_hose",
  [KIT.pump]: "condensate_pump",
  "Hanging kit": "hanging_kit",
  "Condensate drain": "condensate_drain",
  "Zone cable": "zone_cable",
};

/* a ducted part that comes in sizes: priced from the business's range for it
   once the price book holds its ranges (Isaac, 2026-10-04: the smart price
   book, its own track) */
const SIZED_RANGE = /^(MDO|Round diffuser|Square diffuser|Bar grille|Slot diffuser|Supply outlet|Return grille|Zone damper|Plenum|Fitting|Trunk|Flex|Takeoff)\b|^ø[\d.]+ \/ ø[\d.]+ copper$/;
const KIT_ALLOWANCE: Record<string, AllowanceKey> = Object.fromEntries(
  (Object.keys(ALLOWANCES) as AllowanceKey[]).map((k) => [ALLOWANCES[k].label, k])
);

const askWhy = (qty: string) =>
  qty === WHERE_TO_ASK
    ? "Where the outdoor sits isn't known yet: ask"
    : qty === RUN_TO_ASK
      ? "Its length isn't known yet: ask"
      : /^(Size|Count|Layout|Return|Drain run) to ask$/.test(qty)
        ? `${qty.replace(/ to ask$/, "")} isn't in the brief: ask`
        : "Not known yet: ask";

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

/** The line a system's units say when no one supplier has them all. */
export const MIXED_SYSTEM = "no one supplier has the whole system";

/** Each system's one supplier — the business's own pick for any of its
    units when that supplier has them all, else the one with them all at the
    lowest total — or null when no one supplier has them all. A system of
    one unit is left to that unit's own price. */
export function systemSuppliers(rows: readonly ListRow[], deps: JobPriceDeps): Map<number, string | null> {
  const out = new Map<number, string | null>();
  if (!deps.unitOffers) return out;
  const bySystem = new Map<number, { model: string; n: number }[]>();
  for (const r of rows) {
    if (r.system == null) continue;
    const model = r.name.trim();
    if (!deps.unitOffer(model)) continue;
    const n = countOf(r.qty)?.n ?? 1;
    bySystem.set(r.system, [...(bySystem.get(r.system) ?? []), { model, n }]);
  }
  for (const [system, units] of bySystem) {
    if (units.length < 2) continue;
    const offers = units.map((u) => (deps.unitOffers!(u.model) ?? []).filter((o) => o.buyCents > 0));
    const common = [...new Set(offers[0]!.map((o) => o.supplierKey))].filter((k) => offers.every((list) => list.some((o) => o.supplierKey === k)));
    if (common.length === 0) {
      out.set(system, null);
      continue;
    }
    const totalAt = (k: string) => units.reduce((sum, u, i) => sum + Math.min(...offers[i]!.filter((o) => o.supplierKey === k).map((o) => o.buyCents)) * u.n, 0);
    /* the business's own pick for a unit (a supplier it chose, its preferred item), when that supplier has them all */
    const picked = units
      .map((u) => deps.unitOffer(u.model))
      .find((o): o is UnitOffer => !!o?.chosen && common.includes(o.supplierKey))?.supplierKey;
    out.set(system, picked ?? [...common].sort((a, b) => totalAt(a) - totalAt(b))[0]!);
  }
  return out;
}

export function priceJobList(rows: readonly ListRow[], deps: JobPriceDeps): { lines: BuildLine[]; unpriced: Unpriced[] } {
  const lines: BuildLine[] = [];
  const unpriced: Unpriced[] = [];
  const oneSupplier = systemSuppliers(rows, deps);
  rows.forEach((r, i) => {
    const key = `row-${i}`;
    const count = countOf(r.qty);
    if (!count) {
      const why = /\d\s*(g|kg)\b/i.test(r.qty)
        ? "Bought by the bottle, not the gram"
        : /\bask\b/i.test(r.qty)
          ? askWhy(r.qty)
          : "No quantity to price";
      unpriced.push({ name: r.name, qty: r.qty, why });
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

    /* a kit's allowance: the business's own figure, or say to set it */
    const allowanceKey = KIT_ALLOWANCE[r.name.trim()];
    if (allowanceKey) {
      const cents = deps.allowance?.(allowanceKey) ?? null;
      if (cents == null) return void unpriced.push({ name: r.name, qty: r.qty, why: `Set your ${ALLOWANCES[allowanceKey].label.toLowerCase()} allowance in Quoting` });
      lines.push({ key, group: "Materials", name: r.name, code: null, supplierKey: null, qty: count.n, unitBuyCents: cents, kind: "material", duct: false });
      return;
    }

    const unit = deps.unitOffer(r.name.trim());
    const waiting = unit ? [] : (deps.unitProposed?.(r.name.trim()) ?? []);
    if (waiting.length > 0) {
      unpriced.push({ name: r.name, qty: r.qty, why: `Confirm its order code (${waiting.slice(0, 2).join(" or ")}) in Quoting` });
      return;
    }
    if (unit) {
      /* the system's one supplier, at its lowest price for this model */
      const system = r.system != null && oneSupplier.has(r.system) ? oneSupplier.get(r.system)! : undefined;
      const from =
        system != null
          ? ((deps.unitOffers?.(r.name.trim()) ?? []).filter((o) => o.supplierKey === system && o.buyCents > 0).sort((a, b) => a.buyCents - b.buyCents)[0] ?? unit)
          : unit;
      lines.push({
        key,
        group: "Units",
        name: r.name,
        code: from.code,
        supplierKey: from.supplierKey,
        ...(from.supplierName ? { supplierName: from.supplierName } : {}),
        qty: count.n,
        unitBuyCents: from.buyCents,
        kind: "unit",
        ...(system === null ? { because: MIXED_SYSTEM } : {}),
      });
      return;
    }
    const code = codeIn(r.sub);
    const byCode = code ? deps.priceOf(code) : null;
    if (code && byCode) return void lines.push(material(byCode, code));

    const pair = PAIR_ROW.exec(r.name);
    const compKey = pair
      ? PAIR_MM[`${Number(pair[1])}+${Number(pair[2])}`]
      : (KIT_PART[r.name.trim()] ?? COMPONENT_KEYS.find((k) => matchesComponent(k, r.name)));
    if (compKey) {
      const c = deps.component(compKey);
      if (!c) return void unpriced.push({ name: r.name, qty: r.qty, why: `Choose your ${QUOTE_COMPONENTS[compKey].label.toLowerCase()} in Quoting` });
      /* bought by the piece, needed by the metre: whole pieces of its length */
      let qty = count.n;
      if (QUOTE_COMPONENTS[compKey].unit === "each" && count.unit === "m") {
        if (!c.lengthM) return void unpriced.push({ name: r.name, qty: r.qty, why: `How long one ${c.name} is isn't in its name: set it in Quoting` });
        qty = Math.ceil(count.n / c.lengthM - 1e-9);
      }
      lines.push({ key, group: "Materials", name: r.name, code: c.code, supplierKey: c.supplierKey, qty, unitBuyCents: c.perUnitCents, kind: "material", duct: false });
      return;
    }
    const byName = deps.priceOf(r.name.trim());
    if (byName) return void lines.push(material(byName, r.name.trim()));
    if (SIZED_RANGE.test(r.name.trim())) return void unpriced.push({ name: r.name, qty: r.qty, why: "Priced from your range for it, once the price book has it" });
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

/** What a priced quote still lacks before its total is the quote's: the
    labour when nothing gives it, then each material with no price. Empty
    means the total is whole; anything here makes it a total so far, which
    a proposal never takes (Isaac's walk, 2026-10-05: $72 shown as the
    quote with five items and the labour unpriced). */
export function stillToPrice(p: { unpriced: Unpriced[]; labourFrom: "brief" | "history" | "none"; labourCents: number }): Unpriced[] {
  const labour: Unpriced[] =
    p.labourFrom === "none"
      ? [{ name: "Labour", qty: "", why: "Not in the brief, and no typical yet" }]
      : p.labourCents <= 0
        ? [{ name: "Labour", qty: "", why: "The brief gives no days or hours to price" }]
        : [];
  return [...labour, ...p.unpriced];
}
