"use server";

import { auth0 } from "@/lib/auth0";
import { installedPacks, latestInstalledPack } from "@/lib/studio/packs/server";
import { loadPackWithOverrides } from "@/lib/studio/packs/overrides-server";
import type { DataPack } from "@/lib/studio/packs/schema";

/* Design Studio — data packs for the client (Stage 4).
   The studio is a client component; packs live on the server's disk. This
   returns the resolved, validated pack for a brand so the split module can
   propose pairs and price materials. Session-checked like every server
   function (reachable by direct POST). */

export async function loadStudioPack(
  brand: string
): Promise<{ pack: DataPack; version: string } | null> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");

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
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const refs = await installedPacks();
  return refs.map((r) => ({ brand: r.brand, version: r.version, name: r.meta.name }));
}
