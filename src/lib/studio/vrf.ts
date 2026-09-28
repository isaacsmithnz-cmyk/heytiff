/* VRF (docs/studio-vrf.md): one outdoor, City Multi heads, judged by the
   book's capacity INDEX, never by kW. The envelope is on the outdoor's own
   row (ratio_min_pct / ratio_max_pct / max_idus / idu_index_min-max, from
   the data book) and is checked with the same index_ratio_band arm a
   ratio-band multi uses, so the two can never disagree on what a band means.

   Pure functions over the pack. No React. The pipe tree, its sizes, its
   limits and the charge are later steps. */

import type { CompatibilityRule, DataPack, IndoorUnit, OutdoorUnit } from "./packs/schema";
import { indoorReadiness, outdoorReadiness } from "./packs/ready";
import { checkBlock, type MultiFinding } from "./multi";

type IndexBand = Extract<CompatibilityRule, { method: "index_ratio_band" }>;

/** the outdoor's connection envelope as a ratio band, or null when the book
    gives it none */
export function vrfBand(odu: OutdoorUnit): IndexBand | null {
  if (odu.ratio_min_pct == null || odu.ratio_max_pct == null || odu.max_idus == null) return null;
  return {
    method: "index_ratio_band",
    ratio_min_pct: odu.ratio_min_pct,
    ratio_max_pct: odu.ratio_max_pct,
    max_idus: odu.max_idus,
    index_min: odu.idu_index_min,
    index_max: odu.idu_index_max,
  };
}

/** a head a VRF outdoor can take (ready.ts "vrf-idu") */
export function isVrfHead(pack: DataPack, u: IndoorUnit): boolean {
  return indoorReadiness(pack, u).roles["vrf-idu"];
}

/** a set of heads where every one is VRF-only: a City Multi head has no
    split pairing and no multi role, so heads like these say "VRF" before
    any outdoor is picked */
export function allVrfOnly(heads: IndoorUnit[]): boolean {
  return (
    heads.length > 0 &&
    heads.every(
      (u) =>
        u.system_roles?.includes("vrf") && !u.system_roles.includes("split-pair") && !u.system_roles.includes("multi")
    )
  );
}

/** every finding on this outdoor with these heads: a head that is not a VRF
    head is red, then the envelope (over the unit count, a unit outside the
    index band, over the ratio: red; under the ratio: amber, more zones may
    come) */
export function checkVrfSet(pack: DataPack, odu: OutdoorUnit, heads: IndoorUnit[]): MultiFinding[] {
  const out: MultiFinding[] = [];
  const vrfHeads = heads.filter((u) => {
    if (isVrfHead(pack, u)) return true;
    out.push({ severity: "red", code: "not-vrf-head", message: `${u.model} can't join a VRF system` });
    return false;
  });
  const band = vrfBand(odu);
  if (!band) {
    out.push({ severity: "red", code: "no-rule", message: `${odu.model} has no connection limits in the book` });
    return out;
  }
  return [...out, ...checkBlock(band, odu, vrfHeads)];
}

/** the connected index against the outdoor's, as the book counts it: the
    heads' P-numbers added up over the outdoor's P-number. Null when a figure
    is missing. */
export function vrfIndexRatio(
  odu: OutdoorUnit,
  heads: IndoorUnit[]
): { connected: number; outdoor: number; pct: number } | null {
  if (odu.capacity_index == null || heads.some((u) => u.capacity_index == null)) return null;
  const connected = heads.reduce((n, u) => n + (u.capacity_index ?? 0), 0);
  return { connected, outdoor: odu.capacity_index, pct: Math.round((connected / odu.capacity_index) * 100) };
}

const UNCHECKABLE = new Set(["index-unknown", "no-rule"]);

/** VRF outdoors that take this set of heads, smallest index first: nothing
    red and nothing the book could not check. Under the ratio's minimum is
    amber and still listed, so a system being built is proposed an outdoor
    before its last zones are in. */
export function vrfOutdoorsListing(pack: DataPack, heads: IndoorUnit[]): OutdoorUnit[] {
  return pack.outdoor_units
    .filter((o) => o.system_type === "vrf" && outdoorReadiness(pack, o).roles["vrf-odu"])
    .filter((o) => !checkVrfSet(pack, o, heads).some((f) => f.severity === "red" || UNCHECKABLE.has(f.code)))
    .sort((a, b) => (a.capacity_index ?? 0) - (b.capacity_index ?? 0) || a.model.localeCompare(b.model));
}
