import { supabaseAdmin } from "@/lib/supabase-server";
import { latestInstalledPack, loadInstalledPack } from "@/lib/studio/packs/server";
import { linkModels, type Decision, type ModelLink, type Proposal } from "./code-links";
import { unitFeatures } from "./features";
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

/** A person's answers on near matches, all at once: a unit's every code,
    or a whole group of units. */
export async function decideLinks(orgId: string, userId: string, answers: readonly { model: string; code: string; decision: Decision }[]) {
  if (answers.length === 0) return true;
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("quote_code_links").upsert(
    answers.map((a) => ({ org_id: orgId, model: a.model, code: a.code, decision: a.decision, decided_by: userId, decided_at: now })),
    { onConflict: "org_id,model,code" }
  );
  return !error;
}

/** A near unit with every supplier's price for it, so the person can see
    what they're confirming. */
export type ProposalView = Proposal & { offers: Offer[] };

export type PricedLink = Omit<ModelLink, "proposals"> & PackModel & {
  /** every supplier's price through the linked codes, cheapest first */
  offers: Offer[];
  cheapest: Offer | null;
  savesCents: number | null;
  /** the near units waiting for a person, one decision each */
  proposals: ProposalView[];
  /** what the linked order code says about the unit, in a client's words */
  features: string[];
};

function offersFor(codes: string[], items: BookItem[], suppliers: Awaited<ReturnType<typeof readSuppliers>>): Offer[] {
  const sup = new Map(suppliers.map((s) => [s.key, s]));
  const out: Offer[] = [];
  for (const i of items) {
    const s = codes.includes(i.code) ? sup.get(i.supplierKey) : undefined;
    if (!s) continue;
    const net = netCents(s, i.code, i.cents, i.net);
    /* $0.00 is an item nobody priced, not a free one */
    if (net > 0) out.push({ supplierKey: s.key, supplierName: s.name, code: i.code, name: i.name, netCents: net, pricedOn: i.pricedOn });
  }
  return out;
}

/** Every pack model with its links and prices. */
export async function pricedLinks(
  orgId: string,
  /** the book and suppliers, when the caller has read them */
  pre?: { items: BookItem[]; suppliers: Awaited<ReturnType<typeof readSuppliers>> }
): Promise<PricedLink[]> {
  const [models, items, suppliers, decisions] = await Promise.all([
    packModels(),
    pre ? Promise.resolve(pre.items) : currentItems(orgId),
    pre ? Promise.resolve(pre.suppliers) : readSuppliers(orgId),
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
      proposals: l.proposals.map((p) => ({ ...p, offers: offersFor(p.codes, items, suppliers).sort((a, b) => a.netCents - b.netCents) })),
      features: l.codes[0] ? unitFeatures(items.find((i) => i.code === l.codes[0])?.name ?? "", l.codes[0]) : [],
    };
  });
}

/** Units a person chose to buy from a supplier other than the lowest. */
export async function readUnitChoices(orgId: string): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin.from("quote_unit_choices").select("model, supplier_key").eq("org_id", orgId);
  return new Map(((data ?? []) as { model: string; supplier_key: string }[]).map((r) => [r.model, r.supplier_key]));
}

/** Override a unit's supplier, or (null) go back to the lowest. */
export async function chooseUnitSupplier(orgId: string, userId: string, model: string, supplierKey: string | null) {
  const q = supabaseAdmin.from("quote_unit_choices");
  const { error } =
    supplierKey === null
      ? await q.delete().eq("org_id", orgId).eq("model", model)
      : await q.upsert(
          { org_id: orgId, model, supplier_key: supplierKey, decided_by: userId, decided_at: new Date().toISOString() },
          { onConflict: "org_id,model" }
        );
  return !error;
}

