import { supabaseAdmin } from "@/lib/supabase-server";
import {
  COMPONENT_KEYS,
  QUOTE_COMPONENTS,
  buyPerUnitCents,
  colourOf,
  matchesComponent,
  withoutColour,
  rollMetresOf,
  type ComponentKey,
} from "./components";
import { netCents } from "./price-book";
import { currentItems, readPreferred, readSameDecisions, readSuppliers, type BookItem, type SupplierView } from "./price-book-server";
import { productsOf, refOf } from "./same-items";
import { jobLinesByCode } from "./book-view-server";
import { normaliseQuoteSettings, type QuoteSettings } from "./settings";

/* The Quoting page's reads: the business's settings, and for each component
   Tiff's shortlist from HeyTiff's own price book (every supplier's current
   items). Server only, service role; the page is gated on `financials`
   before it calls these, because buy prices are the business's money. */

export async function readQuoteSettings(orgId: string): Promise<QuoteSettings> {
  const { data } = await supabaseAdmin
    .from("quote_settings")
    .select("unit_markup_pct, material_markup_pct, charge_out_cents, day_hours, contingency_pct, contingency_hours, consumables_cents, new_circuit_cents, flush_cents, recovery_cents, usual_layout, show_lines, preferred")
    .eq("org_id", orgId)
    .maybeSingle();
  return normaliseQuoteSettings(data ?? {});
}

/** One supplier's price for a grouped item, in one pack size. */
export type ComponentOffer = {
  supplierKey: string;
  supplierName: string;
  /** the code this price is for: a group holds a supplier's pack sizes
      (Reece's 3211201-1 coil and 3211201-2 by the metre) */
  code: string;
  /** the pack, in a few words: "25 m coil", "per metre" */
  pack: string | null;
  /** what the business pays for the item as sold (a roll, a box, one) */
  buyCents: number;
  /** buy price per metre, or each */
  perUnitCents: number | null;
};

/** One item on a component's shortlist, with every supplier and pack size
    that sells it grouped under it, lowest a metre or each first. `code` is
    the group's: a pack-size suffix (-1, -2) is set aside. */
export type ComponentGroup = {
  code: string;
  name: string;
  /** the lowest offer's roll, or the person's correction on the chosen one */
  rollM: number | null;
  /** how many lines on the business's jobs were this item */
  uses: number;
  offers: ComponentOffer[];
};

/** The item that prices a component: the lowest by default, or the one a
    person chose over it. */
export type ComponentChoice = {
  group: ComponentGroup;
  offer: ComponentOffer;
  overridden: boolean;
  /** not chosen here, but put forward in the price book */
  preferred?: boolean;
};

export type ComponentShortlist = {
  key: ComponentKey;
  label: string;
  unit: "m" | "each";
  /** null when nothing in the price book prices it yet */
  chosen: ComponentChoice | null;
  /** lowest price per metre or each first; similar items one row each */
  groups: ComponentGroup[];
};

const SHORTLIST = 8;


/* $0.00 is an item nobody priced, not a free one, and a metre can't be
   priced from a roll of unknown length: both rank last and are never the
   default. */
const rankPrice = (c: number | null) => (c != null && c > 0 ? c : Infinity);
const lowestOf = (g: ComponentGroup) => rankPrice(g.offers[0]?.perUnitCents ?? null);

/** Lowest price per metre or each first, then the most used. */
export function rankGroups(groups: ComponentGroup[]): ComponentGroup[] {
  return [...groups].sort((a, b) => lowestOf(a) - lowestOf(b) || b.uses - a.uses || a.name.localeCompare(b.name));
}

export async function componentShortlists(
  orgId: string,
  settings: QuoteSettings,
  suppliers?: SupplierView[],
  /** the book, its same-item decisions and preferred items, when the caller has read them */
  pre?: { book: BookItem[]; same: Awaited<ReturnType<typeof readSameDecisions>>; preferred: Set<string> }
): Promise<ComponentShortlist[]> {
  const [book, sups, same, preferred] = await Promise.all([
    pre ? Promise.resolve(pre.book) : currentItems(orgId),
    suppliers ? Promise.resolve(suppliers) : readSuppliers(orgId),
    pre ? Promise.resolve(pre.same) : readSameDecisions(orgId),
    pre ? Promise.resolve(pre.preferred) : readPreferred(orgId),
  ]);
  /* a part a person confirmed is one item at two suppliers under their own
     codes (AAD's PC1412 and Reece's 9800006-1) */
  const products = productsOf(book, same.confirmed);
  const confirmedProducts = new Set(same.confirmed.flat().map((r) => products.get(r)).filter((p): p is string => !!p));
  const supplierOf = new Map(sups.map((s) => [s.key, s]));
  const matched = new Map<ComponentKey, BookItem[]>(
    COMPONENT_KEYS.map((k) => [k, book.filter((m) => matchesComponent(k, m.name))])
  );
  /* how many lines on the business's jobs were each item: the same count
     the price book's Most used reads */
  const uses = await jobLinesByCode(orgId, [...new Set([...matched.values()].flat().map((m) => m.code))]);

  return COMPONENT_KEYS.map((key) => {
    const c = QUOTE_COMPONENTS[key];
    const chosen = settings.preferred[key];
    /* one item: a code at every supplier, a supplier's pack sizes of it
       (Reece's 3211201-1 coil, 3211201-2 by the metre), and one part's
       colours (Reece's metal trunking in twelve) */
    const groupKey = (m: BookItem) => {
      const product = products.get(refOf(m));
      if (product && confirmedProducts.has(product)) return `p:${product}`;
      return colourOf(m.name) ? `${m.supplierKey}|${withoutColour(m.name).toUpperCase()}` : m.code.replace(/-\d+$/, "");
    };
    const byCode = new Map<string, BookItem[]>();
    for (const m of matched.get(key) ?? []) byCode.set(groupKey(m), [...(byCode.get(groupKey(m)) ?? []), m]);
    const rollOf = (m: BookItem) =>
      c.unit === "each"
        ? null
        : chosen?.code === m.code && chosen.rollM
          ? chosen.rollM
          : /^(MTR|M)$/i.test(m.uom ?? "")
            ? 1
            : rollMetresOf(m.name);
    const packOf = (m: BookItem, rollM: number | null) =>
      colourOf(m.name) ??
      (c.unit === "each" ? null : rollM === 1 ? "per metre" : rollM ? `${rollM} m${m.uom ? ` ${m.uom.toLowerCase()}` : ""}` : null);
    const groups = rankGroups(
      [...byCode.entries()].map(([code, rows]) => {
        const offers = rows
          .map((m): ComponentOffer | null => {
            const s = supplierOf.get(m.supplierKey);
            if (!s) return null;
            const buyCents = netCents(s, m.code, m.cents, m.net);
            const rollM = rollOf(m);
            return {
              supplierKey: s.key,
              supplierName: s.name,
              code: m.code,
              pack: packOf(m, rollM),
              buyCents,
              perUnitCents: buyPerUnitCents(c.unit, buyCents, rollM),
            };
          })
          .filter((o): o is ComponentOffer => o !== null)
          .sort((a, b) => rankPrice(a.perUnitCents) - rankPrice(b.perUnitCents));
        const first = rows.find((r) => r.code === offers[0]?.code) ?? rows[0]!;
        const colours = rows.some((r) => colourOf(r.name));
        return {
          code: code.startsWith("p:") ? first.code : colours ? first.code.replace(/-\d+$/, "") : code,
          name: colours ? withoutColour(first.name) : first.name,
          rollM: rollOf(first),
          uses: rows.reduce((n, r) => n + (uses.get(r.code) ?? 0), 0),
          offers,
        };
      })
    );
    /* a person's choice for this component, while that item is still in
       the book; then an item put forward in the price book; otherwise the
       lowest priced item that can be priced */
    let pick: ComponentChoice | null = null;
    if (chosen) {
      const group = groups.find((g) => g.offers.some((o) => o.code === chosen.code && o.supplierKey === chosen.supplierKey));
      const offer = group?.offers.find((o) => o.code === chosen.code && o.supplierKey === chosen.supplierKey);
      if (group && offer) pick = { group, offer, overridden: true };
    }
    if (!pick) {
      const put = (o: ComponentOffer) => preferred.has(`${o.supplierKey}|${o.code}`) && rankPrice(o.perUnitCents) < Infinity;
      const group = groups.find((g) => g.offers.some(put));
      const offer = group?.offers.find(put);
      if (group && offer) pick = { group, offer, overridden: false, preferred: true };
    }
    if (!pick) {
      const group = groups.find((g) => rankPrice(g.offers[0]?.perUnitCents ?? null) < Infinity);
      if (group) pick = { group, offer: group.offers[0]!, overridden: false };
    }
    return { key, label: c.label, unit: c.unit, chosen: pick, groups: groups.slice(0, SHORTLIST) };
  });
}
