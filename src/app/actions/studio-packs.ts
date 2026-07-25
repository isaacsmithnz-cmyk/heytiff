"use server";

import { requireOrg } from "@/lib/permissions-server";
import { installedPacks, latestInstalledPack } from "@/lib/studio/packs/server";
import { loadPackWithOverrides } from "@/lib/studio/packs/overrides-server";
import type { DataPack } from "@/lib/studio/packs/schema";

/* Design Studio — data packs for the client (Stage 4).
   The studio is a client component; packs live on the server's disk. This
   returns the resolved, validated pack for a brand so the split module can
   propose pairs and price materials. Gated on `studio` like every server
   function the studio calls (reachable by direct POST). The Data Library
   PAGE stays open to any signed-in member by design — that read renders
   server-side and never comes through here. */

export async function loadStudioPack(
  brand: string
): Promise<{ pack: DataPack; version: string } | null> {
  await requireOrg("studio");

  const latest = await latestInstalledPack(brand);
  if (!latest) return null;
  // override-aware: HQ manual corrections feed the studio engine here.
  const { pack } = await loadPackWithOverrides(brand, latest.version);
  return { pack, version: latest.version };
}

/** Brands with an installed pack — drives the add-system brand picker. */
export async function listStudioPackBrands(): Promise<
  { brand: string; version: string; name: string }[]
> {
  await requireOrg("studio");
  const refs = await installedPacks();
  return refs.map((r) => ({ brand: r.brand, version: r.version, name: r.meta.name }));
}
