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
};

export type BookHit = {
  product: Product;
  /** why it ranks where it does, in a person's words */
  why: "Your preferred" | "On your quotes" | "Cheapest" | "In your book";
  /** the price it would be bought at: the preferred offer, else the cheapest */
  buyCents: number | null;
};

export const BOOK_LIMIT = 20;

export function findInBook(products: Product[], q: BookQuery): BookHit[] {
  const words = searchWords(q.text);
  const hits = products.filter(
    (p) =>
      (words.length === 0 || matchesWords(p, words)) &&
      (q.sizeMm == null || sizesOf(p.name).includes(q.sizeMm) || p.offers.some((o) => sizesOf(o.code).includes(q.sizeMm!))) &&
      (q.brand == null || (p.brand ?? "").toLowerCase() === q.brand.toLowerCase()) &&
      (q.category == null || p.category === q.category)
  );
  const price = (p: Product) => (p.preferred ?? p.cheapest)?.netCents ?? null;
  const ranked = [...hits].sort(
    (a, b) =>
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

export type Pick = { product: Product; offer: Offer; why: BookHit["why"] };

export function pickItem(products: Product[], q: BookQuery): Pick | null {
  for (const h of findInBook(products, { ...q, limit: BOOK_LIMIT })) {
    const offer = h.product.preferred ?? h.product.cheapest;
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
