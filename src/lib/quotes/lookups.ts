import { hasFactorySpigots, spigotDiametersMm, type DataPack } from "@/lib/studio/packs/schema";
import type { CategoryKey } from "./categories";
import { matchesWords, sizesOf, usesOf, type Product } from "./families";
import { searchWords, type Offer } from "./price-book";
import { fuzzyWord, nearestIn, wordsOf } from "./fuzzy";
import { sameUnitKey } from "./code-links";
import { brandOf, unitPartOf } from "./brands";

/* WHAT A QUOTE LOOKS THINGS UP IN (the engine rebuild, slice 1.1) — the
   business's own book, and the shared data packs for what a unit is.

   THE BOOK, ranked the way the business buys: its preferred item first,
   then what's on the most of its quotes, then the cheapest. A search is
   words in the code or the name, and can ask for a size (250 mm flex), a
   maker or a shelf. Each hit says why it's where it is, so Tiff and the
   person picking can both say it.

   A UNIT'S SPECS come from the maker's data pack only (never the internet:
   feedback, 2026-09). A brand with no pack says so, rather than a guess. A
   price is never in a pack: prices are the book's.

   Pure: the quote by hand, Select preferred item and Tiff's tools all read
   the same answer. */

export type BookQuery = {
  text: string;
  /** a size in mm the item must come in: "VB250" and "250mm flex" are 250 */
  sizeMm?: number | null;
  brand?: string | null;
  category?: CategoryKey | null;
  limit?: number;
  /** when nothing has every word, the items with most of them (a person's
      or Tiff's search, not a kit's pick) */
  loose?: boolean;
};

export type BookHit = {
  product: Product;
  /** why it ranks where it does, in a person's words */
  why: "Your preferred" | "On your quotes" | "Cheapest" | "In your book";
  /** the price it would be bought at: the preferred offer, else the cheapest */
  buyCents: number | null;
};

export const BOOK_LIMIT = 20;

/* ── the words as suppliers write them ──
   A book's names are its suppliers' own: "TRUNK CAP 2.4M SHALE GREY", "DAI
   WIRED 7 DAY PROG CONTROL", "Wi-Fi", "Flat TPS 3C +E A/C" for interconnect.
   A search that wants every word as typed found none of them (the bench of
   8 October: 171 searches came back empty for parts the book has). So a
   word also matches with its punctuation gone ("wifi", "wi-fi"), by its
   stem ("trunking", "TRUNK"), and by the trade's own short
   forms. Universal words, no business's own. */
const SHORT_FORMS: Record<string, string[]> = {
  interconnect: ["3c+e", "4c+e", "3ce", "4ce", "intcon"],
  controller: ["control", "remote"],
  control: ["controller", "remote"],
  remote: ["controller", "control"],
  wifi: ["wlan", "wireless lan"],
  isolator: ["isol", "isolating"],
  bracket: ["brkt"],
  brackets: ["brkt", "bracket"],
  damper: ["damp"],
  motorised: ["mtr", "motor"],
  motorized: ["mtr", "motor"],
  condensate: ["cond"],
  feet: ["mount", "foot"],
  return: ["ret", "eggcrate"],
  grille: ["grill", "eggcrate"],
  grill: ["grille"],
  filter: ["filt"],
  filtered: ["filter", "filt"],
  diffuser: ["diff"],
  outdoor: ["o/u", "odu", "out"],
  indoor: ["i/u", "idu", "ind"],
  cable: ["cbl"],
  coil: ["pair coil", "copper"],
};
const STOP = new Set(["a", "an", "and", "the", "for", "of", "to", "with", "in", "on", "x"]);
const squash = (s: string) => s.replace(/[^a-z0-9+]/g, "");

/** Whether a product carries a word, as a supplier might write it. */
function carries(hay: { plain: string; squashed: string }, w: string): boolean {
  if (hay.plain.includes(w)) return true;
  const sw = squash(w);
  if (sw.length >= 2 && hay.squashed.includes(sw)) return true;
  /* its stem: "trunking" is TRUNK, "controller" CONTROL, but "interconnect" isn't INTERface */
  if (w.length >= 6 && hay.plain.includes(w.slice(0, Math.max(5, w.length - 3)))) return true;
  return (SHORT_FORMS[w] ?? []).some((f) => hay.plain.includes(f) || hay.squashed.includes(squash(f)));
}
/* its maker too: Mitsubishi's own names never say "Mitsubishi" */
const hayOf = (p: Product) => {
  const plain = `${p.brand ?? ""} ${p.offers.map((o) => `${o.code} ${o.name}`).join(" ")}`.toLowerCase();
  return { plain, squashed: squash(plain), words: wordsOf(plain) };
};

/* A UNIT'S kW AND ITS PART, AS ITS CODE SAYS THEM (bug 79, Luke, 24
   November 2026, on 3594: "Finding GAA??"). Tiff searched "Mitsubishi
   Electric ducted 14kW" and was told the book had only the PEA-M140HAA:
   its supplier names the PEA-M140GAA "DUCTED IND 13.5KW", and the maker's
   own list "Ducted Unit". A unit is the kW its model class says (M140 is
   14 kW) as well as the kW its name prints, and an indoor by its code. */
const KW = /^(\d+(?:\.\d+)?)kw$/;
/** A unit's kW: what each of its names prints, and its model class. */
function kwOf(p: Product): number[] {
  return p.offers.flatMap((o) => {
    const named = o.name.match(/(\d+(?:\.\d+)?)\s*kW\b/i);
    const cls = p.category === "units" ? o.code.match(/^[A-Z]+-[A-Z]*?(\d{2,3})(?!\d)/i) : null;
    return [...(named ? [Number(named[1])] : []), ...(cls ? [Number(cls[1]) / 10] : [])];
  });
}
/** Whether a unit is the kW or the part a word asks for. */
function unitIs(p: Product, w: string): boolean {
  const kw = KW.exec(w);
  if (kw) return kwOf(p).some((k) => Math.abs(k - Number(kw[1])) < 0.05);
  if (p.category === "units" && (w === "indoor" || w === "outdoor")) return p.offers.some((o) => unitPartOf(o.name, o.code) === w);
  return false;
}

/* THE MAKER ASKED FOR, AS THE BOOK NAMES IT (bug 79). Tiff names a maker
   as its data pack does ("mitsubishi-electric", 24 of her searches), or
   shortly ("Mitsubishi"); the book's products say "Mitsubishi Electric",
   and a search for exactly the one found nothing of the other. A maker
   the book doesn't know by name is found by its name in the item's. */
function brandFits(q: string): (p: Product) => boolean {
  const said = q.replace(/[-_]+/g, " ").trim();
  const maker = brandOf(said);
  if (maker) return (p) => p.brand === maker;
  const w = said.toLowerCase();
  return (p) => (p.brand ?? "").toLowerCase() === w || carries(hayOf(p), w);
}

export function findInBook(products: Product[], q: BookQuery): BookHit[] {
  /* "14 kW" is one word, 14kw */
  const words = searchWords(q.text.replace(/(\d+(?:\.\d+)?)\s*kw\b/gi, "$1kw"));
  const ofBrand = q.brand == null || !q.brand.trim() ? null : brandFits(q.brand);
  const fits = (p: Product) =>
    (q.sizeMm == null || sizesOf(p.name).includes(q.sizeMm) || p.offers.some((o) => sizesOf(o.code).includes(q.sizeMm!))) &&
    (ofBrand == null || ofBrand(p)) &&
    (q.category == null || p.category === q.category);
  /* a kW asked for is the unit's kW, whatever its name prints */
  const plainWords = words.filter((w) => !KW.test(w));
  const kws = words.filter((w) => KW.test(w));
  const kwFits = (p: Product) => kws.every((w) => unitIs(p, w) || matchesWords(p, [w]));
  let hits = products.filter((p) => (words.length === 0 || (matchesWords(p, plainWords) && kwFits(p))) && fits(p));
  /* nothing as typed: every word, as a supplier might write it */
  if (hits.length === 0 && words.length > 0) hits = products.filter((p) => fits(p) && words.every((w) => unitIs(p, w) || carries(hayOf(p), w)));
  /* still nothing, for a person's search or Tiff's: the items with most of
     the words, a word typed a letter out found by its nearest (fuzzy.ts),
     the nearest first */
  let matched = new Map<Product, number>();
  if (hits.length === 0 && q.loose) {
    const content = words.filter((w) => w.length >= 3 && !STOP.has(w));
    const need = Math.max(1, Math.ceil(content.length / 2));
    for (const p of products) {
      if (!fits(p)) continue;
      const hay = hayOf(p);
      let n = 0;
      let score = 0;
      for (const w of content) {
        const s = carries(hay, w) || unitIs(p, w) ? 1 : fuzzyWord(w) ? nearestIn(w, hay.words) : 0;
        if (s > 0) {
          n++;
          score += s;
        }
      }
      if (n >= need) matched.set(p, score);
    }
    hits = [...matched.keys()];
  } else matched = new Map();
  const price = (p: Product) => (p.preferred ?? p.cheapest)?.netCents ?? null;
  const ranked = [...hits].sort(
    (a, b) =>
      (matched.get(b) ?? 0) - (matched.get(a) ?? 0) ||
      (a.preferred ? 0 : 1) - (b.preferred ? 0 : 1) ||
      usesOf(b) - usesOf(a) ||
      (price(a) ?? Number.MAX_SAFE_INTEGER) - (price(b) ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name)
  );
  const cheapest = Math.min(...ranked.map((p) => price(p) ?? Number.MAX_SAFE_INTEGER));
  return ranked.slice(0, q.limit ?? BOOK_LIMIT).map((p) => ({
    product: p,
    why: p.preferred ? "Your preferred" : usesOf(p) > 0 ? "On your quotes" : price(p) === cheapest && price(p) != null ? "Cheapest" : "In your book",
    buyCents: price(p),
  }));
}

/* ── which item, which supplier (slice 3.2) ──
   Which item: the business's preferred, else the one on most of its
   quotes, else the cheapest after its supplier discounts (the book's
   ranking above). Which supplier: the business's own pick for that item,
   else the lowest price for that same item. */

export type Pick = { product: Product; offer: Offer; why: BookHit["why"] | "Your range" };

/** The job's supplier's offer of an item, its lowest pack where it has
    several; null when that supplier doesn't sell it. */
export function supplierOffer(p: Product, supplier: string): Offer | null {
  return p.offers.filter((o) => o.supplierKey === supplier && o.netCents > 0).sort((a, b) => a.netCents - b.netCents)[0] ?? null;
}

/** The offer an item is bought at: the job's supplier's where it sells it,
    else the business's preferred, else the lowest. */
export const offerFor = (p: Product, supplier: string | null = null): Offer | null => (supplier ? supplierOffer(p, supplier) : null) ?? p.preferred ?? p.cheapest;

export function pickItem(products: Product[], q: BookQuery, supplier: string | null = null): Pick | null {
  const hits = findInBook(products, { ...q, limit: BOOK_LIMIT });
  /* the job's supplier's items first, the book's ranking among them; an
     item it doesn't sell only when none of its own fits */
  const ordered = supplier ? [...hits.filter((h) => supplierOffer(h.product, supplier)), ...hits.filter((h) => !supplierOffer(h.product, supplier))] : hits;
  for (const h of ordered) {
    const offer = offerFor(h.product, supplier);
    if (offer) return { product: h.product, offer, why: h.why };
  }
  return null;
}

/* ── a unit, from its maker's data pack ── */

const norm = (m: string) => m.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** A model as written names a pack model when one starts with the other:
    "MSZ-AP25VGD2" and "MSZ-AP25VG". */
export const sameModel = (written: string, pack: string) => {
  const a = norm(written);
  const b = norm(pack);
  return a.length >= 6 && (a.startsWith(b) || b.startsWith(a));
};

/** A model's body, its maker's suffix (-A, -E, -E4, -L) taken off: the
    office writes PEFY-P25VMX-A where the data pack holds PEFY-P25VMX-E. */
const body = (m: string) => {
  let x = m.toUpperCase().trim();
  for (let y = x.replace(/-[A-Z0-9]{1,2}$/, ""); y !== x; y = x.replace(/-[A-Z0-9]{1,2}$/, "")) x = y;
  return norm(x);
};
/** The same unit, by its model or its body. */
export const sameUnit = (written: string, pack: string) => sameModel(written, pack) || (body(written).length >= 6 && body(written) === body(pack));

export type UnitSpecs = {
  role: "indoor" | "outdoor";
  model: string;
  coolKw: number | null;
  heatKw: number | null;
  /** width × depth × height, mm */
  sizeMm: [number, number, number] | null;
  weightKg: number | null;
  soundDba: { low: number | null; high: number | null };
  phase: string | null;
  /** the most it draws, and the circuit it needs, amps */
  maxAmps: number | null;
  mcaAmps: number | null;
  /** an outdoor's breaker and the smallest power cable its maker allows, as
      printed; null where the book prints none */
  breakerA?: number | null;
  minCableMm2?: number | null;
  /** the pipe it connects with, mm */
  pipeMm: { liquid: number; gas: number } | null;
  /** a ducted indoor's air faces, from its data book: what its supply and
      return plenums are made for; `returnSpigots` when its return takes
      duct straight on (no return plenum) */
  air?: { supply: { w: number; h: number } | null; ret: { w: number; h: number } | null; returnSpigots: boolean; returnSpigotsMm?: number[] };
  /** a ducted indoor's air, from its data book: its rated (high) airflow,
      L/s, and the external static pressure it's rated to push against, Pa.
      What the return, the outlets and the duct run are sized from (Isaac,
      2026-10-15: "Does she look at the liters per second of a ducted
      unit?" — the pack had it; she was never given it) */
  airflowLs?: number | null;
  staticPa?: number | null;
};

/** A data book's opening as a face, mm, when it gives one. */
const faceOfOpening = (o: unknown): { w: number; h: number } | null => {
  const r = o && typeof o === "object" ? (o as { w_mm?: unknown; h_mm?: unknown }) : null;
  return r && typeof r.w_mm === "number" && typeof r.h_mm === "number" ? { w: r.w_mm, h: r.h_mm } : null;
};

export type UnitLookup =
  | { found: true; specs: UnitSpecs; pack: string; /** the code asked for, read as the pack model a person linked it to */ linkedFrom?: string }
  | { found: false; reason: "no data pack" | "not in the pack" };

/** A pipe pair, mm. */
export type PipePair = { liquid: number; gas: number };

/** What a VRF or multi outdoor's runs may be, off its maker's pack: its
    system type, and every size its VRF pipe tables give a main, a run
    between joints, a branch or a branch box's head, and its multi rule's
    ports. Null where the pack hasn't the outdoor. The quote's pipe check
    (fit.ts) reads it, as a VRF's pipe is more than the outdoor's stubs
    (3608, 26 November 2026: the PUMY's 1/4 + 1/2 between joints and to its
    P20 heads was flagged against its 3/8 + 5/8). */
export function systemPipesOf(pack: DataPack, outdoorModel: string): { type: "split" | "multi" | "vrf"; sizes: PipePair[] } | null {
  const odu = pack.outdoor_units.find((u) => sameUnit(outdoorModel, u.model));
  if (!odu) return null;
  const sizes: PipePair[] = [];
  const add = (liquid: unknown, gas: unknown) => {
    const l = n(liquid);
    const g = n(gas);
    if (l != null && g != null && !sizes.some((s) => s.liquid === l && s.gas === g)) sizes.push({ liquid: l, gas: g });
  };
  const refs = [odu.pipe_table_ref, odu.branch_box_table_ref, odu.mixed_table_ref].filter((r): r is string => !!r);
  for (const t of pack.vrf_pipe_tables.filter((t) => refs.includes(t.series))) {
    for (const rule of [t.pipe_sizing, t.branch_sizing]) for (const s of rule?.steps ?? []) add(s.liquid_mm, s.gas_mm);
    for (const b of t.box_head_sizing ?? []) add(b.liquid_mm, b.gas_mm);
  }
  for (const m of pack.multi_rules.filter((m) => sameUnit(m.odu_model_ref, odu.model))) for (const port of m.port_pipe_sizes ?? []) add(port.liquid_mm, port.gas_mm);
  return { type: odu.system_type, sizes };
}

/** A business's pack link (code-links.ts), confirmed on the Quoting page:
    an order code and the pack model it is. */
export type ConfirmedLink = { model: string; code: string };

/** The pack model a code was linked to, whatever revision or region tag the
    code wears; null when nobody has linked it. */
export function linkedModel(links: readonly ConfirmedLink[], code: string): string | null {
  const key = sameUnitKey(code);
  return links.find((l) => sameUnitKey(l.code) === key)?.model ?? null;
}

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A model's specs from the pack for its brand; `packs` keyed by brand. An
    order code the pack doesn't name is read through the business's
    confirmed links (Isaac, 2026-10-16: the book's MSZ-AP35VGKD2-A2 is the
    pack's MSZ-AP35VGD2, linked on the Quoting page, and Tiff was told "not
    in the pack"). */
export function unitSpecs(packs: Record<string, DataPack | null | undefined>, brand: string, model: string, links: readonly ConfirmedLink[] = []): UnitLookup {
  const pack = packs[brand.toLowerCase()];
  if (!pack) return { found: false, reason: "no data pack" };
  const direct = specsIn(pack, brand, model);
  if (direct.found) return direct;
  const linked = linkedModel(links, model);
  const via = linked ? specsIn(pack, brand, linked) : null;
  return via?.found ? { ...via, linkedFrom: model } : direct;
}

function specsIn(pack: DataPack, brand: string, model: string): UnitLookup {
  const out = pack.outdoor_units.find((u) => sameUnit(model, u.model));
  if (out) {
    const w = n(out.width_mm);
    const d = n(out.depth_mm);
    const h = n(out.height_mm);
    return {
      found: true,
      pack: brand,
      specs: {
        role: "outdoor",
        model: out.model,
        coolKw: n(out.capacity_cool_kw),
        heatKw: n(out.capacity_heat_kw),
        sizeMm: w != null && d != null && h != null ? [w, d, h] : null,
        weightKg: n(out.weight_kg),
        soundDba: { low: n(out.sound_low_dba), high: n(out.sound_high_dba) },
        phase: out.phase ?? null,
        maxAmps: n(out.max_amps_a),
        mcaAmps: n(out.mca_a),
        breakerA: n(out.breaker_a),
        minCableMm2: n(out.min_cable_mm2),
        pipeMm: { liquid: out.conn_liquid_mm, gas: out.conn_gas_mm },
      },
    };
  }
  const ind = pack.indoor_units.find((u) => sameUnit(model, u.model));
  if (!ind) return { found: false, reason: "not in the pack" };
  return {
    found: true,
    pack: brand,
    specs: {
      role: "indoor",
      model: ind.model,
      coolKw: n(ind.capacity_cool_kw),
      heatKw: n(ind.capacity_heat_kw),
      sizeMm: [ind.width_mm, ind.depth_mm, ind.height_mm],
      weightKg: n(ind.weight_kg),
      soundDba: { low: n(ind.sound_low_dba), high: n(ind.sound_high_dba) },
      phase: ind.phase ?? null,
      maxAmps: n(ind.max_amps_a),
      mcaAmps: null,
      pipeMm: { liquid: ind.conn_liquid_mm, gas: ind.conn_gas_mm },
      ...(ind.supply_opening || ind.return_opening
        ? {
            air: {
              supply: faceOfOpening(ind.supply_opening),
              ret: faceOfOpening(ind.return_opening),
              returnSpigots: ind.return_opening === "built-in" || hasFactorySpigots(ind.return_opening),
              /* each return spigot's size, where its book prints them: a duct from each */
              ...(spigotDiametersMm(ind.return_opening).length ? { returnSpigotsMm: spigotDiametersMm(ind.return_opening) } : {}),
            },
          }
        : {}),
      ...(ind.airflow_ls != null || ind.static_pressure_pa != null ? { airflowLs: n(ind.airflow_ls), staticPa: n(ind.static_pressure_pa) } : {}),
    },
  };
}
