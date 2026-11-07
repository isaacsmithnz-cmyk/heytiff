/* ONE PART, MANY SUPPLIERS — the price book's product layer.

   The same code at two suppliers is already one item. But the same part is
   usually sold under each supplier's own code: AAD's PC1412 "PAIRED COIL
   1/4+1/2X20M" is Reece's 9800006-1 "ARDENT PR CU 1/4 X 1/2 R410A 20M". So
   Tiff proposes the pairs that look like one part, and a person confirms
   them or says they aren't (either answer is kept, so nothing is proposed
   twice). Confirmed pairs join into one product, priced at every supplier.

   Three ways a pair is proposed:
   - MENTIONED: one supplier's code is written in the other's name (Reece's
     "ASPEN MINI TANK PUMP 35LTR/HR FP1056" is AAD's FP1056).
   - SAME MODEL: one supplier's code is the other's with a maker's suffix
     after it (a wholesaler's PUZ-ZM140YKA2 is the maker's
     PUZ-ZM140YKA2-A.TH), any brand, any supplier.
   - SAME SIZE: the same kind of part (pair coil, duct tape, isolator…) with
     every size both names give the same — the pipe sizes, the length, the
     amps, the poles, a cable's cores, the colour — and at least two of them.

   A kit or set is never the same part as a single one, nor a fire-rated
   part the same as a standard one, nor a unit's indoor head the same as the
   whole system a wholesaler names by the head's code (Isaac, 2026-10-05:
   AAD's FUJITSU LIFESTYLE R/C HWS IND 2.5KW, $222, against Reece's
   FUJITSU WALL MOUNTED AC ASTG09KMTC 2.5KW, the whole system at $852).
   Pure: the page, the searches and the tests all read this. */

import { unitPartOf } from "./brands";

export type SameItem = { supplierKey: string; code: string; name: string };

export type SameDecision = "confirmed" | "rejected";

/** "supplier|code": one supplier's item. */
export const refOf = (i: { supplierKey: string; code: string }) => `${i.supplierKey}|${i.code}`;

/* One supplier's pack sizes of a part are one item already: Reece's
   9502294-1 is the 50 m coil and 9502294-2 the same hose by the metre. Only
   a single-digit suffix: Ideal Air's SHSD595-350 and -250 are two sizes. */
const baseCode = (code: string) => code.replace(/-\d$/, "");
const baseRefOf = (i: { supplierKey: string; code: string }) => `${i.supplierKey}|${baseCode(i.code)}`;

/** The key a decision on two items is kept under: pack sizes set aside, so
    a "not the same" on the coil holds for the same hose by the metre. */
export const decidedKey = (aRef: string, bRef: string) => pairKey(aRef.replace(/-\d$/, ""), bRef.replace(/-\d$/, ""));

/** A pair's key, the same whichever way round it's given. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}#${b}` : `${b}#${a}`;
}

export type SameProposal = {
  a: SameItem;
  b: SameItem;
  why: "mentioned" | "model" | "size";
  /** the sizes both names give, in a few words ("1/4, 1/2, 20 m"); a
      mentioned or same-model pair's code */
  shared: string[];
};

/* The kinds of part a size match is allowed between. A name that is none
   of these is only ever matched by a mentioned code. */
const KINDS: { kind: string; test: RegExp }[] = [
  { kind: "pair coil", test: /pair(ed)?\s*-?\s*coil|paircoil|\bPR\s+CU\b/i },
  { kind: "copper coil", test: /\b(ANN(EALED)?|SOFT)\b.*\b(REF|CU|COPPER)\b|\bCOPPER\s+COIL\b/i },
  { kind: "duct tape", test: /duct\s*tape/i },
  { kind: "isolator", test: /isolator/i },
  { kind: "condensate pump", test: /condensate\s*pump|tank\s*pump/i },
  { kind: "drain hose", test: /drain\s*hose/i },
  { kind: "trunking", test: /trunking|pipe\s*cover|slim\s*duct|line\s*hide|duct\s*cover/i },
  { kind: "wall bracket", test: /wall\s*bracket/i },
  { kind: "flexible duct", test: /flex(ible)?\s*duct/i },
  { kind: "cable", test: /\bcable\b|\bTPS\b|core\s*&?\s*earth/i },
  { kind: "diffuser", test: /diffuser/i },
  { kind: "return grille", test: /return\s*(air)?\s*grille|r\/air\s*grille/i },
  { kind: "zone motor", test: /zone\s*motor|damper\s*motor|motori[sz]ed\s*damper/i },
  { kind: "rubber feet", test: /rubber\s*feet|condenser\s*feet|anti.?vib|vibration\s*mount/i },
];

/* A cable's fittings, its ties, clips, glands and the like, are parts of
   their own, each its own kind, never the cable (Isaac's walk, 27 October
   2026: 2.5 mm flex cable was proposed as 2.5 mm cable ties). */
const CABLE_FITTING = /\bcable\s*(ties?|clips?|glands?|lugs?|saddles?|clamps?|trays?|markers?|joiners?|staples?|sleeves?)\b/i;

/* Within a kind, what makes two of them different parts whatever sizes
   they share: a cable for data, a shielded or screened one, flexible cord
   and circular cable are never flat power cable, nor each other (the same
   walk: a shielded pair proposed as twin and earth). */
const APART: Record<string, RegExp[]> = {
  cable: [/\bcat\s*-?\s*[3-8]a?e?\b|\b[uf]\/?utp\b|\bstp\b|\bdata\b|\brj\s*-?\s*45\b|\bcoax/i, /(?<!un)(shield|screen)/i, /\bflex(ible)?\b/i, /\bcirc(ular)?\b/i],
};
const apart = (kind: string, a: string, b: string) => (APART[kind] ?? []).some((re) => re.test(a) !== re.test(b));

/* the parts that are never one with a plain one */
const FLAGS: { flag: string; test: RegExp }[] = [
  { flag: "kit", test: /\b(KIT|SET)\b/i },
  { flag: "fire rated", test: /\bFR\b|fire/i },
];

const PLAIN_COLOURS = /\b(BLACK|WHITE|GREY|GRAY|SILVER|BEIGE|CREAM|ORANGE|BLUE|GREEN|RED)\b/i;

type Sizes = Map<string, Set<string>>;

const num = (s: string) => String(Number(s));

/** The sizes a name gives, by what they measure. */
export function sizesOf(name: string): Sizes {
  const n = name.toUpperCase().replace(/"/g, " ");
  const out: Sizes = new Map();
  const add = (k: string, v: string) => out.set(k, new Set([...(out.get(k) ?? []), v]));
  for (const m of n.matchAll(/(?<![\d/.])(\d{1,2}\/\d{1,2})(?![\d/]|\s*MM\b)/g)) add("inch", m[1]!);
  for (const m of n.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:M(?![M²A-Z0-9])|MT\b|MTRS?\b|METRES?\b|METERS?\b)/g)) add("m", num(m[1]!));
  /* a range, "16-18mm" or "(16/18MM)", is both of its ends */
  for (const m of n.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*[-/]\s*(?=\d+(?:\.\d+)?\s*MM\b)/g)) add("mm", num(m[1]!));
  for (const m of n.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*MM\b/g)) add("mm", num(m[1]!));
  for (const m of n.matchAll(/(?<![\d.])(\d+)\s*(?:A|AMPS?)\b/g)) add("amps", m[1]!);
  for (const m of n.matchAll(/(?<![\d.])(\d)\s*-?\s*POLE\b|\b(SINGLE|DOUBLE|TRIPLE)\s*-?\s*POLE\b/g)) {
    add("poles", m[1] ?? { SINGLE: "1", DOUBLE: "2", TRIPLE: "3" }[m[2]!]!);
  }
  for (const m of n.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*KW\b/g)) add("kW", num(m[1]!));
  for (const m of n.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:L|LT|LTR|LITRE)S?\s*\/\s*(?:HR|H)\b/g)) add("L/hr", num(m[1]!));
  for (const m of n.matchAll(/(?<![\d.])(\d{2,4})\s*X\s*(\d{2,4})(?![\d.])/g)) add("dims", `${m[1]}x${m[2]}`);
  /* a cable's cores: three core and earth is never twin and earth, nor a pair */
  for (const m of n.matchAll(/(?<![\d.])(\d)\s*C(?:ORES?)?\s*(?:\+|&|AND)\s*E(?:ARTH)?(?![A-Z])/g)) add("cores", `${m[1]}C+E`);
  if (/\bTWIN\s*(?:&|AND)\s*EARTH\b/.test(n)) add("cores", "2C+E");
  for (const m of n.matchAll(/(?<![\d.])(\d)\s*CORES?\b(?!\s*(?:\+|&|AND)\s*E)/g)) add("cores", `${m[1]} core`);
  if (/\bSINGLE\s*-?\s*CORE\b/.test(n)) add("cores", "1 core");
  for (const m of n.matchAll(/(?<![\d./])(\d{1,2})\s*(?:PAIRS?|PR)\b(?!\s*CU)/g)) add("cores", `${m[1]} pair`);
  const colour = PLAIN_COLOURS.exec(n)?.[1];
  if (colour) add("colour", colour === "GRAY" ? "GREY" : colour);
  return out;
}

const kindOf = (name: string) => {
  const fitting = CABLE_FITTING.exec(name)?.[1];
  if (fitting) return `cable ${fitting.toLowerCase().replace(/s$/, "")}`;
  return KINDS.find((k) => k.test.test(name))?.kind ?? null;
};
const flagsOf = (name: string) => FLAGS.filter((f) => f.test.test(name)).map((f) => f.flag).join(",");

const UNIT_WORDS: Record<string, (v: string) => string> = {
  inch: (v) => v,
  m: (v) => `${v} m`,
  mm: (v) => `${v} mm`,
  amps: (v) => `${v} A`,
  poles: (v) => `${v} pole`,
  kW: (v) => `${v} kW`,
  "L/hr": (v) => `${v} L/hr`,
  dims: (v) => v.replace("x", " × "),
  cores: (v) => v,
  colour: (v) => v.charAt(0) + v.slice(1).toLowerCase(),
};

/** The sizes two names share, when every size both give agrees; null when
    one disagrees. */
function sharedSizes(a: Sizes, b: Sizes): string[] | null {
  const shared: string[] = [];
  for (const [k, av] of a) {
    const bv = b.get(k);
    if (!bv) continue;
    if (av.size !== bv.size || [...av].some((v) => !bv.has(v))) return null;
    shared.push(...[...av].map(UNIT_WORDS[k] ?? ((v: string) => v)));
  }
  return shared;
}

/* A code worth finding in another's name: letters and digits both, and
   long enough not to be a word or a size ("20A", "KIT" never are). */
const findableCode = (code: string) => code.length >= 5 && /[A-Z]/i.test(code) && /\d/.test(code);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The shorter codes a code would be without its maker's suffixes: a suffix
    is one or two characters starting with a letter, after a dash or a dot.
    PUZ-ZM140YKA2-A.TH: PUZ-ZM140YKA2-A, then PUZ-ZM140YKA2. Digits alone are
    a size or a pack, never a suffix (SHSD595-350 and -250 are two sizes). */
export function modelsWithoutSuffix(code: string): string[] {
  const out: string[] = [];
  let at = code.toUpperCase();
  for (let m = /^(.+)[-.][A-Z][A-Z0-9]?$/.exec(at); m && findableCode(m[1]!); m = /^(.+)[-.][A-Z][A-Z0-9]?$/.exec(at)) {
    at = m[1]!;
    out.push(at);
  }
  return out;
}

const tokensOf = (name: string) => {
  const t = new Set<string>();
  for (const w of name.toUpperCase().split(/[\s(),]+/)) {
    if (!w) continue;
    t.add(w);
    for (const part of w.split("/")) if (part) t.add(part);
  }
  return t;
};

/** How many proposals an item can be in: the best few, not every isolator
    against every isolator. */
const PER_ITEM = 2;

/** The pairs of items that look like one part at two suppliers, best
    first, leaving out any pair already decided and any that share a code
    (one item already). */
export function proposeSameItems(items: SameItem[], decided: Set<string>): SameProposal[] {
  const found = new Map<string, SameProposal & { score: number }>();
  const offer = (a: SameItem, b: SameItem, why: SameProposal["why"], shared: string[], score: number) => {
    if (a.supplierKey === b.supplierKey || a.code === b.code) return;
    if (flagsOf(a.name) !== flagsOf(b.name)) return;
    /* an indoor head, an outdoor unit and a whole system are three things */
    const pa = unitPartOf(a.name, a.code);
    const pb = unitPartOf(b.name, b.code);
    if (pa && pb && pa !== pb) return;
    const key = pairKey(baseRefOf(a), baseRefOf(b));
    if (decided.has(key)) return;
    const had = found.get(key);
    if (!had || had.score < score) found.set(key, { a: a.supplierKey < b.supplierKey ? a : b, b: a.supplierKey < b.supplierKey ? b : a, why, shared, score });
  };

  /* mentioned: a code written in another supplier's name */
  const byToken = new Map<string, SameItem[]>();
  for (const i of items) for (const t of tokensOf(i.name)) byToken.set(t, [...(byToken.get(t) ?? []), i]);
  for (const i of items) {
    if (!findableCode(i.code)) continue;
    for (const other of byToken.get(i.code.toUpperCase()) ?? []) {
      /* "Terminal Block (for PAR-41MAAM)" is an accessory OF it */
      if (new RegExp(`\\b(FOR|SUITS?|TO\\s+SUIT)\\s+\\(?${escapeRe(i.code)}`, "i").test(other.name)) continue;
      offer(i, other, "mentioned", [i.code], 10);
    }
  }

  /* same model: a code and the same code with a maker's suffix. A size both
     names give and disagree on says they aren't one */
  const byCode = new Map<string, SameItem[]>();
  for (const i of items) byCode.set(i.code.toUpperCase(), [...(byCode.get(i.code.toUpperCase()) ?? []), i]);
  for (const i of items) {
    for (const model of modelsWithoutSuffix(i.code)) {
      for (const other of byCode.get(model) ?? []) {
        if (sharedSizes(sizesOf(i.name), sizesOf(other.name))) offer(other, i, "model", [other.code], 9);
      }
    }
  }

  /* same size: within a kind, every size both give agreeing, two or more */
  const byKind = new Map<string, { item: SameItem; sizes: Sizes; words: Set<string> }[]>();
  for (const i of items) {
    const kind = kindOf(i.name);
    if (!kind) continue;
    byKind.set(kind, [...(byKind.get(kind) ?? []), { item: i, sizes: sizesOf(i.name), words: tokensOf(i.name) }]);
  }
  for (const [kind, list] of byKind) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const p = list[x]!;
        const q = list[y]!;
        if (p.item.supplierKey === q.item.supplierKey) continue;
        if (apart(kind, p.item.name, q.item.name)) continue;
        const shared = sharedSizes(p.sizes, q.sizes);
        if (!shared || shared.length < 2) continue;
        /* more sizes agreeing, then more words in common, ranks first */
        const common = [...p.words].filter((w) => q.words.has(w)).length;
        offer(p.item, q.item, "size", shared, shared.length + common / 100);
      }
    }
  }

  /* the best few for each item */
  const ranked = [...found.values()].sort((a, b) => b.score - a.score);
  const count = new Map<string, number>();
  const out: SameProposal[] = [];
  for (const p of ranked) {
    const ra = baseRefOf(p.a);
    const rb = baseRefOf(p.b);
    if ((count.get(ra) ?? 0) >= PER_ITEM || (count.get(rb) ?? 0) >= PER_ITEM) continue;
    count.set(ra, (count.get(ra) ?? 0) + 1);
    count.set(rb, (count.get(rb) ?? 0) + 1);
    out.push({ a: p.a, b: p.b, why: p.why, shared: p.shared });
  }
  return out;
}

/** Every "supplier|code" of the part `ref` is: the item itself, the same
    code at other suppliers, its pack sizes, and confirmed pairs through each
    other. */
export function sameProductRefs(items: { supplierKey: string; code: string }[], confirmed: [string, string][], ref: string): string[] {
  const keyOf = productsOf(items, confirmed);
  const key = keyOf.get(ref);
  if (key === undefined) return [ref];
  return [...keyOf.entries()].filter(([, k]) => k === key).map(([r]) => r);
}

/** Each item's product: items sharing a code, and confirmed pairs, joined
    through each other. The key is the smallest "supplier|code" in the
    product; an item that is its own product has none. */
export function productsOf(items: { supplierKey: string; code: string }[], confirmed: [string, string][]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (r: string): string => {
    let p = parent.get(r) ?? r;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(r, p);
    return p;
  };
  const join = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };
  const byCode = new Map<string, string>();
  const byBase = new Map<string, string>();
  for (const i of items) {
    const r = refOf(i);
    const first = byCode.get(i.code);
    if (first) join(first, r);
    else byCode.set(i.code, r);
    const base = byBase.get(baseRefOf(i));
    if (base) join(base, r);
    else byBase.set(baseRefOf(i), r);
  }
  for (const [a, b] of confirmed) join(a, b);
  const out = new Map<string, string>();
  const size = new Map<string, number>();
  const all = new Set([...items.map(refOf), ...confirmed.flat()]);
  for (const r of all) size.set(find(r), (size.get(find(r)) ?? 0) + 1);
  for (const r of all) if ((size.get(find(r)) ?? 0) > 1) out.set(r, find(r));
  return out;
}
