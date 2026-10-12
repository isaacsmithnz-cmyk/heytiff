import { trunkingLengths } from "./buildup";
import { rollMetresOf } from "./components";
import type { Product } from "./families";
import type { LineFields } from "./lines";
import { pickItem, supplierOffer, type BookQuery, type Pick } from "./lookups";
import { inKind, isolatorOf, pickFromRange, RANGE_KINDS, sizeWords, type RangeKind, type RangeNeed, type RangeOffer, type RangeSize } from "./ranges";
import type { ComponentKey } from "./components";
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
  /* ducted, by the unit (Isaac, 2026-10-11, kits round 2: "we don't know
     what size that's going to be. It depends on the unit") */
  /** the indoor's model, for saying what a plenum is made for */
  indoorModel?: string | null;
  /** the indoor's supply face, mm, from its data pack: what the supply plenum is made for */
  supplyFace?: { w: number; h: number } | null;
  /** the spigots the ductwork takes off the supply plenum, mm */
  takeoffs?: number[] | null;
  /** the indoor's return face, mm; none when its return takes spigots */
  returnFace?: { w: number; h: number } | null;
  /** the indoor's return takes duct straight on: no return plenum */
  returnSpigots?: boolean;
  /** where the main duct splits, and where it steps down: from the layout */
  fittings?: { inMm: number; outsMm: number[]; count: number }[] | null;
  reducers?: { fromMm: number; toMm: number; count: number }[] | null;
  /** the return grille's face, mm; its box is the same face */
  returnGrille?: { w: number; h: number } | null;
};

/** The business's own allowances (Quoting): at cost, null when not set. */
export type KitAllowances = { consumables: number | null; flush: number | null; recovery: number | null };

export type KitPart = {
  key: string;
  group: string;
  /** how many, in words, and what sizes it, as Quoting's Kits says them
      (Isaac's kits, round 2) */
  rule?: string;
  sizedBy?: string;
  /** the range Quoting's Kits shows under it, and which of its kind are this part */
  shows?: { kind: RangeKind; only?: (name: string) => boolean };
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
      (ranges.ts); null when the size isn't known. `only` keeps to the items
      of the kind that are this part (a return box, not its grille) */
  range?: (f: KitFacts) => { kind: RangeKind; need: RangeNeed; only?: (name: string) => boolean } | null;
  /** a part that comes at several sizes on one job (the Ys where the main
      duct splits): a line for each, null when the layout isn't known */
  many?: (f: KitFacts) => { kind: RangeKind; need: RangeNeed; qty: number; why: string }[] | null;
  /** what to say when nothing in the book fits its size */
  none?: (f: KitFacts) => string;
  /** what to say when what sizes it isn't known */
  needs?: string;
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
    rule: "The pipe run",
    sizedBy: "The unit's pipe sizes",
    group: "Pipe, power and controls",
    name: "Pair coil",
    search: (f) => (f.pipe ? { text: `coil ${pipeWords(f.pipe)}` } : null),
    component: (f) => (f.pipe ? PIPE_COMPONENT[f.pipe] : null),
    qty: (f) => metres(f.pipeM, "pipe run"),
  },
  {
    key: "interconnect",
    rule: "With the pipe",
    group: "Pipe, power and controls",
    name: "Interconnect cable",
    search: () => ({ text: "interconnect" }),
    qty: (f) => metres(f.pipeM, "with the pipe"),
  },
  {
    key: "power",
    rule: "From the board",
    sizedBy: "What the outdoor draws",
    group: "Pipe, power and controls",
    name: "Power cable",
    search: (f) => (f.amps != null ? { text: `tps ${cableFor(f.amps)}` } : null),
    /* Quoting's power cable is the 2.5 mm² */
    component: (f) => (f.amps != null && cableFor(f.amps) === "2.5" ? "power_cable" : null),
    qty: (f) => metres(f.powerM, "from the board"),
  },
  {
    key: "breaker",
    rule: "One for the new circuit",
    sizedBy: "At or above what the outdoor draws",
    group: "Pipe, power and controls",
    name: "RCBO",
    search: (f) => (f.amps != null ? { text: "rcbo", pool: atLeast(f.amps, /rcbo/i) } : null),
    qty: one("one for the new circuit"),
  },
  {
    key: "isolator",
    rule: "One at the outdoor",
    sizedBy: "At or above what the outdoor draws",
    shows: { kind: "isolator" },
    group: "Pipe, power and controls",
    name: "Isolator",
    search: (f) => (f.amps != null ? { text: "isolator", pool: atLeast(f.amps, /isolat/i) } : null),
    range: (f) => (f.amps != null ? { kind: "isolator", need: { amps: f.amps } } : null),
    qty: one("one at the outdoor"),
  },
  {
    key: "mount",
    rule: "Under the outdoor",
    sizedBy: "Feet, or a bracket for its weight and width",
    shows: { kind: "wall_bracket" },
    group: "Mounting and drain",
    name: "Outdoor mount",
    search: (f) => (f.mount === "wall" ? { text: "wall bracket" } : { text: "feet" }),
    component: (f) => (f.mount === "wall" ? "wall_bracket" : "ground_mount"),
    qty: one("under the outdoor"),
  },
  {
    key: "drain",
    rule: "The drain's run",
    group: "Mounting and drain",
    name: "Drain hose",
    search: () => ({ text: "drain hose" }),
    component: () => "drain_hose",
    qty: (f) => metres(f.drainM, "of drain"),
  },
  {
    key: "trunking",
    rule: "The outside run, in 2.4 m lengths",
    group: "Mounting and drain",
    name: "Trunking",
    skip: (f) => !f.trunkingM,
    search: () => ({ text: "trunking" }),
    component: () => "pipe_cover",
    qty: (f) => (f.trunkingM ? { qty: trunkingLengths(f.trunkingM), unit: "", why: `${f.trunkingM} m outside, in 2.4 m lengths` } : null),
  },
];

const faceWords = (f: { w: number; h: number }) => `${f.w} × ${f.h}`;
const forUnit = (f: KitFacts) => (f.indoorModel ? `the ${f.indoorModel}'s` : "the unit's");
const BOX = /\bbox\b|\bbx\b/i;

const DUCTED: KitPart[] = [
  ...SPLIT,
  {
    key: "supply-plenum",
    rule: "One on the unit's supply",
    sizedBy: "Fits the indoor unit: its model and its face",
    shows: { kind: "plenum" },
    group: "Ductwork and grilles",
    name: "Supply plenum",
    needs: "Needs the indoor unit",
    search: (f) => (f.supplyFace ? { text: "plenum" } : null),
    range: (f) => (f.supplyFace ? { kind: "plenum", need: { ...f.supplyFace, ...(f.takeoffs?.length ? { spigots: f.takeoffs } : {}) } } : null),
    none: (f) => `No supply plenum for ${forUnit(f)} ${faceWords(f.supplyFace!)} face${f.takeoffs?.length ? ` with ${sizeWords("plenum", { spigots: f.takeoffs })}` : ""} in your book`,
    qty: (f) => ({ qty: 1, unit: "", why: f.supplyFace ? `made for ${forUnit(f)} ${faceWords(f.supplyFace)} supply` : "on the unit's supply" }),
  },
  {
    key: "return-plenum",
    rule: "One on the unit's return, unless it has return spigots",
    sizedBy: "Fits the indoor unit's return",
    shows: { kind: "return_plenum" },
    group: "Ductwork and grilles",
    name: "Return plenum",
    needs: "Needs the indoor unit",
    /* a return that takes spigots takes its duct straight on */
    skip: (f) => !!f.returnSpigots,
    search: (f) => (f.returnFace ? { text: "return plenum" } : null),
    range: (f) => (f.returnFace ? { kind: "return_plenum", need: { ...f.returnFace } } : null),
    none: (f) => `No return plenum for ${forUnit(f)} ${faceWords(f.returnFace!)} return in your book`,
    qty: (f) => ({ qty: 1, unit: "", why: f.returnFace ? `made for ${forUnit(f)} ${faceWords(f.returnFace)} return` : "on the unit's return" }),
  },
  {
    key: "flex",
    rule: "A 6 m bag to each outlet",
    sizedBy: "Each outlet's size",
    shows: { kind: "flex_duct" },
    group: "Ductwork and grilles",
    name: "Flex duct",
    search: (f) => (f.outletMm ? { text: "flex", sizeMm: f.outletMm } : null),
    range: (f) => (f.outletMm ? { kind: "flex_duct", need: { mm: f.outletMm } } : null),
    qty: (f) => (f.outlets ? { qty: f.outlets, unit: "", why: `a bag to each of ${f.outlets} outlets` } : null),
  },
  {
    key: "outlets",
    rule: "One per outlet",
    sizedBy: "Each outlet's size",
    shows: { kind: "round_diffuser" },
    group: "Ductwork and grilles",
    name: "Outlet diffuser",
    skip: (f) => !!f.underfloor,
    search: (f) => (f.outletMm ? { text: "diffuser", sizeMm: f.outletMm } : null),
    range: (f) => (f.outletMm ? { kind: "round_diffuser", need: { mm: f.outletMm } } : null),
    qty: (f) => (f.outlets ? { qty: f.outlets, unit: "", why: `${f.outlets} outlets` } : null),
  },
  {
    key: "ys",
    rule: "Where the main duct splits to the outlets",
    sizedBy: "By the duct sizes in and out",
    shows: { kind: "fitting" },
    group: "Ductwork and grilles",
    name: "Y branches",
    search: () => ({ text: "metal y" }),
    many: (f) =>
      f.fittings == null
        ? null
        : f.fittings.map((x) => ({ kind: "fitting" as const, need: { ins: [x.inMm], outs: x.outsMm }, qty: x.count, why: `where the main duct splits, Ø${x.inMm} to ${x.outsMm.map((o) => `Ø${o}`).join(" and ")}` })),
    none: () => "Needs the layout: where the main duct splits",
    qty: () => null,
  },
  {
    key: "reducers",
    rule: "Where the main duct steps down",
    sizedBy: "By the duct sizes either side",
    shows: { kind: "reducer" },
    group: "Ductwork and grilles",
    name: "Reducer",
    search: () => ({ text: "reducer" }),
    /* only where the layout says the main duct steps down */
    skip: (f) => !f.reducers?.length,
    many: (f) => (f.reducers ?? []).map((x) => ({ kind: "reducer" as const, need: { ins: [x.fromMm], outs: [x.toMm] }, qty: x.count, why: `where the main duct steps down, Ø${x.fromMm} to Ø${x.toMm}` })),
    qty: () => null,
  },
  /* under the floor: a floor grille on a boot at each outlet, the indoor on springs */
  {
    key: "floor-grilles",
    rule: "One per floor outlet",
    sizedBy: "The boot's face",
    group: "Ductwork and grilles",
    name: "Floor grille",
    skip: (f) => !f.underfloor,
    search: () => ({ text: "floor grille" }),
    qty: (f) => (f.outlets ? { qty: f.outlets, unit: "", why: `${f.outlets} outlets in the floor` } : null),
  },
  {
    key: "boots",
    rule: "One under each floor grille",
    sizedBy: "The grille's face and the outlet's size",
    group: "Ductwork and grilles",
    name: "Floor boot",
    skip: (f) => !f.underfloor,
    search: () => ({ text: "boot" }),
    qty: (f) => (f.outlets ? { qty: f.outlets, unit: "", why: `one under each floor grille` } : null),
  },
  {
    key: "hangers",
    rule: "Four, at the indoor's hanging points",
    group: "Mounting and drain",
    name: "Spring hangers",
    skip: (f) => !f.underfloor,
    search: () => ({ text: "spring hanger" }),
    qty: () => ({ qty: 4, unit: "", why: "one at each of the indoor's four hanging points" }),
  },
  /* the return at the size it's sized to, from the range: never a guessed
     size (Isaac, 2026-10-11: "Return grille again, range of sizes") */
  {
    key: "return",
    rule: "One on the return",
    sizedBy: "Sized to the unit's return air",
    shows: { kind: "return_grille", only: (n) => !BOX.test(n) },
    group: "Ductwork and grilles",
    name: "Return air grille, filtered",
    needs: "Needs its size: pick it from your range",
    search: (f) => (f.returnGrille ? { text: "return filter" } : null),
    range: (f) => (f.returnGrille ? { kind: "return_grille", need: { ...f.returnGrille }, only: (n) => !BOX.test(n) } : null),
    none: (f) => `No ${faceWords(f.returnGrille!)} return grille in your book`,
    qty: (f) => ({ qty: 1, unit: "", why: f.returnGrille ? `${faceWords(f.returnGrille)}, sized to the unit's return air` : "its size to pick" }),
  },
  {
    key: "return-box",
    rule: "One behind the return grille",
    sizedBy: "The grille's face",
    shows: { kind: "return_grille", only: (n) => BOX.test(n) },
    group: "Ductwork and grilles",
    name: "Return air box",
    needs: "Needs its size: pick it from your range",
    search: (f) => (f.returnGrille ? { text: "return box" } : null),
    range: (f) => (f.returnGrille ? { kind: "return_grille", need: { ...f.returnGrille }, only: (n) => BOX.test(n) } : null),
    none: (f) => `No ${faceWords(f.returnGrille!)} return box in your book`,
    qty: (f) => ({ qty: 1, unit: "", why: f.returnGrille ? `behind the ${faceWords(f.returnGrille)} return grille` : "behind the return grille, its size to pick" }),
  },
  {
    key: "controller",
    rule: "One for the indoor",
    group: "Pipe, power and controls",
    name: "Wall controller",
    search: () => ({ text: "wired controller" }),
    component: () => "wall_controller",
    qty: one("for the indoor"),
  },
];

/* CONSUMABLES, ESTIMATED FROM THE BOOK (Isaac, 2026-10-10: "I notice
   you've got to check consumables not known yet. That could be an
   estimate. And we can confirm that"). With no allowance set in Quoting, a
   kit's consumables are the business's own items for what an install of
   its kind uses, one of each or two, priced from its book; the line says
   it's an estimate, to confirm. Anything the book hasn't got is left out
   and the words say what was used. */
const CONSUMABLES: Record<KitKey, { words: string; text: string; qty: number }[]> = {
  split: [
    { words: "duct tape", text: "duct tape", qty: 1 },
    { words: "cable ties", text: "cable tie", qty: 1 },
    { words: "silicone", text: "silicone", qty: 1 },
  ],
  ducted: [
    { words: "duct tape", text: "duct tape", qty: 2 },
    { words: "cable ties", text: "cable tie", qty: 1 },
    { words: "duct sealant", text: "duct sealant", qty: 1 },
    { words: "silicone", text: "silicone", qty: 1 },
    { words: "brazing rods", text: "brazing", qty: 2 },
  ],
};

/** A kit's consumables, from the business's book: what they cost it, and
    the words for what was used; null when the book has none of them. */
export function consumablesEstimate(kit: KitKey, products: Product[], supplier: string | null = null): { costCents: number; words: string } | null {
  let cost = 0;
  const used: string[] = [];
  for (const c of CONSUMABLES[kit]) {
    const picked = pickItem(products, { text: c.text }, supplier);
    if (!picked) continue;
    cost += picked.offer.netCents * c.qty;
    used.push(c.qty > 1 ? `${c.words} x${c.qty}` : c.words);
  }
  return used.length ? { costCents: Math.round(cost * 10) / 10, words: used.join(", ") } : null;
}

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
  const offers = r ? (preferred.ranges.get(r.kind) ?? []).filter((o) => !r.only || r.only(o.name)) : [];
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

/** Every item in the book of a range's kind, at its size: the range a
    business hasn't narrowed yet is every size it can buy (Isaac's kits,
    round 2: every size starts ticked). */
export function bookRange(products: readonly Product[], kind: RangeKind, only?: (name: string) => boolean): (RangeOffer & { size: RangeSize })[] {
  const out: (RangeOffer & { size: RangeSize })[] = [];
  for (const p of products)
    for (const o of p.offers) {
      if (o.netCents <= 0 || !inKind(kind, o.name) || (only && !only(o.name))) continue;
      const size = RANGE_KINDS[kind].sizeOf(o.name);
      if (size) out.push({ size, perUnitCents: o.netCents, supplierKey: o.supplierKey, code: o.code, name: o.name });
    }
  return out;
}

/** The item at a size: the business's range first (the job's supplier's
    item first), else the book's items of the kind at that size. */
function atSize(kind: RangeKind, need: RangeNeed, products: readonly Product[], preferred: KitPreferences | null, supplier: string | null, only?: (name: string) => boolean): Pick | null {
  const held = (preferred?.ranges.get(kind) ?? []).filter((o) => !only || only(o.name));
  const offers = held.length ? held : bookRange(products, kind, only);
  const mine = supplier ? offers.filter((o) => o.supplierKey === supplier) : [];
  const hit = pickFromRange(kind, mine, need) ?? pickFromRange(kind, offers, need);
  const product = hit ? products.find((p) => p.offers.some((o) => o.supplierKey === hit.supplierKey && o.code === hit.code)) : null;
  const offer = product?.offers.find((o) => o.supplierKey === hit!.supplierKey && o.code === hit!.code);
  return product && offer ? { product, offer, why: held.length ? "Your range" : "In your book" } : null;
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
  preferred: KitPreferences | null = null,
  /** one part alone, with no allowances: Quoting's Kits, part by part */
  only: string | null = null
): Partial<LineFields>[] {
  const out: Partial<LineFields>[] = [];
  for (const part of KITS[kit].parts) {
    if (only && part.key !== only) continue;
    if (part.skip?.(f)) continue;
    /* a part at several sizes: a line for each, from the range */
    if (part.many) {
      const base = { optionIndex: at.optionIndex, system: at.system, group: part.group, kind: "material" as const };
      const each = part.many(f);
      if (each == null) {
        out.push({ ...base, name: part.name, qty: 0, unit: "", costCents: 0, source: "unknown", why: part.none?.(f) ?? "Needs the layout" });
        continue;
      }
      for (const x of each) {
        const picked = atSize(x.kind, x.need, products, preferred, supplier);
        if (!picked) {
          out.push({ ...base, name: `${part.name} ${sizeWords(x.kind, x.need)}`, qty: x.qty, unit: "", costCents: 0, source: "unknown", why: `None at ${sizeWords(x.kind, x.need)} in your book` });
          continue;
        }
        out.push({ ...base, name: picked.product.name, code: picked.offer.code, supplierKey: picked.offer.supplierKey, qty: x.qty, unit: "", costCents: picked.offer.netCents, source: "assumed", why: `${x.why}; ${picked.why.toLowerCase()}` });
      }
      continue;
    }
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
      const why = !s ? (part.needs ?? (part.key === "pair-coil" && f.keptPipe ? "Needs the unit's details to check the old pipe" : "Needs the unit's details")) : "Needs the run";
      out.push({ ...base, name: part.name, qty: q?.qty ?? 0, unit: q?.unit ?? "", costCents: 0, source: "unknown", why });
      continue;
    }
    const pool = s.pool ? s.pool(products) : products;
    /* a part sized by the unit or the layout comes only at its size: never
       the book's nearest word for it */
    const sized = part.none ? part.range?.(f) : null;
    const picked = sized ? atSize(sized.kind, sized.need, products, preferred, supplier, sized.only) : (chosenFor(part, f, products, preferred, supplier) ?? pickItem(pool, s, supplier));
    if (!picked) {
      out.push({ ...base, name: part.name, qty: q.qty, unit: q.unit, costCents: 0, source: "unknown", why: sized && part.none ? part.none(f) : "Not in your book" });
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
  if (allowances && !only) {
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
    const estimate = allowances.consumables == null ? consumablesEstimate(kit, products, supplier) : null;
    if (estimate) {
      out.push({
        optionIndex: at.optionIndex,
        system: at.system,
        group: "Allowances",
        kind: "material",
        name: "Consumables",
        qty: 1,
        unit: "",
        costCents: estimate.costCents,
        source: "assumed",
        why: `An estimate from your book: ${estimate.words}`,
        estimate: true,
      });
    } else allow("Consumables", allowances.consumables, "your allowance, a head");
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
/** The parts a kit left needing their size, the layout or a price: what
    Tiff has to settle, from the book or by asking (the 2026-10-12 bench:
    3384's return grille, box and Ys were left unpriced and never asked). */
export const stillToSize = (lines: readonly Partial<LineFields>[]) =>
  lines.filter((l) => l.source === "unknown").map((l) => ({ name: l.name ?? "", why: l.why ?? "" }));

/** A unit's pipe from its data pack's connections, mm, as a kit's size. */
export function pipeFromMm(liquid: number, gas: number): PipeSize | null {
  const inch = (mm: number) => MM_INCH.find(([v]) => Math.abs(v - mm) < 0.2)?.[1];
  const p = `${inch(liquid)}+${inch(gas)}`;
  return (PIPE_SIZES as readonly string[]).includes(p) ? (p as PipeSize) : null;
}

/** What a ducted indoor's data pack gives a kit: its model, the faces its
    plenums are made for, and whether its return takes duct straight on. */
export function indoorFacts(u: { model: string; air?: { supply: { w: number; h: number } | null; ret: { w: number; h: number } | null; returnSpigots: boolean } }): Partial<KitFacts> {
  if (!u.air) return { indoorModel: u.model };
  return { indoorModel: u.model, supplyFace: u.air.supply, returnFace: u.air.returnSpigots ? null : u.air.ret, returnSpigots: u.air.returnSpigots };
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
    ...layoutFacts(r),
  };
}

/* a duct size: a round one a book sells */
const ductMm = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) && x >= 80 && x <= 700 && x % 25 === 0 ? x : null;
};
const count = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) && x >= 1 ? Math.min(40, Math.round(x)) : 1;
};
const faceIn = (v: unknown) => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const w = Number(o.w);
  const h = Number(o.h);
  return Number.isFinite(w) && Number.isFinite(h) && w >= 100 && w <= 3000 && h >= 100 && h <= 3000 ? { w: Math.round(w), h: Math.round(h) } : null;
};

/** The layout a person or Tiff gave, made safe: only what was given, so a
    kit without one says it needs it (kits, round 2). */
function layoutFacts(r: Record<string, unknown>): Partial<KitFacts> {
  const out: Partial<KitFacts> = {};
  if (Array.isArray(r.takeoffs)) {
    const t = r.takeoffs.map(ductMm).filter((n): n is number => n != null).slice(0, 8);
    if (t.length) out.takeoffs = t;
  }
  if (Array.isArray(r.fittings))
    out.fittings = r.fittings.slice(0, 12).flatMap((x) => {
      const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
      const inMm = ductMm(o.inMm);
      const outsMm = (Array.isArray(o.outsMm) ? o.outsMm : []).map(ductMm).filter((n): n is number => n != null).slice(0, 4);
      return inMm != null && outsMm.length >= 2 ? [{ inMm, outsMm, count: count(o.count) }] : [];
    });
  if (Array.isArray(r.reducers))
    out.reducers = r.reducers.slice(0, 12).flatMap((x) => {
      const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
      const fromMm = ductMm(o.fromMm);
      const toMm = ductMm(o.toMm);
      return fromMm != null && toMm != null && fromMm > toMm ? [{ fromMm, toMm, count: count(o.count) }] : [];
    });
  const grille = faceIn(r.returnGrille);
  if (grille) out.returnGrille = grille;
  return out;
}

/* ── the kits in Quoting, part by part (Isaac's kits, round 2, 2026-10-11:
   "there should be a selection under each item… all of the Y branch
   combinations") ──
   Each part as the kit says it (how many, what sizes it), what it comes to
   at the business's example, and under it every item of its kind in the
   book: ticked where it's in the business's range (every size, until the
   business narrows it), and the ones the example used. Pure. */

export type KitPreviewItem = { supplierKey: string; supplierName: string; code: string; name: string; words: string; size: RangeSize; cents: number; ticked: boolean; used: boolean };
export type KitPreviewLine = { name: string; code: string | null; qty: number; unit: string; eachCents: number; totalCents: number; known: boolean; why: string };
export type KitPreviewPart = {
  key: string;
  name: string;
  rule: string;
  sizedBy: string;
  lines: KitPreviewLine[];
  range: { kind: RangeKind; held: boolean; items: KitPreviewItem[] } | null;
};

export function kitPreview(kit: KitKey, f: KitFacts, products: Product[], preferred: KitPreferences | null): { parts: KitPreviewPart[]; totalCents: number } {
  const at = { optionIndex: 0, system: "" };
  const supplierName = new Map(products.flatMap((p) => p.offers.map((o) => [o.supplierKey, o.supplierName] as const)));
  const parts: KitPreviewPart[] = [];
  let total = 0;
  for (const part of KITS[kit].parts) {
    if (part.skip?.(f)) continue;
    const lines = expandKit(kit, f, products, at, null, null, preferred, part.key).map((l) => {
      const known = !!l.code && (l.costCents ?? 0) > 0;
      const each = l.costCents ?? 0;
      const totalCents = Math.round(each * (l.qty ?? 0));
      if (known) total += totalCents;
      return { name: l.name ?? part.name, code: l.code ?? null, qty: l.qty ?? 0, unit: l.unit ?? "", eachCents: each, totalCents, known, why: l.why ?? "" };
    });
    let range: KitPreviewPart["range"] = null;
    if (part.shows) {
      const { kind, only } = part.shows;
      const held = (preferred?.ranges.get(kind) ?? []).filter((o) => !only || only(o.name));
      const inRange = new Set(held.map((o) => `${o.supplierKey}|${o.code}`));
      const used = new Set(lines.filter((l) => l.code).map((l) => l.code!));
      range = {
        kind,
        held: held.length > 0,
        items: bookRange(products, kind, only).map((o) => ({
          supplierKey: o.supplierKey,
          supplierName: supplierName.get(o.supplierKey) ?? o.supplierKey,
          code: o.code,
          name: o.name,
          words: sizeWords(kind, o.size),
          size: o.size,
          cents: o.perUnitCents,
          ticked: held.length === 0 || inRange.has(`${o.supplierKey}|${o.code}`),
          used: used.has(o.code),
        })),
      };
    }
    parts.push({ key: part.key, name: part.name, rule: part.rule ?? "", sizedBy: part.sizedBy ?? "", lines, range });
  }
  return { parts, totalCents: total };
}
