import { requireHqPage } from "@/lib/hq/guard";
import { latestPackRefs } from "@/lib/hq/packs";
import { loadInstalledPack } from "@/lib/studio/packs/server";
import { fetchOverrides } from "@/lib/studio/packs/overrides-server";
import { buildCatalogView, catalogKpis } from "@/lib/hq/catalog";
import { HqBrandCards, type BrandCardData } from "@/components/hq/brand-cards";

/* HQ universal-table landing — one card per installed brand pack; clicking
   drills into /hq/data/[brand] (system types → series → units). Read at
   request time so counts reflect fresh overrides. */

export const dynamic = "force-dynamic";

export default async function HqDataPage() {
  await requireHqPage();

  const refs = await latestPackRefs();
  const brands: BrandCardData[] = await Promise.all(
    refs.map(async (r) => {
      const [{ pack }, overrides] = await Promise.all([
        loadInstalledPack(r.brand, r.version),
        fetchOverrides(r.brand),
      ]);
      const view = buildCatalogView(pack, overrides, {
        brand: r.brand,
        version: r.version,
      });
      const kpis = catalogKpis(view);
      return {
        brand: r.brand,
        name: pack.brands[0]?.name ?? r.brand,
        packName: r.meta.name,
        version: r.version,
        idu: view.indoor.length,
        odu: view.outdoor.length,
        pairs: view.pairs.length,
        readyPct: kpis.readyPct,
        blockingGaps: kpis.blockingGaps,
        validationErrors: view.validationErrors.length,
        orphans: view.orphans.length,
      };
    })
  );

  return (
    <main className="hq-main">
      <h1 className="hq-h1">Universal data table</h1>
      <p className="hq-lede">
        Pick a brand pack to browse its catalog by system type and series — and
        fill the gaps the engine is waiting on.
      </p>
      <HqBrandCards brands={brands} />
    </main>
  );
}
