import { familyLabel, familyWords } from "./families";

/* RANGES THAT COME IN SIZES (Isaac, 2026-10-04: "you pick one item, say
   your Y 14-10-10, and Tiff finds the same range's other sizes in your
   price book for you to confirm once").

   A kit needs a part at a size: an isolator for a 28 A outdoor, a bracket
   that holds 114 kg, a Ø250 zone damper, a Y from 14" into two 10", a
   plenum with three Ø250 spigots. One preferred item can't answer that, so
   a business keeps a RANGE of each: one product line at its supplier in
   every size it buys, each size read off the item's name and confirmed by
   a person. A quote then takes the size its line needs from the range.

   The size is read the way the suppliers write it: AAD's "VORTEX FLEXIBLE
   DUCT R1.0 250mm - 10\"", Airloc's "Y 14-10-10" in inches, Reece's
   "350 X 300 X 250 BTO", J&Z's "Bto 14101010", Actron's plenum "1/40+2/35
   SPIG". A size that can't be read isn't guessed: the item can't join a
   range until its name says.

   Pure and browser-safe (no lookbehind): the Quoting page, the server and
   the quote read the same sizes. */

export type RangeKind =
  | "isolator"
  | "wall_bracket"
  | "zone_damper"
  | "flex_duct"
  | "round_diffuser"
  | "square_diffuser"
  | "mdo"
  | "bar_grille"
  | "slot_diffuser"
  | "return_grille"
  | "fitting"
  | "plenum";

/** An item's size, or what a line needs, as far as its kind has one. */
export type RangeSize = {
  /** a round size, mm: a duct's, a damper's, a diffuser's neck */
  mm?: number;
  /** a face, mm: a grille's length or width, and its height */
  w?: number;
  h?: number;
  /** an isolator's rating and its poles, when the name says */
  amps?: number;
  poles?: number | null;
  /** what a wall bracket holds, kg; the widest outdoor it takes, when the business says */
  kg?: number;
  maxWidthMm?: number | null;
  /** a fitting's sizes, mm: the one in (a combo fits either), the ones out */
  ins?: number[];
  outs?: number[];
  /** a plenum's or a return box's spigots, mm */
  spigots?: number[];
  /** the length one is sold in, m: flexible duct by the bag */
  lengthM?: number | null;
};

/** What a line needs: a size, and for an isolator the outdoor's supply. */
export type RangeNeed = RangeSize & { phase?: "1" | "3" | null };

/** An item in one of the business's ranges, as Quoting shows it. */
export type RangeItemView = {
  supplierKey: string;
  supplierName: string;
  code: string;
  name: string;
  size: RangeSize;
  words: string;
  /** today's price to the business; null when the book no longer holds it */
  buyCents: number | null;
};
export type RangeView = { kind: RangeKind; items: RangeItemView[] };

/** A price-book item a range can be made from, with the size its name gives. */
export type CandidateItem = { code: string; name: string; size: RangeSize | null; words: string; buyCents: number };
/** A product line in the price book: one supplier's items whose names differ only by size. */
export type CandidateLine = { key: string; label: string; supplierKey: string; supplierName: string; quotes: number; items: CandidateItem[] };

/* ── reading sizes ── */

/* a duct size: 10" is a 250 */
const inchMm = (n: number) => n * 25;
const DUCT_MM = new Set([100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600]);
const roundMm = (n: number) => n >= 80 && n <= 700 && n % 25 === 0;

/** A round size in a name, mm: "Ø250", "250mm", "250 DIA", "10\"", or a
    duct size standing alone ("CONE DIFFUSER PLASTIC 150"). */
export function diameterOf(name: string): number | null {
  const s = name.replace(/\(EA\)/gi, " ");
  const marked = /[Øø⌀]\s*(\d{2,3})\b/.exec(s);
  if (marked && roundMm(Number(marked[1]))) return Number(marked[1]);
  const metric = /(\d{2,3})\s*mm/i.exec(s);
  if (metric && roundMm(Number(metric[1]))) return Number(metric[1]);
  const dia = /(\d{2,3})\s*dia\b/i.exec(s);
  if (dia && roundMm(Number(dia[1]))) return Number(dia[1]);
  const inch = /\b(\d{1,2})\s*(?:"|''|in\b|inch)/i.exec(s);
  if (inch && DUCT_MM.has(inchMm(Number(inch[1])))) return inchMm(Number(inch[1]));
  for (const m of s.matchAll(/(?:^|[\s-])(\d{3})(?=$|[\s-])/g)) if (DUCT_MM.has(Number(m[1]))) return Number(m[1]);
  return null;
}

/** A neck, mm, only where the name says it's the neck ("250 NECK", "Ø250",
    "595X595-200"): a diffuser's face is never its neck. */
export function neckOf(name: string): number | null {
  const s = name.replace(/\(EA\)/gi, " ");
  const marked = /[Øø⌀]\s*(\d{2,3})\b/.exec(s);
  if (marked && roundMm(Number(marked[1]))) return Number(marked[1]);
  const neck = /(\d{2,3})\s*(?:mm)?\s*neck\b/i.exec(s) ?? /\bneck\s*(\d{2,3})\b/i.exec(s);
  if (neck && roundMm(Number(neck[1]))) return Number(neck[1]);
  const suffix = /\d{3}\s*[xX×]\s*\d{3}\s*-\s*(\d{3})\b/.exec(s);
  if (suffix && roundMm(Number(suffix[1]))) return Number(suffix[1]);
  return null;
}

/** A face, mm: "1200X150", "900 X 400", "1055X145mm". */
export function faceOf(name: string): { w: number; h: number } | null {
  const m = /(\d{2,4})\s*(?:mm)?\s*[xX×]\s*(\d{2,4})/.exec(name);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w >= 50 && h >= 50 ? { w, h } : null;
}

const INCH_SIZES = new Set([4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);
const SEP = String.raw`(?:\s*[-.xX×]\s*|\s+)`;
const RUN = new RegExp(String.raw`(\d{1,3})${SEP}(\d{1,3})${SEP}(\d{1,3})(?:${SEP}(\d{1,3}))?`);

/** A run of duct sizes, mm: inches when every figure is one ("14-10-10"),
    else millimetres ("350 X 300 X 250"); a mix is no size. */
function ductRun(figures: number[]): number[] | null {
  if (figures.every((n) => INCH_SIZES.has(n))) return figures.map(inchMm);
  if (figures.every((n) => roundMm(n))) return figures;
  return null;
}

/** A Y's or a BTO's sizes, mm: the one in and the ones out — Airloc's
    "Y 14-10-10", "BTO 250.200.150", Reece's "300 X 250 X 200 BTO", J&Z's
    "Bto 12- 8- 8- 8" and "Bto 14101010", a combo's "18/20-14-14". */
export function fittingOf(name: string): { ins: number[]; outs: number[] } | null {
  const combo = /\b(\d{1,2})\s*\/\s*(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})\b/.exec(name);
  if (combo) {
    const ins = ductRun([Number(combo[1]), Number(combo[2])]);
    const outs = ductRun([Number(combo[3]), Number(combo[4])]);
    if (ins && outs && ins.every((n) => INCH_SIZES.has(n / 25))) return { ins, outs };
  }
  const run = RUN.exec(name);
  if (run) {
    const sizes = ductRun(run.slice(1).filter((v): v is string => v !== undefined).map(Number));
    if (sizes) return { ins: [sizes[0]!], outs: sizes.slice(1) };
  }
  /* figures run together: "14101010" is 14, 10, 10, 10 */
  const joined = /\b(\d{6}|\d{8})\b/.exec(name);
  if (joined) {
    const figures = joined[1]!.match(/\d\d/g)!.map(Number);
    const sizes = figures.every((n) => INCH_SIZES.has(n)) ? figures.map(inchMm) : null;
    if (sizes) return { ins: [sizes[0]!], outs: sizes.slice(1) };
  }
  return null;
}

/** Spigots, mm, each one: Actron's "3/350 SPIG" and "1/40+2/35 SPIG" (a
    figure under 100 is in centimetres), "W/2X350", "+ 2 X 350 SPIGOT",
    "2 X 14\" SPIGOT", "BOX 2 X 350MM". A plenum's face is never a spigot. */
export function spigotsOf(name: string): number[] | null {
  const s = name.toUpperCase();
  const out: number[] = [];
  for (const m of s.matchAll(/(?:^|[\s+])(\d)\s*\/\s*(\d{2,3})(?=\s*(?:\+|SPIG|$))/g)) {
    const n = Number(m[1]);
    const raw = Number(m[2]);
    const mm = raw < 100 ? raw * 10 : raw;
    if (n < 1 || !roundMm(mm)) return null;
    for (let i = 0; i < n; i++) out.push(mm);
  }
  if (out.length > 0) return out;
  const each =
    /(?:W\/|\+|WITH|BOX)\s*(\d)\s*[X×]\s*(\d{1,3})\s*("|MM)?/.exec(s) ?? /(?:^|\s|-)(\d)\s*[X×]\s*(\d{1,3})\s*("|MM)?\s*SPIG/.exec(s) ?? /(?:^|\s)(\d)\s*[X×]\s*(\d{1,2})\s*(")/.exec(s);
  if (!each) return null;
  const n = Number(each[1]);
  const raw = Number(each[2]);
  const mm = each[3] === '"' || INCH_SIZES.has(raw) ? inchMm(raw) : raw;
  if (n < 1 || n > 8 || !roundMm(mm)) return null;
  return Array.from({ length: n }, () => mm);
}

/** An isolator's rating and poles: "20A", "35 AMPS", "2P", "3 POLE", "DOUBLE POLE". */
export function isolatorOf(name: string): { amps: number; poles: number | null } | null {
  const amps = /(\d{2,3})\s*(?:A|AMPS?)\b/i.exec(name);
  if (!amps) return null;
  const words: Record<string, number> = { SINGLE: 1, DOUBLE: 2, TRIPLE: 3 };
  const pole = /(\d)\s*(?:P|POLES?)\b/i.exec(name) ?? /\b(SINGLE|DOUBLE|TRIPLE)\s*POLE\b/i.exec(name);
  const poles = pole ? (words[pole[1]!.toUpperCase()] ?? Number(pole[1])) : null;
  return { amps: Number(amps[1]), poles };
}

/** What a wall bracket holds: "180KG", "100KG 450MM". */
export function bracketOf(name: string): { kg: number } | null {
  const kg = /(\d{2,3})\s*KG\b/i.exec(name);
  return kg ? { kg: Number(kg[1]) } : null;
}

/** The length one is sold in, m: "250MM X 6M", "16\" 3M". */
export function soldLengthOf(name: string): number | null {
  const m = /(?:^|[\s x×X])(\d+(?:\.\d+)?)\s*M\b(?!M)/.exec(name.replace(/\(EA\)/gi, " "));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 30 ? n : null;
}

/* ── the kinds ── */

type Kind = {
  /** what a range of it is called */
  label: string;
  /** the same, inside a sentence */
  noun: string;
  /** what it's sized by */
  by: string;
  /** every pattern must match an item's name for it to be offered */
  match: readonly RegExp[];
  not?: readonly RegExp[];
  sizeOf: (name: string) => RangeSize | null;
};

const round = (name: string): RangeSize | null => {
  const mm = diameterOf(name);
  return mm == null ? null : { mm };
};

export const RANGE_KINDS: Record<RangeKind, Kind> = {
  isolator: {
    label: "Isolators",
    noun: "isolators",
    by: "by amps",
    match: [/isolator/i],
    not: [/bracket|lock\s*off|mount|vib|pad|box|plate|stand/i],
    sizeOf: (n) => isolatorOf(n),
  },
  wall_bracket: {
    label: "Wall brackets",
    noun: "wall brackets",
    by: "by what they hold",
    match: [/wall\s*bracket/i],
    sizeOf: (n) => bracketOf(n),
  },
  zone_damper: {
    label: "Zone dampers",
    noun: "zone dampers",
    by: "by Ø",
    match: [/damper/i],
    not: [/non[-\s]?return|back\s*draft|fire|volume\s*control|manual|adaptor|controller|damper\s+motor/i],
    sizeOf: round,
  },
  flex_duct: {
    label: "Flexible duct",
    noun: "flexible duct",
    by: "by Ø",
    match: [/flex/i, /duct/i],
    not: [/strap|saddle|joint|hanging|tape|clamp|connector|cuff|fan\s*ducting/i],
    sizeOf: (n) => {
      const mm = diameterOf(n);
      return mm == null ? null : { mm, lengthM: soldLengthOf(n) };
    },
  },
  round_diffuser: {
    label: "Round diffusers",
    noun: "round diffusers",
    by: "by neck",
    match: [/diffuser/i],
    not: [/square|slot|linear|swirl|plenum|bar|mdo|return|4\s*way/i],
    sizeOf: round,
  },
  square_diffuser: {
    label: "Square diffusers",
    noun: "square diffusers",
    by: "by neck",
    match: [/diffuser/i, /square|4\s*way/i],
    not: [/plenum|return|slot|linear/i],
    sizeOf: (n) => {
      const mm = neckOf(n);
      return mm == null ? null : { mm };
    },
  },
  mdo: {
    label: "MDOs",
    noun: "MDOs",
    by: "by neck",
    match: [/\bmdo\b|multi[-\s]?directional/i],
    sizeOf: (n) => {
      const mm = neckOf(n);
      return mm == null ? null : { mm };
    },
  },
  bar_grille: {
    label: "Bar grilles",
    noun: "bar grilles",
    by: "by length and height",
    match: [/bar\s*grille/i],
    not: [/return/i],
    sizeOf: (n) => faceOf(n),
  },
  slot_diffuser: {
    label: "Slot diffusers",
    noun: "slot diffusers",
    by: "by length",
    match: [/slot|linear/i],
    not: [/return/i],
    sizeOf: (n) => faceOf(n),
  },
  return_grille: {
    label: "Return grilles",
    noun: "return grilles",
    by: "by size",
    match: [/return|r\/a\b|eggcrate/i, /grille|grill|box|eggcrate/i],
    not: [/plenum|damper|bar\s*grille/i],
    sizeOf: (n) => {
      const face = faceOf(n);
      if (!face) return null;
      const spigots = spigotsOf(n.replace(/(\d{2,4})\s*(?:mm)?\s*[xX×]\s*(\d{2,4})/, " "));
      return spigots ? { ...face, spigots } : face;
    },
  },
  fitting: {
    label: "Ys and BTOs",
    noun: "Ys and BTOs",
    by: "by their sizes",
    match: [/\bbto\b|branch\s*take|\by\s*(?:piece|branch|junction)\b|\by\s+\d/i],
    sizeOf: (n) => fittingOf(n),
  },
  plenum: {
    label: "Supply plenums",
    noun: "supply plenums",
    by: "by their spigots",
    match: [/plenum/i],
    not: [/r\/a|r\/air|return|swirl|diffuser|nose|adaptor/i],
    sizeOf: (n) => {
      const spigots = spigotsOf(n);
      return spigots ? { spigots } : null;
    },
  },
};

export const RANGE_KEYS = Object.keys(RANGE_KINDS) as RangeKind[];

export const isRangeKind = (v: unknown): v is RangeKind => typeof v === "string" && (RANGE_KEYS as string[]).includes(v);

/** Whether an item's name is one a range of this kind is made from. */
export function inKind(kind: RangeKind, name: string): boolean {
  const k = RANGE_KINDS[kind];
  return k.match.every((re) => re.test(name)) && !(k.not ?? []).some((re) => re.test(name));
}

/** A size as a page sent it, kept only as far as its kind has one and
    every figure is a sane one; null when what the kind needs isn't there. */
export function cleanSize(kind: RangeKind, raw: unknown): RangeSize | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  const mmOk = (v: unknown) => (typeof v === "number" && roundMm(v) ? v : null);
  const mmList = (v: unknown, lo: number, hi: number) => {
    const list = Array.isArray(v) ? v.map(mmOk) : [];
    return list.length >= lo && list.length <= hi && list.every((n): n is number => n !== null) ? list : null;
  };
  switch (kind) {
    case "isolator": {
      const amps = num(r.amps, 1, 400);
      const poles = num(r.poles, 1, 4);
      return amps == null ? null : { amps, poles };
    }
    case "wall_bracket": {
      const kg = num(r.kg, 10, 1000);
      return kg == null ? null : { kg, maxWidthMm: num(r.maxWidthMm, 200, 3000) };
    }
    case "flex_duct": {
      const mm = mmOk(r.mm);
      return mm == null ? null : { mm, lengthM: num(r.lengthM, 0.5, 30) };
    }
    case "bar_grille":
    case "slot_diffuser":
    case "return_grille": {
      const w = num(r.w, 50, 4000);
      const h = num(r.h, 20, 4000);
      if (w == null || h == null) return null;
      const spigots = kind === "return_grille" && r.spigots != null ? mmList(r.spigots, 1, 8) : null;
      return spigots ? { w, h, spigots } : { w, h };
    }
    case "fitting": {
      const ins = mmList(r.ins, 1, 2);
      const outs = mmList(r.outs, 1, 4);
      return ins && outs ? { ins, outs } : null;
    }
    case "plenum": {
      const spigots = mmList(r.spigots, 1, 8);
      return spigots ? { spigots } : null;
    }
    default: {
      const mm = mmOk(r.mm);
      return mm == null ? null : { mm };
    }
  }
}

/* ── saying a size ── */

const mmWords = (sizes: number[]) => {
  const counts = new Map<number, number>();
  for (const s of sizes) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[0] - a[0])
    .map(([s, n]) => (n > 1 ? `${n} × Ø${s}` : `Ø${s}`))
    .join(" + ");
};

/** A size in a few words: "Ø250", "20 A, 2 pole", "180 kg", "1200 × 150",
    "Ø350 → Ø250 / Ø250", "2 × Ø350". */
export function sizeWords(kind: RangeKind, s: RangeSize): string {
  switch (kind) {
    case "isolator":
      return `${s.amps} A${s.poles ? `, ${s.poles} pole` : ""}`;
    case "wall_bracket":
      return `${s.kg} kg${s.maxWidthMm ? `, outdoors up to ${s.maxWidthMm} mm wide` : ""}`;
    case "flex_duct":
      return `Ø${s.mm}${s.lengthM ? `, ${s.lengthM} m` : ""}`;
    case "bar_grille":
    case "slot_diffuser":
      return s.h ? `${s.w} × ${s.h}` : `${s.w} long`;
    case "return_grille":
      return s.w ? `${s.w} × ${s.h}${s.spigots?.length ? `, ${mmWords(s.spigots)}` : ""}` : s.mm ? `Ø${s.mm} spigot` : "";
    case "fitting":
      return `${(s.ins ?? []).map((n) => `Ø${n}`).join(" or ")} → ${(s.outs ?? []).map((n) => `Ø${n}`).join(" / ")}`;
    case "plenum":
      return mmWords(s.spigots ?? []);
    default:
      return s.mm ? `Ø${s.mm}` : "";
  }
}

/* ── which size a line takes ── */

const sameSizes = (a: readonly number[] = [], b: readonly number[] = []) =>
  a.length === b.length && [...a].sort((x, y) => x - y).every((n, i) => n === [...b].sort((x, y) => x - y)[i]);
const near = (a: number | undefined, b: number | undefined) => a != null && b != null && Math.abs(a - b) <= 10;

/** How well an item's size answers a line's need: lower is better, null
    when it doesn't. An isolator rated at or over the outdoor's current, on
    its supply when the name gives poles; a bracket that holds the
    outdoor's weight and takes its width; a round size exactly; a face
    within 10 mm, either way round for a return; a fitting's and a
    plenum's sizes exactly. */
export function fitOf(kind: RangeKind, s: RangeSize, need: RangeNeed): number | null {
  switch (kind) {
    case "isolator": {
      if (s.amps == null || need.amps == null || s.amps < need.amps) return null;
      if (need.phase === "3" && s.poles != null && s.poles < 3) return null;
      if (need.phase === "1" && s.poles != null && s.poles > 2) return null;
      return s.amps;
    }
    case "wall_bracket": {
      if (s.kg == null || (need.kg != null && s.kg < need.kg)) return null;
      if (s.maxWidthMm != null && need.w != null && s.maxWidthMm < need.w) return null;
      return s.kg;
    }
    case "bar_grille":
    case "slot_diffuser":
      return near(s.w, need.w) && (need.h == null || near(s.h, need.h)) ? Math.abs(s.w! - need.w!) + Math.abs((s.h ?? 0) - (need.h ?? s.h ?? 0)) : null;
    case "return_grille": {
      if (need.mm != null) return s.spigots?.length === 1 && s.spigots[0] === need.mm ? 0 : null;
      if (near(s.w, need.w) && near(s.h, need.h)) return Math.abs(s.w! - need.w!) + Math.abs(s.h! - need.h!);
      if (near(s.w, need.h) && near(s.h, need.w)) return Math.abs(s.w! - need.h!) + Math.abs(s.h! - need.w!) + 1;
      return null;
    }
    case "fitting":
      return need.ins?.length && (s.ins ?? []).includes(need.ins[0]!) && sameSizes(s.outs, need.outs) ? 0 : null;
    case "plenum":
      return sameSizes(s.spigots, need.spigots) ? 0 : null;
    default:
      return s.mm != null && s.mm === need.mm ? 0 : null;
  }
}

/** The item a line takes from a range: the one that answers its need
    best, then the cheaper. */
export function pickFromRange<T extends { size: RangeSize; perUnitCents: number }>(kind: RangeKind, items: readonly T[], need: RangeNeed): T | null {
  let best: { item: T; fit: number } | null = null;
  for (const item of items) {
    const fit = fitOf(kind, item.size, need);
    if (fit == null) continue;
    if (!best || fit < best.fit || (fit === best.fit && item.perUnitCents < best.item.perUnitCents)) best = { item, fit };
  }
  return best?.item ?? null;
}

/* ── a range proposed from one item ── */

/** The words of a name that make it the product line it is, without its sizes. */
const lineWords = (name: string) => new Set(familyWords(name).map((w) => w.toUpperCase()));

/** The product line an item is in, in a few words ("Airloc smartfit Y ins"). */
export const lineLabel = (name: string) => familyLabel(familyWords(name));

/** Whether two items are one product line: the same supplier, and one's
    words all in the other's, sizes aside — Airloc's "Y 14-10-10 INS" and
    "Y 14-12-12 INS KEY" are one line, AAD's manual and zone dampers aren't. */
export function sameLine(a: { supplierKey: string; name: string }, b: { supplierKey: string; name: string }): boolean {
  if (a.supplierKey !== b.supplierKey) return false;
  const x = lineWords(a.name);
  const y = lineWords(b.name);
  if (x.size === 0 || y.size === 0) return false;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return [...small].every((w) => big.has(w));
}

/* ── what a kit line needs ── */

/** What a kit says an outdoor's isolator is for: its current and supply,
    "for the outdoor's 28 A on single phase, ". Read back by rangeNeedOf. */
export function forTheOutdoorsCurrent(amps: number | null, phase: "1" | "3" | null): string {
  if (amps == null) return "";
  return `for the outdoor's ${amps} A${phase ? ` on ${phase === "3" ? "three" : "single"} phase` : ""}, `;
}

/** What a kit says an outdoor's mount is for: "for the outdoor's 840 mm, 53 kg, ". */
export function forTheOutdoorsSize(widthMm: number | null, weightKg: number | null): string {
  const size = [widthMm != null ? `${widthMm} mm` : null, weightKg != null ? `${weightKg} kg` : null].filter(Boolean).join(", ");
  return size ? `for the outdoor's ${size}, ` : "";
}

const allMm = (text: string) => [...text.matchAll(/[Øø⌀]\s*(\d{2,3})\b/g)].map((m) => Number(m[1]));

/** The range a line is priced from and the size it needs — a kit's line
    ("Isolator" for the outdoor's 28 A on single phase, "Zone damper Ø250",
    "Fitting Ø350 → Ø300 / Ø250", "Plenum, spigots Ø250 / Ø250") or one a
    person typed or Studio pushed ("Isolator, 3Ø 32 A"). The need is null
    when the line doesn't give its size; null altogether when the line
    isn't one a range prices. */
export function rangeNeedOf(row: { name: string; sub: string }): { kind: RangeKind; need: RangeNeed | null } | null {
  const name = row.name.trim();
  const text = `${name} ${row.sub}`;
  if (/^isolator\b/i.test(name)) {
    const own = /(\d+(?:\.\d+)?)\s*A\b/.exec(name.replace(/^isolator\b/i, ""));
    const draw = /for the outdoor's (\d+(?:\.\d+)?) A\b/.exec(row.sub);
    const amps = own ? Number(own[1]) : draw ? Number(draw[1]) : null;
    const phase = /\bthree phase\b|\b3\s*Ø|\b3\s*phase\b/i.test(text) ? "3" : /\bsingle phase\b|\b1\s*Ø|\b1\s*phase\b/i.test(text) ? "1" : null;
    return { kind: "isolator", need: amps == null ? null : { amps, phase } };
  }
  if (/^wall bracket\b/i.test(name)) {
    const w = /(\d{3,4})\s*mm\b/.exec(row.sub);
    const kg = /(\d+(?:\.\d+)?)\s*kg\b/.exec(row.sub);
    return { kind: "wall_bracket", need: w || kg ? { ...(w ? { w: Number(w[1]) } : {}), ...(kg ? { kg: Number(kg[1]) } : {}) } : null };
  }
  const byDiameter = (kind: RangeKind) => {
    const mm = diameterOf(name);
    return { kind, need: mm == null ? null : { mm } };
  };
  if (/^zone damper\b/i.test(name)) return byDiameter("zone_damper");
  if (/^(trunk|flex(ible)?(\s*duct)?)\b/i.test(name)) return byDiameter("flex_duct");
  if (/^round diffuser\b/i.test(name)) return byDiameter("round_diffuser");
  if (/^square diffuser\b/i.test(name)) return byDiameter("square_diffuser");
  if (/^mdo\b/i.test(name)) return byDiameter("mdo");
  const face = (kind: RangeKind) => {
    const f = faceOf(name);
    const long = /(\d{3,4})\s*long\b/.exec(name);
    return { kind, need: f ? { w: f.w, h: f.h } : long ? { w: Number(long[1]) } : null };
  };
  if (/^bar grille\b/i.test(name)) return face("bar_grille");
  if (/^slot diffuser\b/i.test(name)) return face("slot_diffuser");
  if (/^return grille\b/i.test(name)) {
    const f = faceOf(name);
    const spigot = /[Øø⌀]\s*(\d{2,3})\s*spigot/i.exec(name);
    return { kind: "return_grille", need: f ? { w: f.w, h: f.h } : spigot ? { mm: Number(spigot[1]) } : null };
  }
  if (/^fitting\b/i.test(name)) {
    const [into, out = ""] = name.split("→");
    const ins = allMm(into ?? "");
    const outs = allMm(out);
    return { kind: "fitting", need: ins.length === 1 && outs.length > 0 ? { ins, outs } : null };
  }
  if (/^plenum\b/i.test(name)) {
    const spigots = allMm(name);
    return { kind: "plenum", need: spigots.length > 0 ? { spigots } : null };
  }
  return null;
}

/** What a line needs, in a few words, for saying none of a range fits it. */
export function needWords(kind: RangeKind, need: RangeNeed): string {
  if (kind === "isolator") return `${need.amps} A${need.phase ? ` on ${need.phase === "3" ? "three" : "single"} phase` : ""}`;
  if (kind === "wall_bracket") return [need.kg != null ? `${need.kg} kg` : null, need.w != null ? `${need.w} mm wide` : null].filter(Boolean).join(", ");
  return sizeWords(kind, need);
}
