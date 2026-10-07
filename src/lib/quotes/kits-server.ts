import "server-only";
import { bookProducts } from "./book-view-server";
import { expandKit, pipeFromMm, type KitFacts, type KitKey } from "./kits";
import { addLine } from "./lines-server";
import { lookupUnit } from "./lookups-server";

/* A kit added to a quote in one press (kits.ts): its facts filled from the
   outdoor's data pack where the person named one and left them blank, each
   part picked from the business's own book, each added as its own line and
   kept in the quote's history like any other. */

export async function addKit(
  orgId: string,
  jobUuid: string,
  kit: KitKey,
  facts: KitFacts,
  at: { optionIndex: number; system: string },
  unit: { brand: string; model: string } | null,
  by: string
): Promise<{ ok: true; added: number } | { ok: false; reason: string }> {
  const f = { ...facts };
  if (unit) {
    const u = await lookupUnit(unit.brand, unit.model);
    if (u.found && u.specs.role === "outdoor") {
      if (!f.pipe && u.specs.pipeMm) f.pipe = pipeFromMm(u.specs.pipeMm.liquid, u.specs.pipeMm.gas);
      if (f.amps == null) f.amps = u.specs.mcaAmps ?? u.specs.maxAmps;
    }
  }
  const lines = expandKit(kit, f, await bookProducts(orgId), at);
  let added = 0;
  for (const l of lines) {
    const r = await addLine(orgId, jobUuid, l, by, `${kit === "split" ? "Split" : "Ducted"} kit`);
    if (r.ok) added++;
  }
  return added > 0 ? { ok: true, added } : { ok: false, reason: "The kit couldn't be added. Try again." };
}
