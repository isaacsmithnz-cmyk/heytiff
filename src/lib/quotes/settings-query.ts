import { supabaseAdmin } from "@/lib/supabase-server";
import {
  COMPONENT_KEYS,
  QUOTE_COMPONENTS,
  amountCents,
  buyPerUnitCents,
  matchesComponent,
  rollMetresOf,
  type ComponentKey,
} from "./components";
import { normaliseQuoteSettings, type QuoteSettings } from "./settings";

/* The Quoting page's reads: the business's settings, and for each component
   Tiff's shortlist from the mirrored price book (sm8_materials). Server
   only, service role; the page is gated on `financials` before it calls
   these, because buy prices are the business's money. */

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
  uuid: string;
  name: string;
  itemNumber: string | null;
  priceCents: number | null;
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

type MaterialRow = { uuid: string; name: string | null; item_number: string | null; price: string | null };

const PAGE = 1000;
const SHORTLIST = 8;

/** Every active price-book item, a page at a time (a query returns at most a
    thousand rows, and the live book is about 4,300). */
async function activeMaterials(orgId: string): Promise<MaterialRow[]> {
  const rows: MaterialRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("sm8_materials")
      .select("uuid, name, item_number, price")
      .eq("org_id", orgId)
      .eq("active", 1)
      .order("uuid")
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    rows.push(...(data as MaterialRow[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

/** How many job lines each of these items was, from the job-line mirror's
    link back to the price book. */
async function usesOf(orgId: string, uuids: string[]): Promise<Map<string, number>> {
  const uses = new Map<string, number>();
  if (uuids.length === 0) return uses;
  const { data } = await supabaseAdmin
    .from("sm8_job_materials")
    .select("material_uuid")
    .eq("org_id", orgId)
    .eq("active", 1)
    .in("material_uuid", uuids)
    .limit(10000);
  for (const r of (data ?? []) as { material_uuid: string | null }[]) {
    if (r.material_uuid) uses.set(r.material_uuid, (uses.get(r.material_uuid) ?? 0) + 1);
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

export async function componentShortlists(orgId: string, settings: QuoteSettings): Promise<ComponentShortlist[]> {
  const book = await activeMaterials(orgId);
  const matched = new Map<ComponentKey, MaterialRow[]>(
    COMPONENT_KEYS.map((k) => [k, book.filter((m) => matchesComponent(k, m.name))])
  );
  const uses = await usesOf(orgId, [...new Set([...matched.values()].flat().map((m) => m.uuid))]);

  return COMPONENT_KEYS.map((key) => {
    const c = QUOTE_COMPONENTS[key];
    const chosen = settings.preferred[key];
    const itemOf = (m: MaterialRow): ComponentItem => {
      const priceCents = amountCents(m.price);
      const rollM = c.unit === "each" ? null : chosen?.materialUuid === m.uuid && chosen.rollM ? chosen.rollM : rollMetresOf(m.name);
      return {
        uuid: m.uuid,
        name: m.name ?? "",
        itemNumber: m.item_number,
        priceCents,
        rollM,
        perUnitCents: buyPerUnitCents(c.unit, priceCents, rollM),
        uses: uses.get(m.uuid) ?? 0,
      };
    };
    const items = rankItems((matched.get(key) ?? []).map(itemOf));
    const preferredRow = chosen ? book.find((m) => m.uuid === chosen.materialUuid) : undefined;
    return {
      key,
      label: c.label,
      unit: c.unit,
      preferred: preferredRow ? itemOf(preferredRow) : null,
      items: items.slice(0, SHORTLIST),
    };
  });
}
