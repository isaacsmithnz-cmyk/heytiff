/* Design Studio — unit selection engine (Stage 4 selector overhaul).
   Model-first selection the way gear is actually chosen: form factor first,
   capacity as a GATE (covers the load, and not grossly oversized), then the
   real differentiators — physical fit (W×D×H) and airflow. Pure functions on
   top of proposePairs (split.ts); one row per INDOOR model with its qualifying
   outdoor pairings as a sub-choice. */

import type { DataPack, FormFactor, IndoorUnit, Phase } from "./packs/schema";
import type { SizingBasis } from "./loads";
import { proposePairs, type PairProposal } from "./split";

/** Oversize cap: qualifying units cover the load without exceeding this
    multiple of it (toggleable in the UI via `includeOversized`). */
export const OVERSIZE_CAP = 1.5;

export const FORM_FACTOR_LABELS: Record<FormFactor, string> = {
  wall: "Wall",
  ducted: "Ducted",
  "cassette-4way": "Cassette 4-way",
  "cassette-2way": "Cassette 2-way",
  "cassette-1way": "Cassette 1-way",
  "cassette-compact": "Cassette compact",
  "under-ceiling": "Under ceiling",
  "floor-console": "Floor console",
  "floor-concealed": "Floor concealed",
  bulkhead: "Bulkhead",
};

export interface UnitOption {
  idu: IndoorUnit;
  /** qualifying outdoor pairings, pack (book) order — standard series first */
  pairs: PairProposal[];
  defaultPair: PairProposal;
  /** smallest-capacity qualifying option in the current view */
  recommended: boolean;
}

export interface SelectFilters {
  maxWidthMm?: number;
  maxDepthMm?: number;
  maxHeightMm?: number;
  minAirflowLs?: number;
}

export type SelectSort = "capacity" | "width" | "depth" | "height" | "airflow";

export interface SelectCriteria {
  /** null = no capacity gate (full catalogue) */
  loadKw: number | null;
  basis: SizingBasis;
  /** null = all form factors */
  formFactor: FormFactor | null;
  /** outdoor-unit supply phase; null/undefined = any. Filters PAIRINGS — an
      indoor model whose every pairing is filtered out drops from the list. */
  phase?: Phase | null;
  filters?: SelectFilters;
  sort?: SelectSort;
  includeOversized?: boolean;
}

/** A pair passes the capacity gate when it covers the load and — unless
    oversized units are included — stays within OVERSIZE_CAP of it. */
function passesGate(
  p: PairProposal,
  loadKw: number | null,
  includeOversized: boolean
): boolean {
  if (loadKw == null) return true;
  if (p.capacityKw < loadKw) return false;
  return includeOversized || p.capacityKw <= loadKw * OVERSIZE_CAP;
}

const passesPhase = (p: PairProposal, phase: Phase | null | undefined): boolean =>
  phase == null || p.odu.phase === phase;

/** Group gated pairs by indoor model, preserving pack (book) order. */
function groupByIdu(pairs: PairProposal[]): UnitOption[] {
  const byModel = new Map<string, PairProposal[]>();
  for (const p of pairs) {
    const arr = byModel.get(p.idu.model) ?? [];
    arr.push(p);
    byModel.set(p.idu.model, arr);
  }
  return [...byModel.values()].map((arr) => ({
    idu: arr[0].idu,
    pairs: arr,
    defaultPair: arr[0],
    recommended: false,
  }));
}

const num = (v: number | undefined): number => (typeof v === "number" ? v : Infinity);

/** The selector's result set: gate → form factor → fit filters → sort. */
export function unitOptions(pack: DataPack, criteria: SelectCriteria): UnitOption[] {
  const {
    loadKw,
    basis,
    formFactor,
    phase = null,
    filters = {},
    sort = "capacity",
    includeOversized = false,
  } = criteria;

  // full catalogue (capacity-ascending), then gate each pairing individually.
  // Phase filters BEFORE grouping, so defaultPair / recommended / drop-outs
  // all reflect the surviving pairings.
  const all = proposePairs(pack, null, basis, formFactor ? { formFactor } : {});
  const gated = all.filter(
    (p) => passesGate(p, loadKw, includeOversized) && passesPhase(p, phase)
  );

  let options = groupByIdu(gated);

  // physical-fit filters on the indoor unit
  const { maxWidthMm, maxDepthMm, maxHeightMm, minAirflowLs } = filters;
  options = options.filter((o) => {
    if (maxWidthMm != null && num(o.idu.width_mm) > maxWidthMm) return false;
    if (maxDepthMm != null && num(o.idu.depth_mm) > maxDepthMm) return false;
    if (maxHeightMm != null && num(o.idu.height_mm) > maxHeightMm) return false;
    if (minAirflowLs != null && (o.idu.airflow_ls ?? 0) < minAirflowLs) return false;
    return true;
  });

  // recommended = smallest qualifying capacity in this view (only meaningful
  // under a load gate), independent of the chosen sort
  if (loadKw != null && options.length) {
    let best = options[0];
    for (const o of options)
      if (o.defaultPair.capacityKw < best.defaultPair.capacityKw) best = o;
    best.recommended = true;
  }

  const key = (o: UnitOption): number => {
    switch (sort) {
      case "capacity":
        return o.defaultPair.capacityKw;
      case "width":
        return num(o.idu.width_mm);
      case "depth":
        return num(o.idu.depth_mm);
      case "height":
        return num(o.idu.height_mm);
      case "airflow":
        // descending — more air at equal capacity is a feature; missing last
        return -(o.idu.airflow_ls ?? -Infinity);
    }
  };
  options.sort((a, b) => key(a) - key(b) || a.idu.model.localeCompare(b.idu.model));
  return options;
}

export interface FormFactorCount {
  formFactor: FormFactor;
  label: string;
  count: number;
}

/** Qualifying-option counts per form factor for the tab row. Reflects the
    capacity gate and phase filter — fit filters narrow within a tab, not
    across tabs. */
export function formFactorSummary(
  pack: DataPack,
  loadKw: number | null,
  basis: SizingBasis,
  includeOversized = false,
  phase: Phase | null = null
): FormFactorCount[] {
  const all = proposePairs(pack, null, basis);
  const gated = all.filter(
    (p) => passesGate(p, loadKw, includeOversized) && passesPhase(p, phase)
  );
  const counts = new Map<FormFactor, Set<string>>();
  for (const p of gated) {
    const set = counts.get(p.idu.form_factor) ?? new Set<string>();
    set.add(p.idu.model);
    counts.set(p.idu.form_factor, set);
  }
  return (Object.keys(FORM_FACTOR_LABELS) as FormFactor[])
    .filter((f) => counts.has(f))
    .map((f) => ({
      formFactor: f,
      label: FORM_FACTOR_LABELS[f],
      count: counts.get(f)!.size,
    }));
}
