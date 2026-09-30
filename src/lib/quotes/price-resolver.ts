import { netCents, type Supplier } from "./price-book";
import { refOf } from "./same-items";
import type { PriceOf, Priced } from "./ducted-template";

/* WHICH PRICE A QUOTE LINE TAKES, for a code the template asks for.

   Every supplier that sells the code — and every supplier selling a part a
   person confirmed as the same one under another code (AAD's PC1412 is
   Reece's 9800006-1) — is a candidate, at what the business pays (a net
   price as sent, a list price less the discount). The business's own choice
   wins where there is one (Preferred items, a unit bought from a named
   supplier); otherwise the lowest price that is a price: $0.00 is an item
   nobody priced, never a free one.

   Pure, so the tests and the quote page read the same answer; the server
   side loads the book once and hands the closure to the template. */

export type BookRow = { supplierKey: string; code: string; name: string; cents: number };

export type ResolverInput = {
  items: BookRow[];
  suppliers: Supplier[];
  /** confirmed same-item pairs, "supplier|code" each */
  confirmed: [string, string][];
  /** a code the business has chosen a supplier for */
  chosenSupplier?: Map<string, string>;
};

export function makePriceOf(input: ResolverInput): PriceOf {
  const sup = new Map(input.suppliers.map((s) => [s.key, s]));
  /* confirmed pairs only: a supplier's pack sizes (Reece's -1 coil and -2
     by the metre) are different things to buy, never one price for the other */
  const pairs = new Map<string, string[]>();
  for (const [a, b] of input.confirmed) {
    pairs.set(a, [...(pairs.get(a) ?? []), b]);
    pairs.set(b, [...(pairs.get(b) ?? []), a]);
  }
  const byRef = new Map(input.items.map((i) => [refOf(i), i]));
  const byCode = new Map<string, BookRow[]>();
  for (const i of input.items) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
  return (code: string): Priced | null => {
    const partners = new Set<BookRow>(byCode.get(code) ?? []);
    const walk = [...partners].map(refOf);
    const seen = new Set(walk);
    while (walk.length) {
      for (const next of pairs.get(walk.pop()!) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        walk.push(next);
        const row = byRef.get(next);
        if (row) partners.add(row);
      }
    }
    const offers = [...partners]
      .map((r) => {
        const s = sup.get(r.supplierKey);
        return s ? { row: r, buyCents: netCents(s, r.code, r.cents) } : null;
      })
      .filter((o): o is { row: BookRow; buyCents: number } => o !== null && o.buyCents > 0)
      .sort((a, b) => a.buyCents - b.buyCents);
    if (offers.length === 0) return null;
    const want = input.chosenSupplier?.get(code);
    const pick = (want && offers.find((o) => o.row.supplierKey === want)) || offers[0]!;
    return { buyCents: pick.buyCents, supplierKey: pick.row.supplierKey, name: pick.row.name };
  };
}
