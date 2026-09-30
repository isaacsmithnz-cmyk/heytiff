import { supabaseAdmin } from "@/lib/supabase-server";
import { latestInstalledPack, loadInstalledPack } from "@/lib/studio/packs/server";
import { codeFeatures, linkModels, type Decision, type ModelLink } from "./code-links";
import { compareOffers, netCents, type Offer } from "./price-book";
import { currentItems, readSuppliers, type BookItem } from "./price-book-server";

/* The pack ↔ price book link, on the database: which pack models there are,
   what a person has decided about a near match, and every supplier's price
   for a pack model through the codes it links to. Service role; callers
   gate on `financials`. */

const BRAND = "mitsubishi-electric";

export type PackModel = { model: string; section: "Indoor" | "Outdoor" | "Accessory" | "Part"; label: string };

/** Every model in the newest Mitsubishi Electric pack. */
export async function packModels(): Promise<PackModel[]> {
  const ref = await latestInstalledPack(BRAND);
  if (!ref) return [];
  const { pack } = await loadInstalledPack(ref.brand, ref.version);
  const kw = (v: unknown) => (typeof v === "number" ? `${v} kW` : "");
  const out: PackModel[] = [];
  for (const u of pack.indoor_units) out.push({ model: u.model, section: "Indoor", label: [u.form_factor, kw(u.capacity_cool_kw)].filter(Boolean).join(", ") });
  for (const u of pack.outdoor_units) out.push({ model: u.model, section: "Outdoor", label: [u.series, kw(u.capacity_cool_kw)].filter(Boolean).join(", ") });
  for (const a of pack.accessories) out.push({ model: a.model, section: "Accessory", label: a.description ?? "" });
  for (const p of pack.parts) out.push({ model: p.model, section: "Part", label: p.part_type.replace(/-/g, " ") });
  return out;
}

export async function readDecisions(orgId: string): Promise<Map<string, Decision>> {
  const { data } = await supabaseAdmin.from("quote_code_links").select("model, code, decision").eq("org_id", orgId);
  return new Map(
    ((data ?? []) as { model: string; code: string; decision: string }[])
      .filter((r) => r.decision === "confirmed" || r.decision === "rejected")
      .map((r) => [`${r.model}|${r.code}`, r.decision as Decision])
  );
}

export async function decideLink(orgId: string, userId: string, model: string, code: string, decision: Decision) {
  const { error } = await supabaseAdmin
    .from("quote_code_links")
    .upsert(
      { org_id: orgId, model, code, decision, decided_by: userId, decided_at: new Date().toISOString() },
      { onConflict: "org_id,model,code" }
    );
  return !error;
}

export type PricedLink = ModelLink & PackModel & {
  /** every supplier's price through the linked codes, cheapest first */
  offers: Offer[];
  cheapest: Offer | null;
  savesCents: number | null;
  /** for a near match: each proposed code's prices, so the person can see
      what they're confirming */
  proposedOffers: Record<string, Offer[]>;
  /** what the linked order code says about the unit, in a client's words */
  features: string[];
};

function offersFor(codes: string[], items: BookItem[], suppliers: Awaited<ReturnType<typeof readSuppliers>>): Offer[] {
  const sup = new Map(suppliers.map((s) => [s.key, s]));
  const out: Offer[] = [];
  for (const i of items) {
    const s = codes.includes(i.code) ? sup.get(i.supplierKey) : undefined;
    if (!s) continue;
    const net = netCents(s, i.code, i.cents);
    /* $0.00 is an item nobody priced, not a free one */
    if (net > 0) out.push({ supplierKey: s.key, supplierName: s.name, code: i.code, name: i.name, netCents: net, pricedOn: i.pricedOn });
  }
  return out;
}

/** Every pack model with its links and prices. */
export async function pricedLinks(orgId: string): Promise<PricedLink[]> {
  const [models, items, suppliers, decisions] = await Promise.all([
    packModels(),
    currentItems(orgId),
    readSuppliers(orgId),
    readDecisions(orgId),
  ]);
  const links = linkModels(
    models.map((m) => m.model),
    items.map((i) => i.code),
    decisions
  );
  return links.map((l, n) => {
    const offers = offersFor(l.codes, items, suppliers);
    const cmp = compareOffers(offers);
    return {
      ...models[n]!,
      ...l,
      ...cmp,
      proposedOffers: Object.fromEntries(l.proposed.map((c) => [c, offersFor([c], items, suppliers)])),
      features: l.codes[0] ? codeFeatures(l.codes[0]) : [],
    };
  });
}
