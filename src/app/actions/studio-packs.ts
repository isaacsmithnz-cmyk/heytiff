"use server";

import { auth0 } from "@/lib/auth0";
import { installedPacks, loadInstalledPack } from "@/lib/studio/packs/server";
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

  const refs = await installedPacks();
  // latest version for the brand (sorted lexically; versions are "2026.1" style)
  const mine = refs.filter((r) => r.brand === brand).sort((a, b) => b.version.localeCompare(a.version));
  if (mine.length === 0) return null;
  const { pack } = await loadInstalledPack(brand, mine[0].version);
  return { pack, version: mine[0].version };
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
