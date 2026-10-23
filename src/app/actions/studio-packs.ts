"use server";

import { requireOrg } from "@/lib/permissions-server";
import { latestInstalledPack } from "@/lib/studio/packs/server";
import { loadPackWithOverrides } from "@/lib/studio/packs/overrides-server";
import type { DataPack } from "@/lib/studio/packs/schema";

/* Design Studio — data packs for the client (Stage 4).
   The studio is a client component; packs live on the server's disk. This
   returns the resolved, validated pack for a brand so the split module can
   propose pairs and price materials. Gated on `studio` like every server
   function the studio calls (reachable by direct POST). */

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
