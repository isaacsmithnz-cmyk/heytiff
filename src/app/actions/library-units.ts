"use server";

import { can } from "@/lib/permissions-server";
import { installedPacks, loadInstalledPack } from "@/lib/studio/packs/server";
import type { DataPack } from "@/lib/studio/packs/schema";
import { matchUnits, type UnitSpec } from "@/lib/library/unit-specs";

/* THE LIBRARY'S MODEL SEARCH (lib/library/unit-specs): the newest installed
   pack of every brand, read once per server and kept, then searched. Packs
   are files that ship with the app, so a deploy is the only thing that
   changes them. Reading the Library is the gate (`tiff`). */

let packs: Promise<DataPack[]> | null = null;

function loadPacks(): Promise<DataPack[]> {
  packs ??= (async () => {
    const refs = await installedPacks();
    const newest = new Map<string, (typeof refs)[number]>();
    for (const r of refs) {
      const was = newest.get(r.brand);
      if (!was || r.version.localeCompare(was.version) > 0) newest.set(r.brand, r);
    }
    const loaded = await Promise.all(
      [...newest.values()].map((r) =>
        loadInstalledPack(r.brand, r.version)
          .then((p) => p.pack)
          .catch(() => null),
      ),
    );
    return loaded.filter((p): p is DataPack => p !== null);
  })().catch((e) => {
    packs = null;
    throw e;
  });
  return packs;
}

export async function findUnits(query: string): Promise<{ ok: true; units: UnitSpec[] } | { ok: false; error: string }> {
  if (!(await can("tiff"))) return { ok: false, error: "The Library isn't open to you." };
  try {
    return { ok: true, units: matchUnits(await loadPacks(), String(query ?? "").slice(0, 60)) };
  } catch {
    return { ok: false, error: "The model list couldn't be read." };
  }
}
