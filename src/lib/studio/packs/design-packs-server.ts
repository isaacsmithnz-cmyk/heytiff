import { latestInstalledPack } from "./server";
import { loadPackWithOverrides } from "./overrides-server";
import { designBrands, joinPacks } from "./merge";
import type { DesignDocument } from "../document";
import type { DataPack } from "./schema";

/* THE PACKS A DESIGN NAMES, ON THE SERVER: the newest installed edition of
   each brand its systems are built in, with HQ's corrections, as one pack
   (merge.ts). The print page, the live link and anything else that reads a
   saved design go through here, so a Daikin design is read off Daikin's
   pack. A brand that fails to load is left out: the plan still draws. */

export async function loadBrandPack(brand: string): Promise<{ pack: DataPack; version: string } | null> {
  const latest = await latestInstalledPack(brand);
  if (!latest) return null;
  const { pack } = await loadPackWithOverrides(brand, latest.version);
  return { pack, version: latest.version };
}

export async function loadDesignPack(docs: readonly Pick<DesignDocument, "systems">[]): Promise<DataPack | null> {
  const brands: string[] = [];
  for (const d of docs) for (const b of designBrands(d)) if (!brands.includes(b)) brands.push(b);
  const loaded = await Promise.allSettled(brands.map(loadBrandPack));
  const packs: DataPack[] = [];
  for (const r of loaded) if (r.status === "fulfilled" && r.value) packs.push(r.value.pack);
  return joinPacks(packs);
}
