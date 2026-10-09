import type { DataPack } from "@/lib/studio/packs/schema";
import type { CategoryKey } from "./categories";
import { matchesWords, sizesOf, usesOf, type Product } from "./families";
import { sameUnit } from "./option-materials";
import { searchWords, type Offer } from "./price-book";

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
  return { plain, squashed: squash(plain) };
};

export function findInBook(products: Product[], q: BookQuery): BookHit[] {
  const words = searchWords(q.text);
  const fits = (p: Product) =>
    (q.sizeMm == null || sizesOf(p.name).includes(q.sizeMm) || p.offers.some((o) => sizesOf(o.code).includes(q.sizeMm!))) &&
    (q.brand == null || (p.brand ?? "").toLowerCase() === q.brand.toLowerCase()) &&
    (q.category == null || p.category === q.category);
  let hits = products.filter((p) => (words.length === 0 || matchesWords(p, words)) && fits(p));
  /* nothing as typed: every word, as a supplier might write it */
  if (hits.length === 0 && words.length > 0) hits = products.filter((p) => fits(p) && words.every((w) => carries(hayOf(p), w)));
  /* still nothing, for a person's search: the items with most of the words */
  let matched = new Map<Product, number>();
  if (hits.length === 0 && q.loose) {
    const content = words.filter((w) => w.length >= 3 && !STOP.has(w));
    const need = Math.max(1, Math.ceil(content.length / 2));
    for (const p of products) {
      if (!fits(p)) continue;
      const hay = hayOf(p);
      const n = content.filter((w) => carries(hay, w)).length;
      if (n >= need) matched.set(p, n);
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
  /** the pipe it connects with, mm */
  pipeMm: { liquid: number; gas: number } | null;
};

export type UnitLookup = { found: true; specs: UnitSpecs; pack: string } | { found: false; reason: "no data pack" | "not in the pack" };

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A model's specs from the pack for its brand; `packs` keyed by brand. */
export function unitSpecs(packs: Record<string, DataPack | null | undefined>, brand: string, model: string): UnitLookup {
  const pack = packs[brand.toLowerCase()];
  if (!pack) return { found: false, reason: "no data pack" };
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
    },
  };
}
