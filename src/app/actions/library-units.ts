"use server";

import { can } from "@/lib/permissions-server";
import { libraryPacks, libraryUnits } from "@/lib/library/packs-server";
import { combine, type Combined } from "@/lib/library/data-pack";
import { matchUnits, type UnitSpec } from "@/lib/library/unit-specs";

/* THE LIBRARY'S MODEL SEARCH (lib/library/unit-specs) over the packs the
   Library reads (lib/library/packs-server), and Data pack's Combine, which
   asks the Studio's own check on the server where the packs are. Reading the
   Library is the gate (`tiff`). */

export async function findUnits(query: string): Promise<{ ok: true; units: UnitSpec[] } | { ok: false; error: string }> {
  if (!(await can("tiff"))) return { ok: false, error: "The Library isn't open to you." };
  try {
    return { ok: true, units: matchUnits(await libraryPacks(), String(query ?? "").slice(0, 60)) };
  } catch {
    return { ok: false, error: "The model list couldn't be read." };
  }
}

/** Data pack's Combine: an outdoor and the heads chosen for it, checked as the system builder checks them. */
export async function combineUnits(
  outdoor: string,
  heads: string[],
): Promise<{ ok: true; combined: Combined } | { ok: false; error: string }> {
  if (!(await can("tiff"))) return { ok: false, error: "The Library isn't open to you." };
  try {
    const [packs, units] = await Promise.all([libraryPacks(), libraryUnits()]);
    const combined = combine(packs, units, String(outdoor ?? ""), (Array.isArray(heads) ? heads : []).slice(0, 16).map(String));
    return combined ? { ok: true, combined } : { ok: false, error: "That outdoor unit isn't in the data packs." };
  } catch {
    return { ok: false, error: "The data packs couldn't be read." };
  }
}
