import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { priceBuildUp, type BuildUp } from "./buildup";
import { buildSettingsOf, type BuildUnset } from "./build-settings";
import { labourVisits, priceJobList, type ComponentPrice, type ListRow, type Unpriced, type UnitOffer } from "./job-price";
import { pricedLinks, readUnitChoices } from "./links-server";
import { readOrgDay } from "./org-day-server";
import { currentItems, readSameDecisions, readSuppliers } from "./price-book-server";
import { makePriceOf } from "./price-resolver";
import { readPreferred } from "./book-view-server";
import { readQuoteLabour } from "./quote-labour-server";
import { componentShortlists, readQuoteSettings } from "./settings-query";
import { rollMetresOf } from "./components";

/* A JOB'S QUOTE, PRICED — the job's own Materials list and labour at this
   business's own prices, markups and day (job-price.ts says how a row finds
   its price; build-settings.ts what it's built on). Every read is this
   org's. Buy prices are the business's money: the route gates on
   `financials`. Service role. */

export type QuotePrice =
  | { ok: false; unset: BuildUnset[] }
  | { ok: true; build: BuildUp; unpriced: Unpriced[]; labourFrom: "brief" | "history" | "none"; rows: number };

export async function readQuotePrice(orgId: string, jobUuid: string): Promise<QuotePrice> {
  const [settings, day] = await Promise.all([readQuoteSettings(orgId), readOrgDay(orgId)]);
  const built = buildSettingsOf(settings, day);
  if (!built.ok) return { ok: false, unset: built.unset };

  const { data } = await supabaseAdmin
    .from("job_picklist_items")
    .select("name, sub, qty")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .eq("kind", "material")
    .order("position", { ascending: true });
  const rows = (data ?? []) as ListRow[];

  /* the book read once, for the units, the parts and the codes alike */
  const [suppliers, book, same, choices, preferred] = await Promise.all([
    readSuppliers(orgId),
    rows.length ? currentItems(orgId) : Promise.resolve([]),
    readSameDecisions(orgId),
    readUnitChoices(orgId),
    readPreferred(orgId),
  ]);
  const [links, shortlists, labour] = await Promise.all([
    rows.length ? pricedLinks(orgId, { items: book, suppliers }) : Promise.resolve([]),
    rows.length ? componentShortlists(orgId, settings, suppliers, { book, same, preferred }) : Promise.resolve([]),
    readQuoteLabour(orgId, jobUuid, { money: true }),
  ]);
  const priceOf = makePriceOf({ items: book, suppliers, confirmed: same.confirmed, chosenSupplier: choices, preferred });

  const byModel = new Map(links.map((l) => [l.model, l]));
  const unitProposed = (model: string) => byModel.get(model)?.proposed ?? [];
  const unitOffer = (model: string): UnitOffer | null => {
    const link = byModel.get(model);
    if (!link || link.offers.length === 0) return null;
    const want = choices.get(model);
    const o =
      (want && link.offers.find((x) => x.supplierKey === want)) ||
      link.offers.find((x) => preferred.has(`${x.supplierKey}|${x.code}`)) ||
      link.cheapest;
    return o ? { buyCents: o.netCents, supplierKey: o.supplierKey, name: o.name, code: o.code } : null;
  };
  const chosen = new Map(shortlists.map((c) => [c.key, c.chosen]));
  const component = (key: Parameters<typeof chosen.get>[0]): ComponentPrice | null => {
    const c = chosen.get(key);
    if (!c || c.offer.perUnitCents == null) return null;
    return {
      perUnitCents: c.offer.perUnitCents,
      supplierKey: c.offer.supplierKey,
      code: c.offer.code,
      name: c.group.name,
      lengthM: c.group.rollM ?? rollMetresOf(c.group.name),
    };
  };

  const { lines, unpriced } = priceJobList(rows, { priceOf, unitOffer, unitProposed, component, allowance: (k) => settings.allowances[k] });
  const { visits, from } = labour ? labourVisits(labour.advice, built.settings.dayHours) : { visits: [], from: "none" as const };
  return { ok: true, build: priceBuildUp(lines, visits, built.settings), unpriced, labourFrom: from, rows: rows.length };
}
