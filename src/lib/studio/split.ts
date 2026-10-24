/* Design Studio — Split (1:1) system module (Stage 4).
   The first system module, deliberately the simplest: it exercises the whole
   spine (system → room load → pair selection → placement → run → validation →
   materials). Pure functions over (document, dataPack) — no React, no canvas.
   (design-studio-plan.md, Layer 3 "Split" + Stage 4 lock gate.)

   Selection reads ONLY pair_tables for matching — the split engine never
   guesses a pairing (universal-table-schema.md §4). */

import type { DataPack, IndoorUnit, OutdoorUnit, PairTable } from "./packs/schema";
import { indoorReadiness } from "./packs/ready";
import { sizingCapacityKw, type SizingBasis } from "./loads";
import { coversLoad } from "./fit";

/* ─────────────────────────── pair proposals ─────────────────────────── */

export interface PairProposal {
  pair: PairTable;
  idu: IndoorUnit;
  odu: OutdoorUnit;
  /** capacity under the sizing basis (pair ratings when present, else unit) */
  capacityKw: number;
  coolKw: number;
  heatKw: number;
  /** smallest pair that still covers the load */
  recommended: boolean;
}

/** Matched pairs from the brand's pair table, engine-ready only, sized under
    `basis`. With a load: covering pairs sorted smallest-first and the first
    marked recommended. Without a load: the full catalogue, smallest-first. */
export function proposePairs(
  pack: DataPack,
  loadKw: number | null,
  basis: SizingBasis,
  opts: { formFactor?: string } = {}
): PairProposal[] {
  const idus = new Map(pack.indoor_units.map((u) => [u.model, u]));
  const odus = new Map(pack.outdoor_units.map((o) => [o.model, o]));

  const all: PairProposal[] = [];
  for (const pair of pack.pair_tables) {
    const idu = idus.get(pair.idu_model);
    const odu = odus.get(pair.odu_model);
    if (!idu || !odu) continue;
    if (opts.formFactor && idu.form_factor !== opts.formFactor) continue;
    if (!indoorReadiness(pack, idu).roles.split) continue;
    const coolKw = pair.rated_cool_kw ?? idu.capacity_cool_kw;
    const heatKw = pair.rated_heat_kw ?? idu.capacity_heat_kw;
    all.push({
      pair,
      idu,
      odu,
      coolKw,
      heatKw,
      capacityKw: sizingCapacityKw(
        { capacity_cool_kw: coolKw, capacity_heat_kw: heatKw },
        basis
      ),
      recommended: false,
    });
  }
  all.sort((a, b) => a.capacityKw - b.capacityKw || a.idu.model.localeCompare(b.idu.model));

  if (loadKw == null) return all;
  const covering = all.filter((p) => coversLoad(p.capacityKw, loadKw));
  if (covering.length) covering[0].recommended = true;
  return covering;
}
