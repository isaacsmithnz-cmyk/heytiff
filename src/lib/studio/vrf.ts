/* VRF (docs/studio-vrf.md): one outdoor and its heads. City Multi heads go
   on joints and headers; on an outdoor that takes branch boxes (PUMY) the
   M, S and P-series heads go on boxes, alone or mixed with City Multi heads.
   The envelope is on the outdoor's own row, from its data book:
   - PUHY: the heads' capacity INDEX against the outdoor's, 50–130%, a head
     count and a per-head index band, checked with the same index_ratio_band
     arm a ratio-band multi uses;
   - PUMY: the heads' rated cooling kW against the outdoor's, 50–130%
     (M-P0860 p.2-7), and the head counts by how they connect: City Multi
     only, branch boxes only, or a mixed system's pairs per number of boxes.

   Pure functions over the pack. No React. The pipe tree, its sizes, its
   limits and the charge are vrf-tree.ts. */

import type { CompatibilityRule, DataPack, IndoorUnit, OutdoorUnit } from "./packs/schema";
import { indoorReadiness, outdoorReadiness } from "./packs/ready";
import { checkBlock, isBoxHead, type MultiFinding } from "./multi";

export { isBoxHead } from "./multi";

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

/** a City Multi head: one the book gives a capacity index and the VRF role
    (ready.ts "vrf-idu") */
export function isVrfHead(pack: DataPack, u: IndoorUnit): boolean {
  return indoorReadiness(pack, u).roles["vrf-idu"];
}

/** a head some VRF outdoor can take: a City Multi head, or one a branch box
    takes */
export const joinsVrf = (pack: DataPack, u: IndoorUnit): boolean => isVrfHead(pack, u) || isBoxHead(pack, null, u);

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

/** the most heads one branch box takes (the pack's biggest box) */
const boxPorts = (pack: DataPack): number =>
  Math.max(0, ...pack.parts.filter((p) => p.part_type === "branch-box").map((p) => p.ports ?? 0));

/** every finding on this outdoor with these heads. A head the outdoor can't
    take is red. Then the envelope: over the head count, a head outside the
    band, over the ratio, and UNDER the ratio are all red — below 50% the
    system is not compatible (Isaac, 2026-09-28: "under 50% should block"). */
export function checkVrfSet(pack: DataPack, odu: OutdoorUnit, heads: IndoorUnit[]): MultiFinding[] {
  return envelope(pack, odu, heads).map((f) => (f.code === "ratio-under" ? underCapacity(odu, heads) : f));
}

/** the one wording for a set under the outdoor's minimum */
function underCapacity(odu: OutdoorUnit, heads: IndoorUnit[]): MultiFinding {
  const r = vrfRatio(odu, heads);
  return {
    severity: "red",
    code: "ratio-under",
    message: `Not compatible: the indoor units are under capacity, ${r ? `${r.pct}%` : "too little"} of ${odu.model}, which needs at least ${odu.ratio_min_pct ?? 50}%`,
  };
}

function envelope(pack: DataPack, odu: OutdoorUnit, heads: IndoorUnit[]): MultiFinding[] {
  const out: MultiFinding[] = [];
  const cm: IndoorUnit[] = [];
  const box: IndoorUnit[] = [];
  for (const u of heads) {
    if (isVrfHead(pack, u)) cm.push(u);
    else if (odu.branch_boxes && isBoxHead(pack, odu, u)) box.push(u);
    else out.push({ severity: "red", code: "not-vrf-head", message: `${u.model} can't join ${odu.model}` });
  }
  const band = vrfBand(odu);
  if (!band) {
    out.push({ severity: "red", code: "no-rule", message: `${odu.model} has no connection limits in the book` });
    return out;
  }
  if (odu.ratio_basis !== "kw") return [...out, ...checkBlock(band, odu, cm)];

  /* PUMY: the heads by how they connect, then the kW ratio */
  const bb = odu.branch_boxes;
  for (const u of cm) {
    const idx = u.capacity_index ?? 0;
    if ((band.index_min != null && idx < band.index_min) || (band.index_max != null && idx > band.index_max))
      out.push({
        severity: "red",
        code: "outside-index-band",
        message: `${u.model} is P${idx}, and ${odu.model} takes P${band.index_min ?? 0}–P${band.index_max ?? "∞"}`,
      });
  }
  if (!box.length && cm.length > band.max_idus)
    out.push({ severity: "red", code: "over-max-count", message: `${cm.length} heads, and ${odu.model} takes up to ${band.max_idus}` });
  if (box.length && bb) {
    const fewest = Math.max(1, Math.ceil(box.length / Math.max(1, boxPorts(pack))));
    const fits = !cm.length
      ? box.length <= bb.max_heads
      : bb.mixed.some((m) => m.boxes >= fewest && m.boxes <= bb.max_boxes && cm.length <= m.city_multi && box.length <= m.box_heads);
    if (!fits)
      out.push({
        severity: "red",
        code: "over-max-count",
        message: cm.length
          ? `${cm.length} City Multi and ${box.length} branch box heads is more than ${odu.model} takes mixed`
          : `${box.length} heads on branch boxes, and ${odu.model} takes up to ${bb.max_heads}`,
      });
  }
  const connected = [...cm, ...box].reduce((t, u) => t + (u.capacity_cool_kw ?? 0), 0);
  if (connected > 0 && odu.capacity_cool_kw) {
    const pct = (connected / odu.capacity_cool_kw) * 100;
    if (pct > band.ratio_max_pct)
      out.push({
        severity: "red",
        code: "ratio-over",
        message: `The heads come to ${Math.round(pct)}% of ${odu.model}, over its ${band.ratio_max_pct}%`,
      });
    else if (pct < band.ratio_min_pct)
      out.push({
        severity: "amber",
        code: "ratio-under",
        message: `The heads come to ${Math.round(pct)}% of ${odu.model}, under its ${band.ratio_min_pct}%`,
      });
  }
  return out;
}

/** the connected capacity against the outdoor's, as its book counts it:
    P-numbers for an index outdoor (PUHY), rated cooling kW for a kW one
    (PUMY). Null when a figure is missing. */
export function vrfRatio(
  odu: OutdoorUnit,
  heads: IndoorUnit[]
): { basis: "index" | "kw"; connected: number; outdoor: number; pct: number } | null {
  if (odu.ratio_basis === "kw") {
    if (!odu.capacity_cool_kw) return null;
    const connected = Math.round(heads.reduce((n, u) => n + (u.capacity_cool_kw ?? 0), 0) * 10) / 10;
    return { basis: "kw", connected, outdoor: odu.capacity_cool_kw, pct: Math.round((connected / odu.capacity_cool_kw) * 100) };
  }
  const r = vrfIndexRatio(odu, heads);
  return r ? { basis: "index", ...r } : null;
}

/** the connected index against the outdoor's: the heads' P-numbers added up
    over the outdoor's P-number. Null when a figure is missing. */
export function vrfIndexRatio(
  odu: OutdoorUnit,
  heads: IndoorUnit[]
): { connected: number; outdoor: number; pct: number } | null {
  if (odu.capacity_index == null || heads.some((u) => u.capacity_index == null)) return null;
  const connected = heads.reduce((n, u) => n + (u.capacity_index ?? 0), 0);
  return { connected, outdoor: odu.capacity_index, pct: Math.round((connected / odu.capacity_index) * 100) };
}

const UNCHECKABLE = new Set(["index-unknown", "no-rule"]);

/** VRF outdoors that take this set of heads, smallest first: nothing red
    and nothing the book could not check. `proposing` also keeps an outdoor
    the heads are only UNDER — so a system being built is still proposed its
    smallest outdoor, and the verdict can say it is under capacity of that
    one, rather than propose nothing. */
export function vrfOutdoorsListing(
  pack: DataPack,
  heads: IndoorUnit[],
  opts: { proposing?: boolean } = {}
): OutdoorUnit[] {
  const blocks = (f: MultiFinding) =>
    (f.severity === "red" && !(opts.proposing && f.code === "ratio-under")) || UNCHECKABLE.has(f.code);
  return pack.outdoor_units
    .filter((o) => o.system_type === "vrf" && outdoorReadiness(pack, o).roles["vrf-odu"])
    .filter((o) => !checkVrfSet(pack, o, heads).some(blocks))
    .sort((a, b) => a.capacity_cool_kw - b.capacity_cool_kw || a.model.localeCompare(b.model));
}
