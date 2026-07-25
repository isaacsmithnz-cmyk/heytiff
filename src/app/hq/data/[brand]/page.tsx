import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHqPage } from "@/lib/hq/guard";
import { latestPackRef } from "@/lib/hq/packs";
import { supabaseAdmin } from "@/lib/supabase-server";
import { loadInstalledPack } from "@/lib/studio/packs/server";
import { fetchOverrides } from "@/lib/studio/packs/overrides-server";
import { buildCatalogView } from "@/lib/hq/catalog";
import { groupBrandCatalog } from "@/lib/hq/grouping";
import { packWatchSignals } from "@/lib/hq/watchlist";
import { HqBrandCatalog } from "@/components/hq/brand-catalog";
import { WatchlistPanel, type WatchItem } from "@/components/hq/watchlist-panel";
import { saveOverride, clearOverride } from "@/app/actions/hq-overrides";
import { addWatchItem, resolveWatchItem } from "@/app/actions/hq-watchlist";

/* Brand drill-down — system types → form factors → series → editable unit
   rows. The [brand] segment is matched against the enumerated installs (never
   path-joined), so unknown brands 404 and traversal is impossible. */

export const dynamic = "force-dynamic";

export default async function HqBrandPage({
  params,
}: {
  params: Promise<{ brand: string }>;
}) {
  await requireHqPage();
  const { brand: raw } = await params;
  const ref = await latestPackRef(decodeURIComponent(raw));
  if (!ref) notFound();

  const [{ pack }, overrides, watchRes] = await Promise.all([
    loadInstalledPack(ref.brand, ref.version),
    fetchOverrides(ref.brand),
    supabaseAdmin
      .from("pack_watchlist")
      .select("id, item, context, added_by, added_at")
      .eq("brand", ref.brand)
      .is("resolved_at", null)
      .order("added_at", { ascending: false }),
  ]);
  const view = buildCatalogView(pack, overrides, {
    brand: ref.brand,
    version: ref.version,
  });
  const groups = groupBrandCatalog(view);
  const displayName = pack.brands[0]?.name ?? ref.brand;
  const signals = packWatchSignals(pack);
  const watchItems: WatchItem[] = (watchRes.data ?? []).map((r) => ({
    id: r.id,
    item: r.item,
    context: r.context,
    addedBy: r.added_by,
    addedAt: r.added_at,
  }));

  return (
    <main className="hq-main">
      <Link className="hq-back" href="/hq/data">
        ← Data packs
      </Link>
      <h1 className="hq-h1">{displayName}</h1>
      <p className="hq-lede">
        {ref.version} · {ref.meta.name}
      </p>

      {view.orphans.length > 0 ? (
        <div className="hq-warn">
          <b>{view.orphans.length}</b> stale override
          {view.orphans.length === 1 ? "" : "s"} no longer match a catalog row
          (likely a renamed/removed model):{" "}
          {view.orphans.map((o) => `${o.rowKey}·${o.field}`).join(", ")}
        </div>
      ) : null}

      {view.validationErrors.length > 0 ? (
        <div className="hq-warn error">
          <b>{view.validationErrors.length}</b> pack validation error
          {view.validationErrors.length === 1 ? "" : "s"}:{" "}
          {view.validationErrors
            .slice(0, 3)
            .map((e) => `${e.row} — ${e.message}`)
            .join("; ")}
          {view.validationErrors.length > 3 ? " …" : ""}
        </div>
      ) : null}

      <WatchlistPanel
        signals={signals}
        items={watchItems}
        onAdd={addWatchItem.bind(null, ref.brand)}
        onResolve={resolveWatchItem}
      />

      <HqBrandCatalog
        groups={groups}
        onSave={saveOverride.bind(null, ref.brand)}
        onClear={clearOverride.bind(null, ref.brand)}
      />
    </main>
  );
}
