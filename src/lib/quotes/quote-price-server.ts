import "server-only";
import { priceBuildUp, type BuildUp } from "./buildup";
import { buildSettingsOf, type BuildUnset } from "./build-settings";
import { labourVisits, priceJobList, type ComponentPrice, type ListRow, type Unpriced, type UnitOffer } from "./job-price";
import { pricedLinks, readUnitChoices } from "./links-server";
import { readOrgDay } from "./org-day-server";
import { currentItems, readPreferred, readSameDecisions, readSuppliers } from "./price-book-server";
import { recordQuoteItems } from "./book-view-server";
import { makePriceOf } from "./price-resolver";
import { readQuoteLabour } from "./quote-labour-server";
import { componentShortlists, readQuoteSettings } from "./settings-query";
import { rangeOffersFrom, readRanges } from "./ranges-server";
import { rollMetresOf } from "./components";
import { optionMaterials } from "./option-materials";
import type { RangeKind } from "./ranges";
import type { AllowanceKey } from "./settings";
import { readStoredProposal } from "./proposal-writer";
import { latestInstalledPack, loadInstalledPack } from "@/lib/studio/packs/server";

/* A JOB'S QUOTE, PRICED, OPTION BY OPTION — each option's own materials
   (option-materials.ts: its units and the site checklist, through the
   Rooms engine's kits) and the labour, at this business's own prices,
   markups and day (job-price.ts says how a row finds its price;
   build-settings.ts what it's built on). Two options are two quotes on one
   page (Isaac, 2026-10-05). Every read is this org's. Buy prices are the
   business's money: the route gates on `financials`. Service role. */

const PACK_BRAND = "mitsubishi-electric";

export type OptionPrice = { name: string; build: BuildUp; unpriced: Unpriced[]; rows: number };

export type QuotePrice =
  | { ok: false; unset: BuildUnset[] }
  | { ok: true; options: OptionPrice[]; labourFrom: "brief" | "history" | "none" };

export async function readQuotePrice(orgId: string, jobUuid: string): Promise<QuotePrice> {
  const [settings, day] = await Promise.all([readQuoteSettings(orgId), readOrgDay(orgId)]);
  const built = buildSettingsOf(settings, day);
  if (!built.ok) return { ok: false, unset: built.unset };

  const [proposal, ref] = await Promise.all([readStoredProposal(orgId, jobUuid).catch(() => null), latestInstalledPack(PACK_BRAND)]);
  const pack = ref ? (await loadInstalledPack(ref.brand, ref.version)).pack : null;
  const lists: { name: string; rows: ListRow[] }[] = (proposal?.draft.options ?? []).map((o) => ({
    name: o.name,
    rows: optionMaterials(o, proposal!.draft.checklist, pack),
  }));
  const rows = lists.flatMap((l) => l.rows);

  /* the book read once, for the units, the parts and the codes alike */
  const [suppliers, book, same, choices, preferred, rangeRows] = await Promise.all([
    readSuppliers(orgId),
    rows.length ? currentItems(orgId) : Promise.resolve([]),
    readSameDecisions(orgId),
    readUnitChoices(orgId),
    readPreferred(orgId),
    rows.length ? readRanges(orgId) : Promise.resolve([]),
  ]);
  const [links, shortlists, labour] = await Promise.all([
    rows.length ? pricedLinks(orgId, { items: book, suppliers }) : Promise.resolve([]),
    rows.length ? componentShortlists(orgId, settings, suppliers, { book, same, preferred }) : Promise.resolve([]),
    readQuoteLabour(orgId, jobUuid, { money: true }),
  ]);
  const priceOf = makePriceOf({ items: book, suppliers, confirmed: same.confirmed, chosenSupplier: choices, preferred });

  const byModel = new Map(links.map((l) => [l.model, l]));
  /* a near unit by its newest code, once whatever its revisions */
  const unitProposed = (model: string) => (byModel.get(model)?.proposals ?? []).map((p) => p.codes[0]!);
  const unitOffer = (model: string): UnitOffer | null => {
    const link = byModel.get(model);
    if (!link || link.offers.length === 0) return null;
    const want = choices.get(model);
    const own = (want && link.offers.find((x) => x.supplierKey === want)) || link.offers.find((x) => preferred.has(`${x.supplierKey}|${x.code}`));
    const o = own || link.cheapest;
    return o ? { buyCents: o.netCents, supplierKey: o.supplierKey, supplierName: o.supplierName, name: o.name, code: o.code, chosen: !!own } : null;
  };
  /* every supplier's price for a model, so a system's units come from one */
  const unitOffers = (model: string): UnitOffer[] =>
    (byModel.get(model)?.offers ?? []).map((o) => ({ buyCents: o.netCents, supplierKey: o.supplierKey, supplierName: o.supplierName, name: o.name, code: o.code }));
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

  /* the business's ranges that come in sizes, at today's prices */
  const ranges = rangeOffersFrom(rangeRows, book, suppliers);
  const deps = {
    priceOf,
    unitOffer,
    unitOffers,
    unitProposed,
    component,
    allowance: (k: AllowanceKey) => settings.allowances[k],
    range: (kind: RangeKind) => ranges.get(kind) ?? [],
  };
  /* the job's labour, on each option until an option carries its own */
  const { visits, from } = labour ? labourVisits(labour.advice, built.settings.dayHours) : { visits: [], from: "none" as const };
  const options = lists.map((l) => {
    const { lines, unpriced } = priceJobList(l.rows, deps);
    return { name: l.name, lines, build: priceBuildUp(lines, visits, built.settings), unpriced, rows: l.rows.length };
  });
  /* what this quote pulled from the price book, for the price book's Most used */
  if (lists.length > 0) await recordQuoteItems(orgId, jobUuid, options.flatMap((o) => o.lines));
  return { ok: true, labourFrom: from, options: options.map(({ lines: _lines, ...o }) => o) };
}
