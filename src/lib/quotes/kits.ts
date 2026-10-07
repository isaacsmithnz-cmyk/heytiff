import { trunkingLengths } from "./buildup";
import { rollMetresOf } from "./components";
import type { Product } from "./families";
import type { LineFields } from "./lines";
import { pickItem, type BookQuery } from "./lookups";
import { isolatorOf } from "./ranges";

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
};

export type KitPart = {
  key: string;
  group: string;
  /** the line's name when the book has nothing for it */
  name: string;
  /** what to look for in the book, or null when a fact it needs is missing */
  search: (f: KitFacts) => (BookQuery & { match?: (p: Product) => boolean }) | null;
  /** how many, and in what: null when a fact it needs is missing */
  qty: (f: KitFacts) => { qty: number; unit: LineFields["unit"]; why: string } | null;
  /** a part only some jobs take: left off when this says so */
  skip?: (f: KitFacts) => boolean;
};

/* the circuit's parts by what the unit draws: the next standard size up */
const BREAKERS = [10, 16, 20, 25, 32, 40, 50, 63];
const ISOLATORS = [20, 35, 63];
export const breakerFor = (amps: number) => BREAKERS.find((b) => b >= amps) ?? null;
export const isolatorFor = (amps: number) => ISOLATORS.find((b) => b >= amps) ?? null;
/** TPS by the circuit it carries: 2.5 mm² to 20 A, 4 mm² to 32 A, 6 mm² beyond. */
export const cableFor = (amps: number) => (amps <= 20 ? "2.5" : amps <= 32 ? "4" : "6");

const rated = (want: number) => (p: Product) => isolatorOf(p.name)?.amps === want;
const pipeWords = (pipe: PipeSize) => pipe.replace("+", " ");
const metres = (m: number | null, what: string) => (m != null && m > 0 ? { qty: m, unit: "m" as const, why: `${m} m ${what}` } : null);
const one = (why: string) => () => ({ qty: 1, unit: "" as const, why });

const SPLIT: KitPart[] = [
  {
    key: "pair-coil",
    group: "Pipe, power and controls",
    name: "Pair coil",
    search: (f) => (f.pipe ? { text: `coil ${pipeWords(f.pipe)}` } : null),
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
    qty: (f) => metres(f.powerM, "from the board"),
  },
  {
    key: "breaker",
    group: "Pipe, power and controls",
    name: "RCBO",
    search: (f) => {
      const b = f.amps != null ? breakerFor(f.amps) : null;
      return b ? { text: "rcbo", match: rated(b) } : null;
    },
    qty: one("one for the new circuit"),
  },
  {
    key: "isolator",
    group: "Pipe, power and controls",
    name: "Isolator",
    search: (f) => {
      const i = f.amps != null ? isolatorFor(f.amps) : null;
      return i ? { text: "isolator", match: rated(i) } : null;
    },
    qty: one("one at the outdoor"),
  },
  {
    key: "mount",
    group: "Mounting and drain",
    name: "Outdoor mount",
    search: (f) => (f.mount === "wall" ? { text: "wall bracket" } : { text: "feet" }),
    qty: one("under the outdoor"),
  },
  {
    key: "drain",
    group: "Mounting and drain",
    name: "Drain hose",
    search: () => ({ text: "drain hose" }),
    qty: (f) => metres(f.drainM, "of drain"),
  },
  {
    key: "trunking",
    group: "Mounting and drain",
    name: "Trunking",
    skip: (f) => !f.trunkingM,
    search: () => ({ text: "trunking" }),
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
    qty: (f) => (f.outlets ? { qty: f.outlets, unit: "", why: `a bag to each of ${f.outlets} outlets` } : null),
  },
  {
    key: "outlets",
    group: "Ductwork and grilles",
    name: "Outlet diffuser",
    search: (f) => (f.outletMm ? { text: "diffuser", sizeMm: f.outletMm } : null),
    qty: (f) => (f.outlets ? { qty: f.outlets, unit: "", why: `${f.outlets} outlets` } : null),
  },
  {
    key: "return",
    group: "Ductwork and grilles",
    name: "Return air grille, filtered",
    search: () => ({ text: "return filter" }),
    qty: one("one return, its size to confirm"),
  },
];

export const KITS: Record<KitKey, { label: string; parts: KitPart[] }> = {
  split: { label: "Split install", parts: SPLIT },
  ducted: { label: "Ducted install", parts: DUCTED },
};

/** A kit's parts as lines for one option and system, each picked from the
    book; a part with a fact missing, or that the book hasn't got, is a line
    nobody knows the price of yet, saying why. */
export function expandKit(kit: KitKey, f: KitFacts, products: Product[], at: { optionIndex: number; system: string }): Partial<LineFields>[] {
  const out: Partial<LineFields>[] = [];
  for (const part of KITS[kit].parts) {
    if (part.skip?.(f)) continue;
    const q = part.qty(f);
    const s = part.search(f);
    const base = { optionIndex: at.optionIndex, system: at.system, group: part.group, kind: "material" as const };
    if (!q || !s) {
      out.push({ ...base, name: part.name, qty: q?.qty ?? 0, unit: q?.unit ?? "", costCents: 0, source: "unknown", why: !s ? "Needs the unit's details" : "Needs the run" });
      continue;
    }
    const pool = s.match ? products.filter(s.match) : products;
    const picked = pickItem(pool, s);
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
      source: "assumed",
      why: `${q.why}; ${picked.why.toLowerCase()}`,
    });
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
  };
}
