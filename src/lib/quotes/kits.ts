import { trunkingLengths } from "./buildup";
import { matchesComponent, rollMetresOf } from "./components";
import type { Product } from "./families";
import type { LineFields } from "./lines";
import { pickItem, supplierOffer, type BookQuery, type Pick } from "./lookups";
import { inKind, isolatorOf, pickFromRange, RANGE_KINDS, sizeWords, type RangeKind, type RangeNeed, type RangeOffer, type RangeSize } from "./ranges";
import type { ComponentKey } from "./components";
import type { Preferred } from "./settings";
import type { ZoningController } from "@/lib/studio/packs/schema";
import type { VrfPlan } from "./vrf-kit";

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

export type KitKey = "split" | "ducted" | "vrf";

/** A kit in a word, as its lines' history and Tiff's steps say it. */
export const KIT_WORD: Record<KitKey, string> = { split: "Split", ducted: "Ducted", vrf: "VRF" };

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
  /** the breaker its maker says to fit, amps, and the smallest power cable it
      allows, mm²: off the outdoor's pack, where the book prints them */
  breakerA?: number | null;
  cableMm2?: number | null;
  /** the outdoor's supply, off its pack: its breaker, isolator and cable are
      for it (3363, 24 October: a 3-phase PUMY-P200 got a single-pole RCBO) */
  phase?: "1" | "3" | null;
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
  /** the unit's maker, by its pack's key: what a part only its own maker
      makes (the wall controller) is picked of */
  brand?: string | null;
  /** ducted, zoned: how many zones, controlled by temperature or on/off,
      and WiFi when the brief asks for it */
  zones?: number | null;
  zoneControl?: "temperature" | "on_off" | null;
  wifi?: boolean;
  /** the maker's zone system for it, from its data pack (zoneKitOf) */
  zoning?: ZoneKit | null;
  /* VRF (vrf-kit.ts): the heads, the run's lengths, and the run as the
     maker's table sizes it */
  /** the heads, by model, each with its own branch where it was given */
  vrfHeads?: { model: string; branchM: number | null }[] | null;
  /** the outdoor to the first joint, joint to joint, and each head's branch, metres */
  mainM?: number | null;
  betweenM?: number | null;
  branchM?: number | null;
  vrf?: VrfPlan | null;
};

/** THE MAKER'S ZONE SYSTEM ON A DUCTED JOB, from its data pack (Isaac,
    2026-10-13, on 3231: the PAR-41MAAM is the standard controller "but it is
    not compatible with the zone control box"): the interface for the zones
    and the control, the system's own main controller in place of the unit's
    wall controller, a sensor in every zone where it controls by temperature
    with the receiver they talk to, and the system's WiFi. */
export type ZoneKit = {
  zones: number;
  control: "temperature" | "on_off";
  /** null: none of the maker's interfaces takes this many zones */
  interface: string | null;
  mainController: string | null;
  receiver: string | null;
  sensor: string | null;
  wifi: string | null;
  /** the document it's read from, for the line's why */
  from: string;
};

export function zoneKitOf(z: ZoningController, zones: number, control: "temperature" | "on_off", wifi: boolean): ZoneKit {
  const fits = (z.interfaces ?? []).filter((i) => i.control === control && i.max_zones >= zones).sort((a, b) => a.max_zones - b.max_zones);
  const wireless = (z.sensors ?? []).find((s) => s.kind === "wireless") ?? null;
  const sensor = control === "temperature" && z.temperature_sensor_per_zone && wireless ? wireless.model : null;
  return {
    zones,
    control,
    interface: fits[0]?.model ?? null,
    mainController: z.main_controller?.model ?? null,
    receiver: sensor && z.wireless_receiver ? z.wireless_receiver.model : null,
    sensor,
    wifi: wifi ? (z.wifi ?? null) : null,
    from: [z.provenance.source, z.provenance.edition].filter(Boolean).join(" "),
  };
}

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
  /** that name, for this job (a 3-phase outdoor's breaker) */
  nameFor?: (f: KitFacts) => string;
  /** what to look for in the book, or null when a fact it needs is missing;
      `pool` narrows the book first (a rating at or above the draw) */
  search: (f: KitFacts) => (BookQuery & { pool?: (all: Product[]) => Product[] }) | null;
  /** how many, and in what: null when a fact it needs is missing */
  qty: (f: KitFacts) => { qty: number; unit: LineFields["unit"]; why: string } | null;
  /** a part only some jobs take: left off when this says so */
  skip?: (f: KitFacts) => boolean;
  /** a part only the unit's own maker makes: the business's preferred one
      counts only when it's that maker's (the bench, 15 October: a
      Mitsubishi wall controller on a Daikin and on a Fujitsu) */
  ownMaker?: (f: KitFacts) => boolean;
  /** the business's range it's picked from, at the size the job needs
      (ranges.ts); null when the size isn't known. `only` keeps to the items
      of the kind that are this part (a return box, not its grille) */
  range?: (f: KitFacts) => { kind: RangeKind; need: RangeNeed; only?: (name: string) => boolean } | null;
  /** a part that comes at several sizes on one job (the Ys where the main
      duct splits): a line for each, null when the layout isn't known */
  many?: (f: KitFacts) => { kind: RangeKind; need: RangeNeed; qty: number; why: string }[] | null;
  /** a part that is several items on one job, each its own line, picked
      from the book like any part (a VRF's pipe at each size, its joints by
      part): null when what sizes them isn't known */
  each?: (f: KitFacts) => KitEach[] | null;
  /** what to say when nothing in the book fits its size */
  none?: (f: KitFacts) => string;
  /** what to say when what sizes it isn't known */
  needs?: string | ((f: KitFacts) => string);
  /** the part as Quoting names its preferred item (components.ts) */
  component?: (f: KitFacts) => ComponentKey | null;
  /** ductwork: the air side, from the plenums to the grilles, which the
      business's duct contingency is a share of (buildup.ts). Never the
      unit, its pipe, power, controls, mounting or drain: a layout changes on
      site, they don't */
  duct?: boolean;
};

/** One item of a part that comes as several (KitPart.each). */
export type KitEach = {
  name: string;
  /** null: it can't be picked, and `needs` says why */
  search: BookQuery | null;
  component?: ComponentKey | null;
  qty: { qty: number; unit: LineFields["unit"]; why: string } | null;
  needs?: string;
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

/** A product's maker (brands.ts, "Mitsubishi Electric") is a pack's
    (mitsubishi-electric): unknown is not the same. */
export const sameMaker = (productBrand: string | null | undefined, packKey: string) => {
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !!productBrand && flat(productBrand) === flat(packKey);
};

/** TPS by the circuit it carries: 2.5 mm² to 20 A, 4 mm² to 32 A, 6 mm² beyond. */
export const cableFor = (amps: number) => (amps <= 20 ? "2.5" : amps <= 32 ? "4" : "6");

/** The power cable's size: by what the outdoor draws, never under the
    smallest its maker allows (a PUMY-SP112's book asks 6.0 mm² where 30.5 A
    would read as 4); null when neither is known. */
export function cableSizeOf(f: { amps: number | null; cableMm2?: number | null }): string | null {
  const byDraw = f.amps != null ? Number(cableFor(f.amps)) : null;
  const sizes = [byDraw, f.cableMm2 ?? null].filter((x): x is number => x != null && x > 0);
  return sizes.length ? String(Math.max(...sizes)) : null;
}

/** What a breaker and an isolator are sized at: the maker's breaker where the
    book prints one, and never under what the outdoor draws. */
const breakerNeed = (f: { amps: number | null; breakerA?: number | null }): number | null => f.breakerA ?? f.amps;
const isolatorNeed = (f: { amps: number | null; breakerA?: number | null }): number | null => {
  const both = [f.amps, f.breakerA].filter((x): x is number => x != null && x > 0);
  return both.length ? Math.max(...both) : null;
};

/** Whether a breaker's or isolator's poles suit the supply: three-phase
    takes one that says 3 or 4 pole; single phase never one that does. */
const polesFit = (poles: number | null, phase: KitFacts["phase"]) => (phase === "3" ? poles != null && poles >= 3 : phase === "1" ? poles == null || poles <= 2 : true);

/** The smallest rating the book has at or above what's needed, for the
    outdoor's supply: a 13.5 A unit takes a 20 A breaker when the business
    stocks no 16 A (3375). */
const atLeast = (want: number, words: RegExp, phase: KitFacts["phase"] = null) => (all: Product[]) => {
  const rated = all
    .filter((p) => words.test(p.name))
    .map((p) => ({ p, size: isolatorOf(p.name) }))
    .filter((x) => x.size != null && polesFit(x.size.poles, phase))
    .map((x) => ({ p: x.p, a: x.size!.amps }))
    .filter((x) => x.a >= want);
  const least = Math.min(...rated.map((x) => x.a));
  return rated.filter((x) => x.a === least).map((x) => x.p);
};
/** Quoting's single-phase power cable at each size a circuit takes. */
const POWER_COMPONENT: Record<string, ComponentKey> = { "2.5": "power_cable", "4": "power_cable_4", "6": "power_cable_6" };
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
    search: () => ({ text: "interconnect", pool: (all) => all.filter((p) => matchesComponent("interconnect", p.name)) }),
    component: () => "interconnect",
    qty: (f) => metres(f.pipeM, "with the pipe"),
  },
  {
    key: "power",
    rule: "From the board",
    sizedBy: "What the outdoor draws, never under its maker's smallest cable; four cores and earth on three phase",
    group: "Pipe, power and controls",
    name: "Power cable",
    nameFor: (f) => (f.phase === "3" ? `Power cable, 3-phase${cableSizeOf(f) ? ` ${cableSizeOf(f)} mm²` : ""}` : "Power cable"),
    search: (f) => {
      const size = cableSizeOf(f);
      if (!size) return null;
      /* three phase: a cable of four cores and earth at that size, never a TPS of two */
      return f.phase === "3"
        ? { text: "", pool: (all) => all.filter((p) => /\b[45]\s*c(ore)?\b|\b4c\s*\+\s*e\b|\b5c\b/i.test(p.name) && new RegExp(`\\b${size.replace(".", "\\.")}\\s*mm`, "i").test(p.name)) }
        : POWER_COMPONENT[size]
          ? /* single phase at 2.5, 4 or 6 mm²: twin and earth that size, as Quoting knows it, never
               any name with "tps" and the size's digit in it (a 1.5 mm interconnect's "450/750V" read as 4 mm²) */
            { text: "", pool: (all) => all.filter((p) => matchesComponent(POWER_COMPONENT[size]!, p.name)) }
          : { text: `tps ${size}` };
    },
    /* Quoting's power cables are the single-phase TPS at 2.5, 4 and 6 mm² */
    component: (f) => (f.phase === "3" ? null : (POWER_COMPONENT[cableSizeOf(f) ?? ""] ?? null)),
    qty: (f) => metres(f.powerM, "from the board"),
  },
  {
    key: "breaker",
    rule: "One for the new circuit",
    sizedBy: "Its maker's breaker, else at or above what the outdoor draws; 3-pole on three phase",
    group: "Pipe, power and controls",
    name: "RCBO",
    nameFor: (f) => (f.phase === "3" ? "Breaker, 3-pole" : "RCBO"),
    search: (f) => {
      const need = breakerNeed(f);
      if (need == null) return null;
      /* three phase: an RCBO or MCB of 3 or 4 poles, whatever the book calls it (no words to match: the pool is the search) */
      return f.phase === "3" ? { text: "", pool: atLeast(need, /rcbo|mcb|circuit breaker/i, "3") } : { text: "rcbo", pool: atLeast(need, /rcbo/i, f.phase) };
    },
    qty: one("one for the new circuit"),
  },
  {
    key: "isolator",
    rule: "One at the outdoor",
    sizedBy: "At or above its breaker and what it draws",
    shows: { kind: "isolator" },
    group: "Pipe, power and controls",
    name: "Isolator",
    nameFor: (f) => (f.phase === "3" ? "Isolator, 3-phase" : "Isolator"),
    search: (f) => {
      const need = isolatorNeed(f);
      return need != null ? { text: "isolator", pool: atLeast(need, /isolat/i, f.phase) } : null;
    },
    range: (f) => {
      const need = isolatorNeed(f);
      return need != null ? { kind: "isolator", need: { amps: need, phase: f.phase ?? null } } : null;
    },
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
    duct: true,
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
    duct: true,
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
    duct: true,
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
    duct: true,
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
    duct: true,
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
    duct: true,
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
    duct: true,
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
    duct: true,
    name: "Floor boot",
    needs: "Needs the outlets' size",
    skip: (f) => !f.underfloor,
    /* its spigot is the outlet's size, so only at the size given: any boot
       the book had was a size nobody said (Isaac, 2026-10-15, on 3231's "8
       boots": "It needs to be decided by the brief") */
    search: (f) => (f.outletMm ? { text: "boot", sizeMm: f.outletMm } : null),
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
    duct: true,
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
    duct: true,
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
    /* zoned: the zone system's own controller, never the unit's; else the
       unit's maker's own, from the book's wall controllers of that maker */
    ownMaker: (f) => !f.zoning?.mainController && !!f.brand,
    search: (f) =>
      f.zoning?.mainController
        ? { text: f.zoning.mainController }
        : f.brand
          ? { text: "control", pool: (all) => all.filter((p) => sameMaker(p.brand, f.brand!) && matchesComponent("wall_controller", p.name)) }
          : { text: "wired controller" },
    component: (f) => (f.zoning?.mainController ? null : "wall_controller"),
    qty: (f) =>
      f.zoning?.mainController
        ? { qty: 1, unit: "", why: `the zone system's own controller, in place of the unit's: ${f.zoning.from}` }
        : { qty: 1, unit: "", why: "for the indoor" },
  },
  {
    key: "zone-interface",
    rule: "One for the zones",
    group: "Pipe, power and controls",
    name: "Zone interface",
    /* zones asked for and no zone system read (no data pack named, or one
       without a zone system): a line not known yet, saying so. Skipped, "5
       zones" with the pack left on None added a kit with no zone parts and
       no word of it (2026-10-15) */
    skip: (f) => !f.zoning && !f.zones,
    needs: (f) => (f.zoning ? "None of the maker's zone interfaces takes this many zones" : "Needs the maker's zone system: none read off the unit's data pack"),
    search: (f) => (f.zoning?.interface ? { text: f.zoning.interface } : null),
    qty: (f) =>
      f.zoning
        ? { qty: 1, unit: "", why: `${f.zoning.zones} zones, ${f.zoning.control === "temperature" ? "by temperature" : "on and off"}: ${f.zoning.from}` }
        : { qty: 1, unit: "", why: `${f.zones} zones` },
  },
  {
    key: "zone-receiver",
    rule: "One for the wireless sensors",
    group: "Pipe, power and controls",
    name: "Wireless receiver",
    skip: (f) => !f.zoning?.receiver,
    search: (f) => ({ text: f.zoning!.receiver! }),
    qty: (f) => ({ qty: 1, unit: "", why: `the sensors talk to it: ${f.zoning!.from}` }),
  },
  {
    key: "zone-sensors",
    rule: "One in every zone, by temperature",
    group: "Pipe, power and controls",
    name: "Zone sensor",
    skip: (f) => !f.zoning?.sensor,
    search: (f) => ({ text: f.zoning!.sensor! }),
    qty: (f) => ({ qty: f.zoning!.zones, unit: "", why: `one in every zone, as temperature control needs: ${f.zoning!.from}` }),
  },
  {
    key: "zone-wifi",
    rule: "When asked for",
    group: "Pipe, power and controls",
    name: "WiFi",
    skip: (f) => !f.zoning?.wifi,
    search: (f) => ({ text: f.zoning!.wifi! }),
    qty: (f) => ({ qty: 1, unit: "", why: `the zone system's WiFi: ${f.zoning!.from}` }),
  },
];

/* inches, as the book names copper */
const INCH: [number, string][] = [
  [6.35, "1/4"],
  [9.52, "3/8"],
  [12.7, "1/2"],
  [15.88, "5/8"],
  [19.05, "3/4"],
  [22.2, "7/8"],
  [25.4, "1"],
  [28.58, "1-1/8"],
  [31.75, "1-1/4"],
  [34.92, "1-3/8"],
  [41.28, "1-5/8"],
];
const inchOf = (mm: number) => INCH.find(([v]) => Math.abs(v - mm) < 0.3)?.[1] ?? `${mm} mm`;
const splitPart = (key: string): KitPart => SPLIT.find((p) => p.key === key)!;
const vrfOf = (f: KitFacts) => (f.vrf?.ok ? f.vrf : null);
const vrfNeeds = (f: KitFacts) => (f.vrf && !f.vrf.ok ? f.vrf.why : "Needs the outdoor and its heads, from the data pack");
const vrfHeadCount = (f: KitFacts) => vrfOf(f)?.heads ?? f.vrfHeads?.length ?? null;

/* A VRF OR PUMY SYSTEM (Isaac, 2026-10-24: "ok", the VRF kit, after the
   21 October bench, where a PUMY job took eight of her fifteen rounds of
   searching the book part by part). Its run as the maker's table sizes it
   (vrf-kit.ts): the pipe at each size, the joints, headers and branch boxes
   by the book's part; the transmission cable along it; the outdoor's
   power, breaker and isolator as a split's; a wall controller for each of
   its VRF heads (a head on a branch box has its own); the mount, each
   head's drain and the trunking. */
const VRF: KitPart[] = [
  {
    key: "vrf-pipe",
    rule: "Each section of the run, at its size",
    sizedBy: "The maker's table, by the index each section carries",
    group: "Pipe, power and controls",
    name: "Refrigerant pipe",
    needs: vrfNeeds,
    search: () => null,
    qty: () => null,
    each: (f) => {
      const v = vrfOf(f);
      if (!v) return null;
      return v.pipes.map((p) => {
        const size = pipeFromMm(p.liquidMm, p.gasMm);
        const words = `${inchOf(p.liquidMm)} + ${inchOf(p.gasMm)}`;
        const sections = `${p.sections} ${p.sections === 1 ? "section" : "sections"} of the run`;
        const qty = p.m != null && p.m > 0 ? { qty: p.m, unit: "m" as const, why: `${p.m} m at ${words}, ${sections}, sized by ${v.from || "the maker's table"}` } : null;
        return size
          ? { name: `Pair coil ${words}`, search: { text: `coil ${pipeWords(size)}` }, component: PIPE_COMPONENT[size], qty, needs: `Needs the lengths of ${sections} at ${words}` }
          : { name: `Pipe ${words}, hard-drawn, with lagging`, search: null, qty, needs: `No pair coil at ${words}: hard-drawn pipe and its lagging, to price` };
      });
    },
  },
  {
    key: "vrf-fittings",
    rule: "One where the run splits",
    sizedBy: "The maker's joint for the index after it; a branch box for the heads it takes",
    group: "Pipe, power and controls",
    name: "Branch joint",
    needs: vrfNeeds,
    search: () => null,
    qty: () => null,
    each: (f) => {
      const v = vrfOf(f);
      if (!v) return null;
      return v.fittings.map((x) => {
        const what = x.kind === "box" ? "Branch box" : x.kind === "header" ? "Branch header" : "Branch joint";
        const index = x.index.join(", ");
        return {
          name: x.part ?? what,
          search: x.part ? { text: x.part } : null,
          qty: { qty: x.qty, unit: "" as const, why: `${x.qty} ${x.kind === "box" ? "for the heads it takes" : "where the run splits"}, for index ${index}: ${v.from || "the maker's table"}` },
          needs: `${what}: no row of the maker's table covers index ${index}`,
        };
      });
    },
  },
  {
    key: "transmission",
    rule: "With the pipe",
    group: "Pipe, power and controls",
    name: "Transmission cable",
    search: () => ({ text: "shielded", pool: (all) => all.filter((p) => matchesComponent("transmission_cable", p.name)) }),
    component: () => "transmission_cable",
    qty: (f) => metres(vrfOf(f)?.totalM ?? null, "with the pipe"),
  },
  splitPart("power"),
  splitPart("breaker"),
  splitPart("isolator"),
  {
    key: "controller",
    rule: "One for each VRF head",
    group: "Pipe, power and controls",
    name: "Wall controller",
    ownMaker: (f) => !!f.brand,
    skip: (f) => vrfOf(f)?.vrfHeads === 0,
    search: (f) =>
      f.brand ? { text: "control", pool: (all) => all.filter((p) => sameMaker(p.brand, f.brand!) && matchesComponent("wall_controller", p.name)) } : { text: "wired controller" },
    component: () => "wall_controller",
    qty: (f) => {
      const n = vrfOf(f)?.vrfHeads ?? null;
      return n ? { qty: n, unit: "", why: `one for each of the ${n} VRF ${n === 1 ? "head" : "heads"}` } : null;
    },
  },
  splitPart("mount"),
  {
    ...splitPart("drain"),
    rule: "Each head's drain",
    qty: (f) => {
      const n = vrfHeadCount(f);
      return n && f.drainM ? { qty: Math.round(n * f.drainM * 10) / 10, unit: "m", why: `${f.drainM} m for each of ${n} heads` } : null;
    },
  },
  splitPart("trunking"),
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
  /* a head's share: the kit takes one of these for each head */
  vrf: [
    { words: "brazing rods", text: "brazing", qty: 2 },
    { words: "cable ties", text: "cable tie", qty: 1 },
    { words: "duct tape", text: "duct tape", qty: 1 },
    { words: "silicone", text: "silicone", qty: 1 },
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
  vrf: { label: "VRF install", parts: VRF },
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
    /* another maker's: not this unit's part, so the book is searched */
    if (product && own && !(part.ownMaker?.(f) && !sameMaker(product.brand, f.brand!))) return { product, offer: (supplier ? supplierOffer(product, supplier) : null) ?? own, why: "Your preferred" };
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

/* the flag rides on the line into the quote (lines.ts keeps it), so a
   kit's ductwork carries the business's duct contingency like a hand-built
   quote's does: before it, a kit-built ducted quote priced it at nothing.
   On a line not known yet too, so it counts once a person prices it. */
const ductOf = (part: KitPart) => (part.duct ? { duct: true } : {});

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
      const base = { optionIndex: at.optionIndex, system: at.system, group: part.group, kind: "material" as const, ...ductOf(part) };
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
    /* a part that is several items, each its own line (a VRF's pipe at each
       size, its joints by part) */
    if (part.each) {
      const base = { optionIndex: at.optionIndex, system: at.system, group: part.group, kind: "material" as const, ...ductOf(part) };
      const items = part.each(f);
      if (items == null) {
        const needs = typeof part.needs === "function" ? part.needs(f) : part.needs;
        out.push({ ...base, name: part.name, qty: 0, unit: "", costCents: 0, source: "unknown", why: needs ?? "Needs the unit's details" });
        continue;
      }
      for (const x of items) {
        if (!x.search || !x.qty) {
          out.push({ ...base, name: x.name, qty: x.qty?.qty ?? 0, unit: x.qty?.unit ?? "", costCents: 0, source: "unknown", why: x.needs ?? "Not in your book" });
          continue;
        }
        const picked = chosenFor({ ...part, range: undefined, component: () => x.component ?? null }, f, products, preferred, supplier) ?? pickItem(products, x.search, supplier);
        if (!picked) {
          out.push({ ...base, name: x.name, qty: x.qty.qty, unit: x.qty.unit, costCents: 0, source: "unknown", why: `${x.qty.why}; not in your book` });
          continue;
        }
        const roll = x.qty.unit === "m" ? (rollMetresOf(picked.offer.name) ?? null) : null;
        out.push({
          ...base,
          name: picked.product.name,
          code: picked.offer.code,
          supplierKey: picked.offer.supplierKey,
          qty: x.qty.qty,
          unit: x.qty.unit,
          costCents: roll && roll > 1 ? Math.round((picked.offer.netCents / roll) * 10) / 10 : picked.offer.netCents,
          source: "assumed",
          why: `${x.qty.why}; ${picked.why.toLowerCase()}`,
        });
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
    const base = { optionIndex: at.optionIndex, system: at.system, group: part.group, kind: "material" as const, ...ductOf(part) };
    if (!q || !s) {
      const needs = typeof part.needs === "function" ? part.needs(f) : part.needs;
      const why = !s ? (needs ?? (part.key === "pair-coil" && f.keptPipe ? "Needs the unit's details to check the old pipe" : "Needs the unit's details")) : "Needs the run";
      out.push({ ...base, name: part.nameFor?.(f) ?? part.name, qty: q?.qty ?? 0, unit: q?.unit ?? "", costCents: 0, source: "unknown", why });
      continue;
    }
    const pool = s.pool ? s.pool(products) : products;
    /* a part sized by the unit or the layout comes only at its size: never
       the book's nearest word for it */
    const sized = part.none ? part.range?.(f) : null;
    const picked = sized ? atSize(sized.kind, sized.need, products, preferred, supplier, sized.only) : (chosenFor(part, f, products, preferred, supplier) ?? pickItem(pool, s, supplier));
    if (!picked) {
      out.push({ ...base, name: part.nameFor?.(f) ?? part.name, qty: q.qty, unit: q.unit, costCents: 0, source: "unknown", why: sized && part.none ? part.none(f) : "Not in your book" });
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
    /* a VRF's consumables are a head's share, for each head */
    const heads = kit === "vrf" ? (vrfHeadCount(f) ?? 1) : 1;
    const allow = (name: string, cents: number | null, why: string, qty = 1) =>
      out.push({
        optionIndex: at.optionIndex,
        system: at.system,
        group: "Allowances",
        kind: "material",
        name,
        qty,
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
        qty: heads,
        unit: "",
        costCents: estimate.costCents,
        source: "assumed",
        why: `An estimate from your book: ${estimate.words}${heads > 1 ? `, for each of ${heads} heads` : ""}`,
        estimate: true,
      });
    } else allow("Consumables", allowances.consumables, heads > 1 ? `your allowance, a head, for each of ${heads}` : "your allowance, a head", heads);
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
/** A kit's facts, filled from what was looked up: the outdoor's pipe and
    current where the person left them blank, the ducted indoor's faces, and
    the maker's zone system when zones were asked for. One step, used by the
    app (kits-server.ts) and the bench (session-bench.ts), so the bench can't
    test a kit the app no longer builds (2026-10-15: the bench's own copy
    missed the zone system of #1137). Pure. */
export function kitFactsFrom(
  kit: KitKey,
  facts: KitFacts,
  looked: readonly ({ found: true; specs: { role: "indoor" | "outdoor"; model: string; pipeMm: { liquid: number; gas: number } | null; mcaAmps: number | null; maxAmps: number | null; breakerA?: number | null; minCableMm2?: number | null; phase?: string | null; air?: { supply: { w: number; h: number } | null; ret: { w: number; h: number } | null; returnSpigots: boolean } } } | { found: false })[],
  zoning: ZoningController | null,
  /** the unit's maker, its pack's key, whether its pack is installed or not */
  brand: string | null = null
): KitFacts {
  const f = { ...facts, ...(brand ? { brand: brand.toLowerCase() } : {}) };
  for (const u of looked) {
    if (!u.found) continue;
    if (u.specs.role === "outdoor") {
      if (!f.pipe && u.specs.pipeMm) f.pipe = pipeFromMm(u.specs.pipeMm.liquid, u.specs.pipeMm.gas);
      if (f.amps == null) f.amps = u.specs.mcaAmps ?? u.specs.maxAmps;
      if (f.breakerA == null) f.breakerA = u.specs.breakerA ?? null;
      if (f.cableMm2 == null) f.cableMm2 = u.specs.minCableMm2 ?? null;
      if (f.phase == null) f.phase = u.specs.phase === "3" ? "3" : u.specs.phase === "1" ? "1" : null;
    }
    /* a ducted indoor: its plenums are made for its faces (kits, round 2) */
    if (u.specs.role === "indoor") Object.assign(f, indoorFacts(u.specs), f.supplyFace ? { supplyFace: f.supplyFace } : {});
  }
  /* zoned: the maker's zone system, from the pack of the brand it's for */
  if (kit === "ducted" && f.zones && zoning) f.zoning = zoneKitOf(zoning, f.zones, f.zoneControl ?? "temperature", !!f.wifi);
  return f;
}

/** What a VRF kit asks its maker's table: the outdoor, its heads and the run's lengths. */
export const vrfAskOf = (outdoor: string, f: KitFacts) => ({
  outdoor,
  heads: (f.vrfHeads ?? []).map((h) => ({ model: h.model, branchM: h.branchM })),
  mainM: f.mainM ?? null,
  betweenM: f.betweenM ?? null,
  branchM: f.branchM ?? null,
});

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
    ...zoneFacts(r),
    ...vrfFacts(r, n),
  };
}

/** A VRF's heads and the run's lengths, as given: only what was said. */
function vrfFacts(r: Record<string, unknown>, n: (v: unknown, max: number) => number | null): Partial<KitFacts> {
  const heads = (Array.isArray(r.vrfHeads) ? r.vrfHeads : []).slice(0, 50).flatMap((h) => {
    const o = h && typeof h === "object" ? (h as Record<string, unknown>) : {};
    const model = typeof o.model === "string" ? o.model.trim().slice(0, 60) : "";
    return model ? [{ model, branchM: n(o.branchM, 200) }] : [];
  });
  return {
    ...(heads.length ? { vrfHeads: heads } : {}),
    ...(n(r.mainM, 500) != null ? { mainM: n(r.mainM, 500) } : {}),
    ...(n(r.betweenM, 200) != null ? { betweenM: n(r.betweenM, 200) } : {}),
    ...(n(r.branchM, 200) != null ? { branchM: n(r.branchM, 200) } : {}),
  };
}

/** Zoned, as given: only what was said, so an unzoned kit carries none. */
function zoneFacts(r: Record<string, unknown>): Partial<KitFacts> {
  const z = typeof r.zones === "number" ? r.zones : Number(r.zones);
  return {
    ...(Number.isFinite(z) && z >= 1 ? { zones: Math.min(20, Math.round(z)) } : {}),
    ...(r.zoneControl === "temperature" || r.zoneControl === "on_off" ? { zoneControl: r.zoneControl } : {}),
    ...(r.wifi === true ? { wifi: true } : {}),
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
