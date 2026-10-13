import { promises as fs } from "fs";
import path from "path";
import { installedPacks, type InstalledPackRef } from "@/lib/studio/packs/server";
import type { Brand } from "@/lib/studio/packs/schema";

/* Latest-installed-pack resolution, centralised so the HQ pages and the
   override actions can never resolve different versions for the same brand.

   Versions compare numerically ("2026.10" is newer than "2026.9"), so a
   second edition of a brand replaces the first everywhere HQ looks. */

function newer(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { numeric: true }) > 0;
}

/** The newest installed pack per brand, in brand-id order. */
export async function latestPackRefs(baseDir?: string): Promise<InstalledPackRef[]> {
  const refs = await installedPacks(baseDir);
  const byBrand = new Map<string, InstalledPackRef>();
  for (const r of refs) {
    const cur = byBrand.get(r.brand);
    if (!cur || newer(r.version, cur.version)) byBrand.set(r.brand, r);
  }
  return [...byBrand.values()];
}

/** The newest installed pack for one brand — matched by exact equality against
    the enumerated installs (never path-join a raw route segment). */
export async function latestPackRef(
  brand: string,
  baseDir?: string
): Promise<InstalledPackRef | null> {
  const refs = await latestPackRefs(baseDir);
  return refs.find((r) => r.brand === brand) ?? null;
}

/** brand id → the name its own pack gives it ("daikin" → "Daikin"), for the
    pages that list every brand's rows at once (the change log). Reads only
    each pack's brands.json, not the whole catalog; a pack whose row can't be
    read is left out and the caller falls back to the id. */
export async function brandNames(baseDir?: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await Promise.all(
    (await latestPackRefs(baseDir)).map(async (r) => {
      try {
        const rows = JSON.parse(
          await fs.readFile(path.join(r.dir, "brands.json"), "utf8")
        ) as Brand[];
        const own = rows.find((b) => b.id === r.brand)?.name;
        if (own) names.set(r.brand, own);
      } catch {
        /* no readable brands.json: the id stands in */
      }
    })
  );
  return names;
}
