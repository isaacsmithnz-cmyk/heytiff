import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { bookProducts } from "@/lib/quotes/book-view-server";
import { readRangeOffers } from "@/lib/quotes/kits-server";
import { indoorFacts, kitPreview, pipeFromMm, type KitFacts } from "@/lib/quotes/kits";
import { lookupUnit } from "@/lib/quotes/lookups-server";
import { readQuoteSettings } from "@/lib/quotes/settings-query";
import { installedPacks } from "@/lib/studio/packs/server";

/* QUOTING'S KITS, PART BY PART (Isaac's kits, round 2, 2026-10-11): a kit
   priced at the business's own example — the unit it names, its outlets —
   with every item of each part's kind in its book under it (kits.ts
   kitPreview). Nothing of anyone else's: no example until the business
   gives one, and a part that needs the unit says so. `financials`, like the
   rest of the price book. */

const OUTLET_MM = new Set([150, 200, 250, 300, 350, 400]);

export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("financials"))) return Response.json({ ok: false, reason: "Kits need money access." }, { status: 403 });
  const p = new URL(req.url).searchParams;
  const kit = p.get("kit") === "split" ? "split" : "ducted";
  const brand = (p.get("brand") ?? "").trim().slice(0, 60);
  const model = (p.get("model") ?? "").trim().slice(0, 60);
  const outlets = Math.max(0, Math.min(40, Math.round(Number(p.get("outlets")) || 0)));
  const outletMm = Number(p.get("outletMm"));
  /* an example's runs are a metre each: a part by the metre shows its price a metre */
  const f: KitFacts = {
    pipe: null,
    pipeM: 1,
    powerM: 1,
    amps: null,
    mount: p.get("mount") === "wall" ? "wall" : "ground",
    trunkingM: 2.4,
    drainM: 1,
    outlets: outlets || null,
    outletMm: OUTLET_MM.has(outletMm) ? outletMm : null,
    underfloor: p.get("underfloor") === "1",
  };
  let unit: { model: string; role: "indoor" | "outdoor"; coolKw: number | null } | null = null;
  if (brand && model) {
    const u = await lookupUnit(brand, model, orgId);
    if (u.found) {
      unit = { model: u.specs.model, role: u.specs.role, coolKw: u.specs.coolKw };
      if (u.specs.role === "outdoor") {
        if (u.specs.pipeMm) f.pipe = pipeFromMm(u.specs.pipeMm.liquid, u.specs.pipeMm.gas);
        f.amps = u.specs.mcaAmps ?? u.specs.maxAmps;
        f.breakerA = u.specs.breakerA ?? null;
        f.cableMm2 = u.specs.minCableMm2 ?? null;
        f.phase = u.specs.phase === "3" ? "3" : u.specs.phase === "1" ? "1" : null;
      } else Object.assign(f, indoorFacts(u.specs));
    }
  }
  const [products, settings, ranges, packs] = await Promise.all([bookProducts(orgId), readQuoteSettings(orgId), readRangeOffers(orgId), installedPacks().catch(() => [])]);
  const preview = kitPreview(kit, f, products, { ranges, components: settings.preferred, suppliers: settings.groupSuppliers });
  /* the makers whose data packs the example's unit can come from */
  const brands = [...new Set(packs.map((x) => x.brand))];
  return Response.json({ ok: true, kit, unit, brands, ...preview });
}
