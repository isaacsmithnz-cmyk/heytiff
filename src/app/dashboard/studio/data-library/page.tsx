import { installedPacks, loadInstalledPack } from "@/lib/studio/packs/server";
import { DataLibrary, type PackView } from "@/components/studio/data-library";

/* Data Library — read-only view of the installed data packs (the universal
   table). Any authenticated dashboard user may VIEW it; the future PDF-upload /
   edit surface will be admin-gated (universal-table-schema.md — Data Library).
   Read at request time so a freshly-extracted pack shows without a redeploy. */

export const dynamic = "force-dynamic";

export default async function DataLibraryPage() {
  const refs = await installedPacks();
  const results = await Promise.allSettled(
    refs.map((r) => loadInstalledPack(r.brand, r.version))
  );

  const packs: PackView[] = [];
  const failed: { brand: string; version: string; message: string }[] = [];
  results.forEach((res, i) => {
    if (res.status === "fulfilled") packs.push(res.value);
    else
      failed.push({
        brand: refs[i].brand,
        version: refs[i].version,
        message: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
  });

  return <DataLibrary packs={packs} failed={failed} />;
}
