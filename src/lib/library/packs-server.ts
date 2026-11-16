import "server-only";
import { installedPacks, loadInstalledPack } from "@/lib/studio/packs/server";
import { loadPackWithOverrides } from "@/lib/studio/packs/overrides-server";
import type { DataPack } from "@/lib/studio/packs/schema";
import { packUnits, type PackUnit } from "./data-pack";

/* THE PACKS THE LIBRARY READS: the newest installed pack of every brand,
   WITH HQ'S CORRECTIONS ON, as Design reads them (quotes/design-read-server's
   studioPack): a figure fixed in HQ reads the same here as in a design. Kept
   for five minutes, so a correction shows within that; a pack whose
   corrections can't be read is read without them rather than not at all.
   The model search and Data pack both read these. */

const KEEP_MS = 5 * 60 * 1000;
let packs: Promise<DataPack[]> | null = null;
let units: Promise<PackUnit[]> | null = null;
let readAt = 0;

export function libraryPacks(): Promise<DataPack[]> {
  if (packs && Date.now() - readAt > KEEP_MS) {
    packs = null;
    units = null;
  }
  if (!packs) readAt = Date.now();
  packs ??= (async () => {
    const refs = await installedPacks();
    const newest = new Map<string, (typeof refs)[number]>();
    for (const r of refs) {
      const was = newest.get(r.brand);
      if (!was || r.version.localeCompare(was.version) > 0) newest.set(r.brand, r);
    }
    const loaded = await Promise.all(
      [...newest.values()].map((r) =>
        loadPackWithOverrides(r.brand, r.version)
          .then((p) => p.pack)
          .catch(() =>
            loadInstalledPack(r.brand, r.version)
              .then((p) => p.pack)
              .catch(() => null),
          ),
      ),
    );
    return loaded.filter((p): p is DataPack => p !== null);
  })().catch((e) => {
    packs = null;
    units = null;
    throw e;
  });
  return packs;
}

/** Every unit in those packs, as Data pack lists them. */
export function libraryUnits(): Promise<PackUnit[]> {
  const from = libraryPacks();
  units ??= from.then(packUnits).catch((e) => {
    units = null;
    throw e;
  });
  return units;
}
