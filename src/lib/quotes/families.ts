import { netCents, type Offer, type PricePoint, type Supplier } from "./price-book";
import { CATEGORIES, categoryOf, type CategoryKey } from "./categories";
import { productsOf, refOf } from "./same-items";

/* THE PRICE BOOK SORTED: shelves, then families, then the sizes.

   A shelf (categories.ts) holds hundreds of things; most of them are one
   thing in many sizes. AAD's eleven "PAIRED COIL 1/4+1/2X20M…" rows are one
   family, pair coil, sized; Reece's five "AIRFORM FULLCONE ROUND DIFFUSER
   150MM" are one family; the isolators by amps and poles are a family per
   make. So a family is the name with its sizes taken out — every word
   holding a figure, and the unit words left standing (mm, pole, amps) — and
   its products sit in size order under it.

   A PRODUCT is one part: the same code at two suppliers, a supplier's pack
   sizes of it, and a pair a person confirmed as one part under two codes
   (same-items.ts). It carries every supplier's price, and the business's
   PREFERRED one when it has put one forward.

   What comes first: a family holding a preferred item, then the most used,
   then by name. Inside a family, the preferred item, then size order — or,
   on the most-used list, the most used. Worked out at read from the names,
   never stored, so a better rule re-sorts the book without an import.
   Pure: the page, the quote and the tests read the same answer. */

/** An item as the book holds it, enough to place and price it. */
export type ShelfItem = {
  supplierKey: string;
  code: string;
  name: string;
  /** the price taken: the newer of the list's and the latest invoice's */
  cents: number;
  /** already what was paid: no discount comes off */
  net?: boolean;
  pricedOn: string | null;
  /** the price not taken, when the item has both */
  other?: PricePoint | null;
  timesBought: number | null;
};

export type Product = {
  /** the product's own key: its smallest "supplier|code" */
  key: string;
  name: string;
  category: CategoryKey;
  /** every supplier's price, lowest first */
  offers: Offer[];
  /** the lowest price that is a price ($0.00 is one nobody priced) */
  cheapest: Offer | null;
  /** the supplier's item the business put forward, when it has */
  preferred: Offer | null;
  /** lines on the business's own jobs that were this part */
  jobLines: number;
  /** times its invoices say it was bought */
  bought: number;
};

export type Family = { key: string; label: string; products: Product[] };

/** How often a product is used: job lines and purchases together. */
export const usesOf = (p: Product) => p.jobLines + p.bought;

/* the words that are a unit or a joiner once the figure beside them is gone */
const UNIT_WORDS = new Set([
  "MM", "M", "CM", "X", "KG", "KW", "W", "V", "A", "AMP", "AMPS", "POLE", "POLES", "DIA", "SQ", "PER",
  "METRE", "METER", "MTR", "EA", "EACH", "PACK", "PK", "LTR", "LT", "L", "HR", "HP", "IN", "INCH", "&", "+",
  "-", "/", "–",
]);

/** The words of a family: the name without its sizes. */
export function familyWords(name: string): string[] {
  const plain = name
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bper\s+met(re|er)\b/gi, " ")
    .replace(/["“”']/g, " ");
  return plain
    .split(/[\s,]+/)
    .map((w) => w.replace(/^[-+/–]+|[-+/–]+$/g, ""))
    .filter((w) => w && !/\d/.test(w) && !UNIT_WORDS.has(w.toUpperCase()));
}

/* the few short words a trade name keeps in capitals */
const ACRONYMS = new Set(["ABS", "PVC", "TPS", "RCD", "RCBO", "MCB", "GPO", "LED", "UV", "EC", "AC", "CU", "HDG", "MDO", "PEX", "BSP", "IP", "DIN", "ODU", "IDU", "R/A", "S/A", "S/S"]);

/** "PAIRED COIL" → "Paired coil"; a name typed in its own case keeps it. */
export function familyLabel(words: string[]): string {
  const text = words.join(" ");
  if (!text) return "";
  if (text !== text.toUpperCase()) return text;
  return words
    .map((w, i) => {
      const up = w.toUpperCase();
      if (ACRONYMS.has(up) || (/^[A-Z]{2,4}$/.test(up) && !/[AEIOUY]/.test(up))) return up;
      const low = w.toLowerCase();
      return i === 0 ? low.charAt(0).toUpperCase() + low.slice(1) : low;
    })
    .join(" ");
}

/** The family a name is in, and its label. A name that is nothing but
    sizes is a family of its own. */
export function familyOf(name: string): { key: string; label: string } {
  const words = familyWords(name);
  if (words.length === 0) return { key: name.trim().toUpperCase(), label: name.trim() };
  return { key: words.join(" ").toUpperCase(), label: familyLabel(words) };
}

/** The figures in a name, in order, a fraction as its value: what a family
    is sorted by, so 1/4+3/8 comes before 1/4+1/2 and 5 m before 20 m. */
export function sizesOf(name: string): number[] {
  const out: number[] = [];
  for (const m of name.replace(/\([^)]*\)/g, " ").matchAll(/(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?/g)) {
    const a = Number(m[1]);
    out.push(m[2] ? a / Number(m[2]) : a);
  }
  return out;
}

const bySize = (a: Product, b: Product) => {
  const sa = sizesOf(a.name);
  const sb = sizesOf(b.name);
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) if (sa[i] !== sb[i]) return sa[i]! - sb[i]!;
  return sa.length - sb.length || a.name.localeCompare(b.name);
};

/** The book's items as products: one part at every supplier, priced at what
    the business pays, with its preferred item and how often it's used. */
export function productsFrom(
  items: ShelfItem[],
  suppliers: Supplier[],
  confirmed: [string, string][],
  preferred: Set<string>,
  jobLinesByCode: Map<string, number>
): Product[] {
  const sup = new Map(suppliers.map((s) => [s.key, s]));
  const keyOf = productsOf(items, confirmed);
  const grouped = new Map<string, ShelfItem[]>();
  for (const i of items) {
    if (!sup.has(i.supplierKey)) continue;
    const key = keyOf.get(refOf(i)) ?? refOf(i);
    grouped.set(key, [...(grouped.get(key) ?? []), i]);
  }
  return [...grouped.entries()].map(([key, rows]) => {
    const offers = rows
      .map((r): Offer => {
        const s = sup.get(r.supplierKey)!;
        const other = r.other ? { netCents: netCents(s, r.code, r.other.cents, r.other.net), on: r.other.on, from: r.other.from } : null;
        return { supplierKey: s.key, supplierName: s.name, code: r.code, name: r.name, netCents: netCents(s, r.code, r.cents, r.net), pricedOn: r.pricedOn, other };
      })
      .sort((a, b) => (a.netCents > 0 ? a.netCents : Infinity) - (b.netCents > 0 ? b.netCents : Infinity));
    const cheapest = offers.find((o) => o.netCents > 0) ?? null;
    const first = cheapest ?? offers[0]!;
    const codes = new Set(rows.map((r) => r.code));
    return {
      key,
      name: first.name,
      category: categoryOf(first.name, first.code),
      offers,
      cheapest,
      preferred: offers.find((o) => preferred.has(refOf(o))) ?? null,
      jobLines: [...codes].reduce((n, c) => n + (jobLinesByCode.get(c) ?? 0), 0),
      bought: rows.reduce((n, r) => n + (r.timesBought ?? 0), 0),
    };
  });
}

/** Products into families, the preferred and the most used first. `use`
    orders a family's products by use (the most-used list); otherwise by size. */
export function organise(products: Product[], order: "size" | "use" = "size"): Family[] {
  const families = new Map<string, Family>();
  for (const p of products) {
    const f = familyOf(p.name);
    const fam = families.get(f.key) ?? { key: f.key, label: f.label, products: [] };
    fam.products.push(p);
    families.set(f.key, fam);
  }
  const anyPreferred = (f: Family) => (f.products.some((p) => p.preferred) ? 0 : 1);
  const used = (f: Family) => f.products.reduce((n, p) => n + usesOf(p), 0);
  for (const f of families.values()) {
    f.products.sort(
      (a, b) =>
        (a.preferred ? 0 : 1) - (b.preferred ? 0 : 1) ||
        (order === "use" ? usesOf(b) - usesOf(a) : 0) ||
        bySize(a, b)
    );
  }
  return [...families.values()].sort((a, b) => anyPreferred(a) - anyPreferred(b) || used(b) - used(a) || a.label.localeCompare(b.label));
}

/** Every word in the code or the name. */
export const matchesWords = (p: Product, words: string[]) =>
  words.every((w) => p.offers.some((o) => `${o.code} ${o.name}`.toLowerCase().includes(w)));

export type BookViewKey = "used" | "preferred" | "all" | CategoryKey;

export type BookSection = { key: CategoryKey; label: string; families: Family[] };

export type BookCounts = { used: number; preferred: number; shelves: { key: CategoryKey; label: string; count: number }[] };

export type BookView = {
  counts: BookCounts;
  sections: BookSection[];
  /** products in the view, before the cap */
  total: number;
  /** products sent */
  shown: number;
};

/** the most-used list: the parts the business reaches for */
export const MOST_USED = 40;
/** past this many products a view is narrowed by searching */
export const VIEW_CAP = 300;

/** A view of the book: the most used, the preferred, one shelf, or a search
    of the whole book — each in shelves, then families. */
export function viewOf(products: Product[], view: BookViewKey, query: string): BookView {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  const used = products.filter((p) => usesOf(p) > 0).sort((a, b) => usesOf(b) - usesOf(a));
  const counts: BookCounts = {
    used: Math.min(MOST_USED, used.length),
    preferred: products.filter((p) => p.preferred).length,
    shelves: CATEGORIES.map((c) => ({ ...c, count: products.filter((p) => p.category === c.key).length })).filter((c) => c.count > 0),
  };
  const picked =
    view === "used"
      ? used.slice(0, MOST_USED)
      : view === "preferred"
        ? products.filter((p) => p.preferred)
        : view === "all"
          ? words.length
            ? products
            : []
          : products.filter((p) => p.category === view);
  const found = picked.filter((p) => matchesWords(p, words));

  /* shelves in the book's order; the most-used list puts its busiest first */
  const order = view === "used" ? "use" : "size";
  const sections = CATEGORIES.map((c) => ({ key: c.key, label: c.label, families: organise(found.filter((p) => p.category === c.key), order) }))
    .filter((s) => s.families.length > 0);
  if (view === "used") {
    const usesIn = (s: BookSection) => s.families.reduce((n, f) => n + f.products.reduce((m, p) => m + usesOf(p), 0), 0);
    sections.sort((a, b) => usesIn(b) - usesIn(a));
  }

  /* whole families, until the cap */
  let shown = 0;
  const capped: BookSection[] = [];
  for (const s of sections) {
    const families: Family[] = [];
    for (const f of s.families) {
      if (shown >= VIEW_CAP) break;
      families.push(f);
      shown += f.products.length;
    }
    if (families.length) capped.push({ ...s, families });
  }
  return { counts, sections: capped, total: found.length, shown };
}
