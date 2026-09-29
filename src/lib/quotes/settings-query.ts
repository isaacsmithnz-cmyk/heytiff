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

/** A price-book item on a component's shortlist. */
export type ComponentItem = {
  /** supplier and code: one item in the book */
  id: string;
  supplierKey: string;
  supplierName: string;
  code: string;
  name: string;
  /** what the business pays for the item as sold (a roll, a box, one) */
  buyCents: number;
  /** read off the name, or the person's correction on the preferred one */
  rollM: number | null;
  /** buy price per metre, or each */
  perUnitCents: number | null;
  /** how many lines on the business's jobs were this item */
  uses: number;
};

export type ComponentShortlist = {
  key: ComponentKey;
  label: string;
  unit: "m" | "each";
  /** the preferred item, when one is set and still in the price book */
  preferred: ComponentItem | null;
  /** best first: most used, then cheapest per metre or each */
  items: ComponentItem[];
};

const SHORTLIST = 8;
export const itemId = (supplierKey: string, code: string) => `${supplierKey}:${code}`;

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

/** Most used first, then cheapest per metre or each. An item with no price
    per unit — or a price of $0.00, which is an item nobody priced, not a
    free one — comes last. */
const rankPrice = (c: number | null) => (c != null && c > 0 ? c : Infinity);
export function rankItems(items: ComponentItem[]): ComponentItem[] {
  return [...items].sort(
    (a, b) =>
      b.uses - a.uses ||
      rankPrice(a.perUnitCents) - rankPrice(b.perUnitCents) ||
      a.name.localeCompare(b.name)
  );
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
    const itemOf = (m: BookItem): ComponentItem | null => {
      const s = supplierOf.get(m.supplierKey);
      if (!s) return null;
      const buyCents = netCents(s, m.code, m.cents);
      const isChosen = chosen?.supplierKey === m.supplierKey && chosen.code === m.code;
      const rollM = c.unit === "each" ? null : isChosen && chosen.rollM ? chosen.rollM : rollMetresOf(m.name);
      return {
        id: itemId(m.supplierKey, m.code),
        supplierKey: m.supplierKey,
        supplierName: s.name,
        code: m.code,
        name: m.name,
        buyCents,
        rollM,
        perUnitCents: buyPerUnitCents(c.unit, buyCents, rollM),
        uses: uses.get(m.code) ?? 0,
      };
    };
    const items = rankItems((matched.get(key) ?? []).map(itemOf).filter((x): x is ComponentItem => x !== null));
    const preferredRow = chosen ? book.find((m) => m.supplierKey === chosen.supplierKey && m.code === chosen.code) : undefined;
    return {
      key,
      label: c.label,
      unit: c.unit,
      preferred: preferredRow ? itemOf(preferredRow) : null,
      items: items.slice(0, SHORTLIST),
    };
  });
}
