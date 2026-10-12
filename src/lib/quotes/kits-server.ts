import "server-only";
import { bookProducts } from "./book-view-server";
import { expandKit, indoorFacts, pipeFromMm, stillToSize, type KitFacts, type KitKey } from "./kits";
import { addLine } from "./lines-server";
import { lookupUnit } from "./lookups-server";
import { readQuoteSettings } from "./settings-query";
import { readByHand } from "./lines-job-server";
import { rangeOffersFrom, readRanges } from "./ranges-server";
import { currentItemsByCode, readSuppliers } from "./price-book-server";
import type { RangeKind } from "./ranges";
import type { RangeOffer } from "./job-price";

/* A kit added to a quote in one press (kits.ts): its facts filled from the
   outdoor's data pack where the person named one and left them blank, each
   part picked from the business's own book, each added as its own line and
   kept in the quote's history like any other. */

/** The business's ranges at today's prices, for a kit to pick from. */
export async function readRangeOffers(orgId: string) {
  const [rows, suppliers] = await Promise.all([readRanges(orgId), readSuppliers(orgId)]);
  if (rows.length === 0) return new Map<RangeKind, RangeOffer[]>();
  return rangeOffersFrom(rows, await currentItemsByCode(orgId, rows.map((r) => r.code)), suppliers);
}

export async function addKit(
  orgId: string,
  jobUuid: string,
  kit: KitKey,
  facts: KitFacts,
  at: { optionIndex: number; system: string },
  unit: { brand: string; model: string } | null,
  by: string,
  /** ducted: the indoor, whose faces its plenums are made for */
  indoor: { brand: string; model: string } | null = null
): Promise<{ ok: true; added: number; still: { name: string; why: string }[] } | { ok: false; reason: string }> {
  const f = { ...facts };
  for (const which of [unit, indoor]) {
    if (!which) continue;
    const u = await lookupUnit(which.brand, which.model);
    if (u.found && u.specs.role === "outdoor") {
      if (!f.pipe && u.specs.pipeMm) f.pipe = pipeFromMm(u.specs.pipeMm.liquid, u.specs.pipeMm.gas);
      if (f.amps == null) f.amps = u.specs.mcaAmps ?? u.specs.maxAmps;
    }
    /* a ducted indoor: its plenums are made for its faces (kits, round 2) */
    if (u.found && u.specs.role === "indoor") Object.assign(f, indoorFacts(u.specs), f.supplyFace ? { supplyFace: f.supplyFace } : {});
  }
  const [products, settings, byHand, ranges] = await Promise.all([bookProducts(orgId), readQuoteSettings(orgId), readByHand(orgId, jobUuid), readRangeOffers(orgId)]);
  const a = settings.allowances;
  const lines = expandKit(kit, f, products, at, { consumables: a.consumables, flush: a.flush, recovery: a.recovery }, byHand.supplier, {
    ranges,
    components: settings.preferred,
  });
  let added = 0;
  for (const l of lines) {
    const r = await addLine(orgId, jobUuid, l, by, `${kit === "split" ? "Split" : "Ducted"} kit`);
    if (r.ok) added++;
  }
  return added > 0 ? { ok: true, added, still: stillToSize(lines) } : { ok: false, reason: "The kit couldn't be added. Try again." };
}
