import { trunkingLengths } from "./buildup";
import { rollMetresOf } from "./components";
import type { Product } from "./families";
import type { LineFields } from "./lines";
import { pickItem, supplierOffer, type BookQuery, type Pick } from "./lookups";
import { isolatorOf, pickFromRange, type RangeKind, type RangeNeed } from "./ranges";
import type { ComponentKey } from "./components";
import type { RangeOffer } from "./job-price";
import type { Preferred } from "./settings";

/* KITS AS DATA (the engine rebuild, slice 1.3) — what a system takes to
   install, part by part, for any business: each part named by what it is
   (words and a size), never by one supplier's code, and picked from the
   business's own book the way it buys (lookups.ts: preferred, most quoted,
   cheapest). So the same kit prices a Diamond Air split from AAD and
   another business's from its own suppliers.

   Every quantity comes from a fact the person gave (the pipe run, the
   power run, the outlets) or from the part itself (one isolator, one set
   of feet). A fact not given leaves its part on the quote as not known
   yet, with nothing in it, rather than a number nobody said (Isaac,
   2026-10-04: "no made up figures"). A part the book hasn't got stays on
   the quote too, saying so.

   Pure: the quote by hand adds a kit in one press; Tiff's tools open the
   same kits. */

export type KitKey = "split" | "ducted";

export type PipeSize = "1/4+3/8" | "1/4+1/2" | "1/4+5/8" | "3/8+5/8" | "3/8+3/4";
export const PIPE_SIZES: readonly PipeSize[] = ["1/4+3/8", "1/4+1/2", "1/4+5/8", "3/8+5/8", "3/8+3/4"];
/** An old system's pipe can be bigger than any new split's: a 1/2" liquid
    line (3304) is never the size a unit here takes. */
export type OldPipe = PipeSize | "3/8+7/8" | "1/2+7/8";
export const OLD_PIPES: readonly OldPipe[] = [...PIPE_SIZES, "3/8+7/8", "1/2+7/8"];

export type KitFacts = {
  /** the unit's pipe, liquid + gas */
  pipe: PipeSize | null;
  /** the pipe run, metres */
  pipeM: number | null;
  /** the run from the switchboard, metres */
  powerM: number | null;
  /** what the outdoor draws, amps */
  amps: number | null;
  mount: "ground" | "wall";
  /** the outside run in trunking, metres; null or 0: none */
  trunkingM: number | null;
  /** the drain's run, metres */
  drainM: number | null;
  /** ducted: how many outlets, and their size, mm */
  outlets?: number | null;
  outletMm?: number | null;
  /** an old system comes out: its refrigerant recovered, the pipe flushed */
  replacing?: boolean;
  /** ducted: the indoor goes under the floor, hung on springs, its outlets
      floor grilles on boots (3377) */
  underfloor?: boolean;
  /** its pipe, to keep: kept only when it's the size the new unit's data
      pack gives (slice 9.1); else new pipe is priced, saying why */
  keptPipe?: OldPipe | null;
};

/** The business's own allowances (Quoting): at cost, null when not set. */
export type KitAllowances = { consumables: number | null; flush: number | null; recovery: number | null };

export type KitPart = {
  key: string;
  group: string;
  /** the line's name when the book has nothing for it */
  name: string;
  /** what to look for in the book, or null when a fact it needs is missing;
      `pool` narrows the book first (a rating at or above the draw) */
  search: (f: KitFacts) => (BookQuery & { pool?: (all: Product[]) => Product[] }) | null;
  /** how many, and in what: null when a fact it needs is missing */
  qty: (f: KitFacts) => { qty: number; unit: LineFields["unit"]; why: string } | null;
  /** a part only some jobs take: left off when this says so */
  skip?: (f: KitFacts) => boolean;
  /** the business's range it's picked from, at the size the job needs
      (ranges.ts); null when the size isn't known */
  range?: (f: KitFacts) => { kind: RangeKind; need: RangeNeed } | null;
  /** the part as Quoting names its preferred item (components.ts) */
  component?: (f: KitFacts) => ComponentKey | null;
};

/** What the business has chosen for a kit's parts (1.2, one preferred
    store): its ranges at today's prices, and Quoting's preferred items. */
export type KitPreferences = {
  ranges: ReadonlyMap<RangeKind, readonly RangeOffer[]>;
  components: Partial<Record<ComponentKey, Preferred>>;
};

const PIPE_COMPONENT: Record<PipeSize, ComponentKey> = {
  "1/4+3/8": "pair_coil_14_38",
  "1/4+1/2": "pair_coil_14_12",
  "1/4+5/8": "pair_coil_14_58",
  "3/8+5/8": "pair_coil_38_58",
  "3/8+3/4": "pair_coil_38_34",
};

/* the circuit's parts by what the unit draws: the next standard size up */
const BREAKERS = [10, 16, 20, 25, 32, 40, 50, 63];
const ISOLATORS = [20, 35, 63];
export const breakerFor = (amps: number) => BREAKERS.find((b) => b >= amps) ?? null;
export const isolatorFor = (amps: number) => ISOLATORS.find((b) => b >= amps) ?? null;
/** TPS by the circuit it carries: 2.5 mm² to 20 A, 4 mm² to 32 A, 6 mm² beyond. */
export const cableFor = (amps: number) => (amps <= 20 ? "2.5" : amps <= 32 ? "4" : "6");

/** The smallest rating the book has at or above what's needed: a 13.5 A
    unit takes a 20 A breaker when the business stocks no 16 A (3375). */
const atLeast = (want: number, words: RegExp) => (all: Product[]) => {
  const rated = all
    .filter((p) => words.test(p.name))
    .map((p) => ({ p, a: isolatorOf(p.name)?.amps ?? null }))
    .filter((x): x is { p: Product; a: number } => x.a != null && x.a >= want);
  const least = Math.min(...rated.map((x) => x.a));
  return rated.filter((x) => x.a === least).map((x) => x.p);
};
const pipeWords = (pipe: PipeSize) => pipe.replace("+", " ");
const metres = (m: number | null, what: string) => (m != null && m > 0 ? { qty: m, unit: "m" as const, why: `${m} m ${what}` } : null);
const one = (why: string) => () => ({ qty: 1, unit: "" as const, why });

const SPLIT: KitPart[] = [
  {
    key: "pair-coil",
    group: "Pipe, power and controls",
    name: "Pair coil",
    search: (f) => (f.pipe ? { text: `coil ${pipeWords(f.pipe)}` } : null),
    component: (f) => (f.pipe ? PIPE_COMPONENT[f.pipe] : null),
    qty: (f) => metres(f.pipeM, "pipe run"),
  },
  {
    key: "interconnect",
    group: "Pipe, power and controls",
    name: "Interconnect cable",
    search: () => ({ text: "interconnect" }),
    qty: (f) => metres(f.pipeM, "with the pipe"),
  },
  {
    key: "power",
    group: "Pipe, power and controls",
    name: "Power cable",
    search: (f) => (f.amps != null ? { text: `tps ${cableFor(f.amps)}` } : null),
    /* Quoting's power cable is the 2.5 mm² */
    component: (f) => (f.amps != null && cableFor(f.amps) === "2.5" ? "power_cable" : null),
    qty: (f) => metres(f.powerM, "from the board"),
  },
  {
    key: "breaker",
    group: "Pipe, power and controls",
    name: "RCBO",
    search: (f) => (f.amps != null ? { text: "rcbo", pool: atLeast(f.amps, /rcbo/i) } : null),
    qty: one("one for the new circuit"),
  },
  {
    key: "isolator",
    group: "Pipe, power and controls",
    name: "Isolator",
    search: (f) => (f.amps != null ? { text: "isolator", pool: atLeast(f.amps, /isolat/i) } : null),
    range: (f) => (f.amps != null ? { kind: "isolator", need: { amps: f.amps } } : null),
    qty: one("one at the outdoor"),
  },
  {
    key: "mount",
    group: "Mounting and drain",
    name: "Outdoor mount",
    search: (f) => (f.mount === "wall" ? { text: "wall bracket" } : { text: "feet" }),
    component: (f) => (f.mount === "wall" ? "wall_bracket" : "ground_mount"),
    qty: one("under the outdoor"),
  },
  {
    key: "drain",
    group: "Mounting and drain",
    name: "Drain hose",
    search: () => ({ text: "drain hose" }),
    component: () => "drain_hose",
    qty: (f) => metres(f.drainM, "of drain"),
  },
  {
    key: "trunking",
    group: "Mounting and drain",
    name: "Trunking",
    skip: (f) => !f.trunkingM,
    search: () => ({ text: "trunking" }),
    component: () => "pipe_cover",
    qty: (f) => (f.trunkingM ? { qty: trunkingLengths(f.trunkingM), unit: "", why: `${f.trunkingM} m outside, in 2.4 m lengths` } : null),
  },
];

const DUCTED: KitPart[] = [
  ...SPLIT,
  {
    key: "flex",
    group: "Ductwork and grilles",
    name: "Flex duct",
    search: (f) => (f.outletMm ? { text: "flex", sizeMm: f.outletMm } : null),
    range: (f) => (f.outletMm ? { kind: "flex_duct", need: { mm: f.outletMm } } : null),
    qty: (f) => (f.outlets ? { qty: f.outlets, unit: "", why: `a bag to each of ${f.outlets} outlets` } : null),
  },
  {
    key: "outlets",
    group: "Ductwork and grilles",
    name: "Outlet diffuser",
    skip: (f) => !!f.underfloor,
    search: (f) => (f.outletMm ? { text: "diffuser", sizeMm: f.outletMm } : null),
    range: (f) => (f.outletMm ? { kind: "round_diffuser", need: { mm: f.outletMm } } : null),
    qty: (f) => (f.outlets ? { qty: f.outlets, unit: "", why: `${f.outlets} outlets` } : null),
  },
  /* under the floor: a floor grille on a boot at each outlet, the indoor on springs */
  {
    key: "floor-grilles",
    group: "Ductwork and grilles",
    name: "Floor grille",
    skip: (f) => !f.underfloor,
    search: () => ({ text: "floor grille" }),
    qty: (f) => (f.outlets ? { qty: f.outlets, unit: "", why: `${f.outlets} outlets in the floor` } : null),
  },
  {
    key: "boots",
    group: "Ductwork and grilles",
    name: "Floor boot",
    skip: (f) => !f.underfloor,
    search: () => ({ text: "boot" }),
    qty: (f) => (f.outlets ? { qty: f.outlets, unit: "", why: `one under each floor grille` } : null),
  },
  {
    key: "hangers",
    group: "Mounting and drain",
    name: "Spring hangers",
    skip: (f) => !f.underfloor,
    search: () => ({ text: "spring hanger" }),
    qty: () => ({ qty: 4, unit: "", why: "one at each of the indoor's four hanging points" }),
  },
  {
    key: "return",
    group: "Ductwork and grilles",
    name: "Return air grille, filtered",
    search: () => ({ text: "return filter" }),
    qty: one("one return, its size to confirm"),
  },
  {
    key: "return-box",
    group: "Ductwork and grilles",
    name: "Return air box",
    search: () => ({ text: "return box" }),
    component: () => "return_box",
    qty: one("behind the return grille, its size to confirm"),
  },
  {
    key: "controller",
    group: "Pipe, power and controls",
    name: "Wall controller",
    search: () => ({ text: "wired controller" }),
    component: () => "wall_controller",
    qty: one("for the indoor"),
  },
];

export const KITS: Record<KitKey, { label: string; parts: KitPart[] }> = {
  split: { label: "Split install", parts: SPLIT },
  ducted: { label: "Ducted install", parts: DUCTED },
};

/** The item the business chose for a part, before any search: its range
    at the size the job needs (the job's supplier's item first), else
    Quoting's preferred item for the part, at the job's supplier where it
    sells the same item. Null: nothing chosen, so the book is searched. */
export function chosenFor(part: KitPart, f: KitFacts, products: readonly Product[], preferred: KitPreferences | null, supplier: string | null): Pick | null {
  if (!preferred) return null;
  const r = part.range?.(f);
  const offers = r ? (preferred.ranges.get(r.kind) ?? []) : [];
  if (r && offers.length) {
    const mine = supplier ? offers.filter((o) => o.supplierKey === supplier) : [];
    const hit = pickFromRange(r.kind, mine, r.need) ?? pickFromRange(r.kind, offers, r.need);
    const product = hit ? products.find((p) => p.offers.some((o) => o.supplierKey === hit.supplierKey && o.code === hit.code)) : null;
    const offer = product?.offers.find((o) => o.supplierKey === hit!.supplierKey && o.code === hit!.code);
    if (product && offer) return { product, offer, why: "Your range" };
  }
  const key = part.component?.(f);
  const p = key ? preferred.components[key] : undefined;
  if (p) {
    const product = products.find((x) => x.offers.some((o) => o.supplierKey === p.supplierKey && o.code === p.code));
    const own = product?.offers.find((o) => o.supplierKey === p.supplierKey && o.code === p.code);
    if (product && own) return { product, offer: (supplier ? supplierOffer(product, supplier) : null) ?? own, why: "Your preferred" };
  }
  return null;
}

/** A kit's parts as lines for one option and system, each picked from the
    book; a part with a fact missing, or that the book hasn't got, is a line
    nobody knows the price of yet, saying why. */
export function expandKit(
  kit: KitKey,
  f: KitFacts,
  products: Product[],
  at: { optionIndex: number; system: string },
  allowances: KitAllowances | null = null,
  /** the job's supplier, bought from where it sells the part */
  supplier: string | null = null,
  /** the business's ranges and Quoting's preferred items, first */
  preferred: KitPreferences | null = null
): Partial<LineFields>[] {
  const out: Partial<LineFields>[] = [];
  for (const part of KITS[kit].parts) {
    if (part.skip?.(f)) continue;
    /* the old pipe kept: only at the size the unit's pack gives, as no
       pack here says what else a unit will take */
    let swap = "";
    if (part.key === "pair-coil" && f.replacing && f.keptPipe) {
      if (f.pipe === f.keptPipe) continue;
      swap = f.pipe ? `the old ${f.keptPipe.replace("+", " + ")} isn't the ${f.pipe.replace("+", " + ")} the unit takes; ` : "";
    }
    const q = part.qty(f);
    const s = part.search(f);
    const base = { optionIndex: at.optionIndex, system: at.system, group: part.group, kind: "material" as const };
    if (!q || !s) {
      const why = !s ? (part.key === "pair-coil" && f.keptPipe ? "Needs the unit's details to check the old pipe" : "Needs the unit's details") : "Needs the run";
      out.push({ ...base, name: part.name, qty: q?.qty ?? 0, unit: q?.unit ?? "", costCents: 0, source: "unknown", why });
      continue;
    }
    const pool = s.pool ? s.pool(products) : products;
    const picked = chosenFor(part, f, products, preferred, supplier) ?? pickItem(pool, s, supplier);
    if (!picked) {
      out.push({ ...base, name: part.name, qty: q.qty, unit: q.unit, costCents: 0, source: "unknown", why: "Not in your book" });
      continue;
    }
    /* sold by the roll, bought here by the metre */
    const roll = q.unit === "m" ? (rollMetresOf(picked.offer.name) ?? null) : null;
    const cost = roll && roll > 1 ? Math.round((picked.offer.netCents / roll) * 10) / 10 : picked.offer.netCents;
    out.push({
      ...base,
      name: picked.product.name,
      code: picked.offer.code,
      supplierKey: picked.offer.supplierKey,
      qty: q.qty,
      unit: q.unit,
      costCents: cost,
      source: swap ? "fitted" : "assumed",
      why: `${swap}${q.why}; ${picked.why.toLowerCase()}`,
    });
  }
  /* the business's own allowances, at what it set them at; one it hasn't
     set is on the quote as not known yet */
  if (allowances) {
    const allow = (name: string, cents: number | null, why: string) =>
      out.push({
        optionIndex: at.optionIndex,
        system: at.system,
        group: "Allowances",
        kind: "material",
        name,
        qty: 1,
        unit: "",
        costCents: cents ?? 0,
        source: cents == null ? "unknown" : "assumed",
        why: cents == null ? "Not set in Quoting" : why,
      });
    allow("Consumables", allowances.consumables, "your allowance, a head");
    if (f.replacing) {
      allow("Refrigerant recovery and removal", allowances.recovery, "your allowance, a system");
      allow(
        "Pipe flush",
        allowances.flush,
        f.keptPipe && f.pipe === f.keptPipe ? `your allowance, a system; the old ${f.keptPipe.replace("+", " + ")} kept, the size the unit takes` : "your allowance, a system"
      );
    }
  }
  return out;
}

const MM_INCH: [number, string][] = [
  [6.35, "1/4"],
  [9.52, "3/8"],
  [12.7, "1/2"],
  [15.88, "5/8"],
  [19.05, "3/4"],
];
/** A unit's pipe from its data pack's connections, mm, as a kit's size. */
export function pipeFromMm(liquid: number, gas: number): PipeSize | null {
  const inch = (mm: number) => MM_INCH.find(([v]) => Math.abs(v - mm) < 0.2)?.[1];
  const p = `${inch(liquid)}+${inch(gas)}`;
  return (PIPE_SIZES as readonly string[]).includes(p) ? (p as PipeSize) : null;
}

/** A person's kit facts made safe: numbers in range, the rest null. */
export function normaliseKitFacts(raw: unknown): KitFacts {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = (v: unknown, max: number) => {
    const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(x) && x > 0 ? Math.min(max, Math.round(x * 10) / 10) : null;
  };
  return {
    pipe: (PIPE_SIZES as readonly unknown[]).includes(r.pipe) ? (r.pipe as PipeSize) : null,
    pipeM: n(r.pipeM, 200),
    powerM: n(r.powerM, 200),
    amps: n(r.amps, 200),
    mount: r.mount === "wall" ? "wall" : "ground",
    trunkingM: n(r.trunkingM, 200),
    drainM: n(r.drainM, 200),
    outlets: n(r.outlets, 40),
    outletMm: n(r.outletMm, 600),
    replacing: r.replacing === true || r.replacing === "yes" || r.replacing === "keep",
    underfloor: r.underfloor === true || r.underfloor === "yes",
    keptPipe: r.replacing === "keep" && (OLD_PIPES as readonly unknown[]).includes(r.keptPipe) ? (r.keptPipe as OldPipe) : null,
  };
}

/* ── the kits as the business's price list (slice 14.1) ──
   Every part of every kit at each size it comes in, as the business's own
   book would price it today: what it picks, why, and what it costs. A part
   the book hasn't got says so, which is the list of what to add. */

export type KitRow = { kit: KitKey; part: string; size: string; pick: { name: string; code: string; why: string; cents: number; perMetre: boolean } | null };

const ALL_FACTS: KitFacts = { pipe: null, pipeM: 1, powerM: 1, amps: null, mount: "ground", trunkingM: 2.4, drainM: 1, outlets: 1, outletMm: null };

export function kitPriceList(products: Product[], preferred: KitPreferences | null = null): KitRow[] {
  const rows: KitRow[] = [];
  const at = { optionIndex: 0, system: "" };
  const one = (kit: KitKey, partKey: string, size: string, f: KitFacts) => {
    const part = KITS[kit].parts.find((p) => p.key === partKey)!;
    const s = part.search(f);
    const picked = s ? (chosenFor(part, f, products, preferred, null) ?? pickItem(s.pool ? s.pool(products) : products, s)) : null;
    const line = picked ? expandKit(kit, f, products, at, null, null, preferred).find((l) => l.code === picked.offer.code) : null;
    rows.push({
      kit,
      part: part.name,
      size,
      pick: picked
        ? { name: picked.product.name, code: picked.offer.code, why: picked.why, cents: line?.costCents ?? picked.offer.netCents, perMetre: line?.unit === "m" }
        : null,
    });
  };
  for (const pipe of PIPE_SIZES) one("split", "pair-coil", pipe.replace("+", " + "), { ...ALL_FACTS, pipe });
  one("split", "interconnect", "", ALL_FACTS);
  for (const amps of [20, 32, 40]) one("split", "power", `${cableFor(amps)} mm²`, { ...ALL_FACTS, amps });
  for (const b of [16, 20, 25, 32, 40]) one("split", "breaker", `${b} A`, { ...ALL_FACTS, amps: b });
  for (const i of ISOLATORS) one("split", "isolator", `${i} A`, { ...ALL_FACTS, amps: i });
  one("split", "mount", "Feet", ALL_FACTS);
  one("split", "mount", "Wall bracket", { ...ALL_FACTS, mount: "wall" });
  one("split", "drain", "", ALL_FACTS);
  one("split", "trunking", "", ALL_FACTS);
  for (const mm of [150, 200, 250, 300, 350, 400]) one("ducted", "flex", `${mm} mm`, { ...ALL_FACTS, outletMm: mm });
  for (const mm of [150, 200, 250, 300]) one("ducted", "outlets", `${mm} mm`, { ...ALL_FACTS, outletMm: mm });
  one("ducted", "return", "", ALL_FACTS);
  return rows;
}
