import { capacityOf, unitPartOf, unitTypeOf } from "./brands";
import type { Product } from "./families";
import { findInBook, offerFor } from "./lookups";
import type { Offer } from "./price-book";

/* COMPARE (slice 10.2, the mock-up of 8 October Isaac approved): a unit on
   the quote side by side with others from the business's own book. Each
   indoor comes with the outdoor that pairs with it: in the book, the same
   brand, type and size, and where several are, the one whose code shares
   most with the indoor's (FTXV71WVMA with RXV71WVMA, MSZ-AP80 with
   MUZ-AP80). Suggested: indoors of the same type within a quarter of its
   capacity. Asked for in the person's own words: a model, or a brand and a
   size, is found here with no call to Tiff; anything needing judgement goes
   to her. Pure. */

export type BookUnit = { name: string; code: string; supplierKey: string; costCents: number; brand: string | null };
export type Pair = { indoor: BookUnit; outdoor: BookUnit | null };

/** Within this share of the unit's capacity, either way, a unit is offered. */
export const CAPACITY_SPAN = 0.25;
export const MAX_SUGGESTED = 3;

const offerOf = (p: Product): Offer | null => p.preferred ?? p.cheapest;

/** An item as the job buys it: from its supplier where it sells it. */
export function bookUnit(p: Product, supplier: string | null = null): BookUnit | null {
  const o = offerFor(p, supplier);
  return o ? { name: p.name, code: o.code, supplierKey: o.supplierKey, costCents: o.netCents, brand: p.brand } : null;
}

const codeOf = (p: Product) => offerOf(p)?.code ?? "";
const partOf = (p: Product) => unitPartOf(p.name, codeOf(p));
const typeOf = (p: Product) => unitTypeOf(p.name, codeOf(p));
const kwOf = (p: Product) => capacityOf(p.name, codeOf(p));
const units = (products: readonly Product[]) => products.filter((p) => p.category === "units" && offerOf(p));

/** The longest run of characters two codes share. */
function shared(a: string, b: string): number {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  let best = 0;
  for (let i = 0; i < x.length; i++)
    for (let j = 0; j < y.length; j++) {
      let k = 0;
      while (x[i + k] && x[i + k] === y[j + k]) k++;
      if (k > best) best = k;
    }
  return best;
}

/** The outdoor that pairs with an indoor in the book, or null. */
export function pairOutdoor(products: readonly Product[], indoor: Product): Product | null {
  const kw = kwOf(indoor);
  const brand = (indoor.brand ?? "").toLowerCase();
  const type = typeOf(indoor);
  const code = codeOf(indoor);
  /* an outdoor's name often doesn't say its type: one that can't be told still pairs */
  const fits = units(products).filter(
    (p) => partOf(p) === "outdoor" && (typeOf(p) === type || typeOf(p) === "Other units") && (p.brand ?? "").toLowerCase() === brand && kw != null && kwOf(p) === kw
  );
  return [...fits].sort((a, b) => shared(code, codeOf(b)) - shared(code, codeOf(a)) || (offerOf(a)!.netCents - offerOf(b)!.netCents))[0] ?? null;
}

export const pairOf = (products: readonly Product[], indoor: Product, supplier: string | null = null): Pair => {
  const out = pairOutdoor(products, indoor);
  return { indoor: bookUnit(indoor, supplier)!, outdoor: out ? bookUnit(out, supplier) : null };
};

/** The book's item for a code, or null. */
export const byCode = (products: readonly Product[], code: string) =>
  products.find((p) => p.offers.some((o) => o.code.toUpperCase() === code.trim().toUpperCase())) ?? null;

/** Indoors like the one on the quote: the same type, within a quarter of
    its capacity, the business's preferred and most used first, each with
    its outdoor. */
export function suggestions(products: readonly Product[], indoorCode: string, limit = MAX_SUGGESTED, supplier: string | null = null): Pair[] {
  const base = byCode(products, indoorCode);
  if (!base) return [];
  const kw = kwOf(base);
  const type = typeOf(base);
  if (kw == null) return [];
  return units(products)
    .filter((p) => p !== base && partOf(p) === "indoor" && typeOf(p) === type)
    .filter((p) => {
      const k = kwOf(p);
      return k != null && Math.abs(k - kw) <= kw * CAPACITY_SPAN;
    })
    .sort((a, b) => (a.preferred ? 0 : 1) - (b.preferred ? 0 : 1) || b.quotes - a.quotes || Math.abs((kwOf(a) ?? 0) - kw) - Math.abs((kwOf(b) ?? 0) - kw))
    .slice(0, limit)
    .map((p) => pairOf(products, p, supplier));
}

/** What a person asked to compare with, when it can be found with no
    judgement: a code in the book, else a brand or name and a size ("a
    Fujitsu around 9 kW"). Null: it needs Tiff. */
export function askedPair(products: readonly Product[], ask: string, type: string | null, supplier: string | null = null): Pair | null {
  const words = ask.trim();
  if (!words) return null;
  /* a code, as written */
  for (const w of words.split(/[\s,]+/)) {
    const p = w.length >= 4 ? byCode(products, w) : null;
    if (p && partOf(p) !== "outdoor") return pairOf(products, p, supplier);
  }
  /* a name and a size */
  const kw = words.match(/(\d+(?:\.\d+)?)\s*kw\b/i);
  if (!kw) return null;
  const want = Number(kw[1]);
  const text = words
    .replace(kw[0], " ")
    .replace(/\b(a|an|the|around|about|roughly|something|unit|with|compare|like|of|kw)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  const hits = findInBook([...units(products)], { text, limit: 50 })
    .map((h) => h.product)
    .filter((p) => partOf(p) === "indoor" && (!type || typeOf(p) === type))
    .filter((p) => {
      const k = kwOf(p);
      return k != null && Math.abs(k - want) <= want * 0.15;
    })
    .sort((a, b) => Math.abs((kwOf(a) ?? 0) - want) - Math.abs((kwOf(b) ?? 0) - want));
  return hits[0] ? pairOf(products, hits[0], supplier) : null;
}
