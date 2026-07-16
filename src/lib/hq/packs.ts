import { installedPacks, type InstalledPackRef } from "@/lib/studio/packs/server";

/* Latest-installed-pack resolution, centralised so the HQ pages and the
   override actions can never resolve different versions for the same brand.

   Version ordering is plain localeCompare — this mis-sorts "2026.10" below
   "2026.9", but that caveat pre-exists at every historical call site and only
   one version per brand is installed today. Fix here (numeric-aware compare)
   when a second version lands. */

/** The newest installed pack per brand. */
export async function latestPackRefs(baseDir?: string): Promise<InstalledPackRef[]> {
  const refs = await installedPacks(baseDir);
  const byBrand = new Map<string, InstalledPackRef>();
  for (const r of refs) {
    const cur = byBrand.get(r.brand);
    if (!cur || r.version.localeCompare(cur.version) > 0) byBrand.set(r.brand, r);
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
