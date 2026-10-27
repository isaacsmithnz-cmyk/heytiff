import type { CategoryKey } from "./categories";
import type { Offer } from "./price-book";
import type { BookCounts, Product } from "./families";

/* THE BOOK, PACKED FOR THE WIRE (Isaac, 27 October 2026: "make it fast").

   The Items tab sorts and searches the whole book in the browser, so a
   shelf or a search answers at once. As objects that was 2.8 MB for 8,870
   parts: every price spelled its supplier's key and name and every field's
   name, and each part carried its cheapest and its preferred price a second
   time, copies of prices already in its list. Packed, a supplier is a number
   into one list of them, a price is a row of values, the cheapest is worked
   out again from the list (the first with a price, as productsFrom has it)
   and the preferred is a place in it. A part's name is its first price's,
   as productsFrom names it, and is only sent when it isn't. Nothing is
   lost: `unpackBook(packBook(b))` is
   `b`, and the tests hold it so. */

/** A price: [supplier, code, name, net cents, invoiced on, the other price]. */
type PackedOffer = [number, string, string, number, string | 0, [number, string | null, "list" | "invoice"] | 0];

/** A part: [key, shelf, maker, quotes it's on, which price is preferred (-1
    none), its prices, and its name when it isn't its first price's]. */
type PackedProduct = [string, CategoryKey, string | 0, number, number, PackedOffer[], string?];

/** The price a part is named from: the first with a price, else the first. */
const firstOf = (offers: Offer[]) => offers.find((o) => o.netCents > 0) ?? offers[0];

export type PackedBook = { suppliers: [string, string][]; products: PackedProduct[] };

const refOf = (o: Offer) => `${o.supplierKey}|${o.code}`;

export function packBook(products: Product[]): PackedBook {
  const suppliers: [string, string][] = [];
  const index = new Map<string, number>();
  const sup = (o: Offer) => {
    let i = index.get(o.supplierKey);
    if (i === undefined) {
      i = suppliers.length;
      suppliers.push([o.supplierKey, o.supplierName]);
      index.set(o.supplierKey, i);
    }
    return i;
  };
  return {
    suppliers,
    products: products.map((p): PackedProduct => {
      const preferred = p.preferred ? p.offers.findIndex((o) => refOf(o) === refOf(p.preferred!)) : -1;
      const packed: PackedProduct = [
        p.key,
        p.category,
        p.brand ?? 0,
        p.quotes,
        preferred,
        p.offers.map((o): PackedOffer => [
          sup(o),
          o.code,
          o.name,
          o.netCents,
          o.pricedOn ?? 0,
          o.other ? [o.other.netCents, o.other.on, o.other.from] : 0,
        ]),
      ];
      if (p.name !== firstOf(p.offers)?.name) packed.push(p.name);
      return packed;
    }),
  };
}

export function unpackBook(book: PackedBook): Product[] {
  return book.products.map(([key, category, brand, quotes, preferred, packed, named]) => {
    const offers = packed.map(([s, code, name, netCents, pricedOn, other]): Offer => {
      const [supplierKey, supplierName] = book.suppliers[s]!;
      return {
        supplierKey,
        supplierName,
        code,
        name,
        netCents,
        ...(pricedOn ? { pricedOn } : {}),
        ...(other ? { other: { netCents: other[0], on: other[1], from: other[2] } } : {}),
      };
    });
    const cheapest = offers.find((o) => o.netCents > 0) ?? null;
    return {
      key,
      name: named ?? (cheapest ?? offers[0]!).name,
      category,
      offers,
      cheapest,
      preferred: preferred >= 0 ? offers[preferred]! : null,
      brand: brand || null,
      quotes,
    };
  });
}

/* WHAT THE PAGE SENDS: the Most used list the Items tab opens on, and what
   the chooser counts, from the whole book on the server. Forty parts, so the
   tab draws with the page; the book itself follows, packed, for a shelf or
   a search. */
export type FirstBook = { used: Product[]; counts: BookCounts };
