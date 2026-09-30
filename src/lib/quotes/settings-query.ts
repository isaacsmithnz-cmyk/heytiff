import { supabaseAdmin } from "@/lib/supabase-server";
import {
  COMPONENT_KEYS,
  QUOTE_COMPONENTS,
  buyPerUnitCents,
  matchesComponent,
  rollMetresOf,
  type ComponentKey,
} from "./components";
import { netCents } from "./price-book";
import { currentItems, readSuppliers, type BookItem, type SupplierView } from "./price-book-server";
import { normaliseQuoteSettings, type QuoteSettings } from "./settings";

/* The Quoting page's reads: the business's settings, and for each component
   Tiff's shortlist from HeyTiff's own price book (every supplier's current
   items). Server only, service role; the page is gated on `financials`
   before it calls these, because buy prices are the business's money. */

export async function readQuoteSettings(orgId: string): Promise<QuoteSettings> {
  const { data } = await supabaseAdmin
    .from("quote_settings")
    .select("unit_markup_pct, material_markup_pct, day_hours, preferred")
    .eq("org_id", orgId)
    .maybeSingle();
  return normaliseQuoteSettings(data ?? {});
}

/** One supplier's price for a grouped item. */
export type ComponentOffer = {
  supplierKey: string;
  supplierName: string;
  /** what the business pays for the item as sold (a roll, a box, one) */
  buyCents: number;
  /** buy price per metre, or each */
  perUnitCents: number | null;
};

/** One item on a component's shortlist: a code, with every supplier that
    sells it grouped under it, lowest first. */
export type ComponentGroup = {
  code: string;
  name: string;
  /** read off the name, or the person's correction on the chosen one */
  rollM: number | null;
  /** how many lines on the business's jobs were this item */
  uses: number;
  offers: ComponentOffer[];
};

/** The item that prices a component: the lowest by default, or the one a
    person chose over it. */
export type ComponentChoice = { group: ComponentGroup; offer: ComponentOffer; overridden: boolean };

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

/** How many job lines used each of these codes, through the job-line
    mirror's link to ServiceM8's catalogue item and that item's code. */
async function usesByCode(orgId: string, codes: string[]): Promise<Map<string, number>> {
  const uses = new Map<string, number>();
  if (codes.length === 0) return uses;
  const { data: cat } = await supabaseAdmin
    .from("sm8_materials")
    .select("uuid, item_number")
    .eq("org_id", orgId)
    .in("item_number", codes.slice(0, 1000));
  const codeOf = new Map(((cat ?? []) as { uuid: string; item_number: string }[]).map((r) => [r.uuid, r.item_number]));
  if (codeOf.size === 0) return uses;
  const { data } = await supabaseAdmin
    .from("sm8_job_materials")
    .select("material_uuid")
    .eq("org_id", orgId)
    .eq("active", 1)
    .in("material_uuid", [...codeOf.keys()])
    .limit(10000);
  for (const r of (data ?? []) as { material_uuid: string | null }[]) {
    const code = r.material_uuid ? codeOf.get(r.material_uuid) : undefined;
    if (code) uses.set(code, (uses.get(code) ?? 0) + 1);
  }
  return uses;
}

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
  suppliers?: SupplierView[]
): Promise<ComponentShortlist[]> {
  const [book, sups] = await Promise.all([currentItems(orgId), suppliers ? Promise.resolve(suppliers) : readSuppliers(orgId)]);
  const supplierOf = new Map(sups.map((s) => [s.key, s]));
  const matched = new Map<ComponentKey, BookItem[]>(
    COMPONENT_KEYS.map((k) => [k, book.filter((m) => matchesComponent(k, m.name))])
  );
  const uses = await usesByCode(orgId, [...new Set([...matched.values()].flat().map((m) => m.code))]);

  return COMPONENT_KEYS.map((key) => {
    const c = QUOTE_COMPONENTS[key];
    const chosen = settings.preferred[key];
    /* the same code at every supplier is one item */
    const byCode = new Map<string, BookItem[]>();
    for (const m of matched.get(key) ?? []) byCode.set(m.code, [...(byCode.get(m.code) ?? []), m]);
    const groups = rankGroups(
      [...byCode.entries()].map(([code, rows]) => {
        const rollM =
          c.unit === "each" ? null : chosen?.code === code && chosen.rollM ? chosen.rollM : rollMetresOf(rows[0]!.name);
        const offers = rows
          .map((m): ComponentOffer | null => {
            const s = supplierOf.get(m.supplierKey);
            if (!s) return null;
            const buyCents = netCents(s, m.code, m.cents);
            return { supplierKey: s.key, supplierName: s.name, buyCents, perUnitCents: buyPerUnitCents(c.unit, buyCents, rollM) };
          })
          .filter((o): o is ComponentOffer => o !== null)
          .sort((a, b) => rankPrice(a.perUnitCents) - rankPrice(b.perUnitCents));
        return { code, name: rows[0]!.name, rollM, uses: uses.get(code) ?? 0, offers };
      })
    );
    /* a person's choice, while that item is still in the book; otherwise
       the lowest priced item that can be priced */
    let pick: ComponentChoice | null = null;
    if (chosen) {
      const group = groups.find((g) => g.code === chosen.code);
      const offer = group?.offers.find((o) => o.supplierKey === chosen.supplierKey);
      if (group && offer) pick = { group, offer, overridden: true };
    }
    if (!pick) {
      const group = groups.find((g) => rankPrice(g.offers[0]?.perUnitCents ?? null) < Infinity);
      if (group) pick = { group, offer: group.offers[0]!, overridden: false };
    }
    return { key, label: c.label, unit: c.unit, chosen: pick, groups: groups.slice(0, SHORTLIST) };
  });
}
