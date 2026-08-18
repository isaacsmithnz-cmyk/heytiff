/* Design Studio — unit selection engine (Stage 4 selector overhaul).
   Model-first selection the way gear is actually chosen: form factor first,
   capacity as a RANKING (does it cover the load without being grossly
   oversized?), then the real differentiators — physical fit (W×D×H) and
   airflow. Pure functions on top of proposePairs (split.ts); one row per
   INDOOR model with its qualifying outdoor pairings as a sub-choice.

   Capacity never hides a unit. The whole form factor is always on the table —
   options carry a `fit` so the browser can lead with the ones that suit the
   load and file the rest underneath, flagged for what they are. */

import type { DataPack, FormFactor, IndoorUnit, Phase } from "./packs/schema";
import type { SizingBasis } from "./loads";
import { proposePairs, type PairProposal } from "./split";
import { capacityFit, FIT_RANK, type UnitFit } from "./fit";
import { FORM_FACTOR_LABELS } from "./form-factors";

/* the ranking vocabulary is shared with the multi picker — re-exported here
   so the split browser has one import, not two */
export { FIT_RANK, type UnitFit };

/** Oversize cap: a unit "fits" when it covers the load without exceeding this
    multiple of it. Past the cap it's still offered, flagged oversized. */
export const OVERSIZE_CAP = 1.5;

/* re-exported, not redefined — form-factors.ts is the one place a form factor
   is put into words (it was three maps, worded three ways). */
export { FORM_FACTOR_LABELS };

export interface UnitOption {
  idu: IndoorUnit;
  /** qualifying outdoor pairings, best fit first then pack (book) order */
  pairs: PairProposal[];
  /** the pairing the row speaks for — the best-fitting one available */
  defaultPair: PairProposal;
  /** how defaultPair sizes against the load */
  fit: UnitFit;
  /** smallest-capacity FITTING option in the current view */
  bestFit: boolean;
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
      indoor model whose every pairing is filtered out drops from the list.
      The only capacity-adjacent thing that still REMOVES rows. */
  phase?: Phase | null;
  filters?: SelectFilters;
  sort?: SelectSort;
}

/** Where a pairing's capacity sits against the load. */
export const pairFit = (p: PairProposal, loadKw: number | null): UnitFit =>
  capacityFit(p.capacityKw, loadKw, OVERSIZE_CAP);

const passesPhase = (p: PairProposal, phase: Phase | null | undefined): boolean =>
  phase == null || p.odu.phase === phase;

/** Group pairs by indoor model. Within a model the pairings sort best-fit
    first (stable, so pack/book order breaks ties) and the leader becomes the
    defaultPair — a model is judged on the best pairing it can offer, not on
    whichever one happened to come first in the book. */
function groupByIdu(pairs: PairProposal[], loadKw: number | null): UnitOption[] {
  const byModel = new Map<string, PairProposal[]>();
  for (const p of pairs) {
    const arr = byModel.get(p.idu.model) ?? [];
    arr.push(p);
    byModel.set(p.idu.model, arr);
  }
  return [...byModel.values()].map((arr) => {
    const ranked = arr
      .map((p, i) => ({ p, i, rank: FIT_RANK[pairFit(p, loadKw)] }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i)
      .map((x) => x.p);
    return {
      idu: ranked[0].idu,
      pairs: ranked,
      defaultPair: ranked[0],
      fit: pairFit(ranked[0], loadKw),
      bestFit: false,
    };
  });
}

const num = (v: number | undefined): number => (typeof v === "number" ? v : Infinity);

/** The selector's result set: form factor → fit filters → sort, every unit
    kept and labelled with how it sizes. */
export function unitOptions(pack: DataPack, criteria: SelectCriteria): UnitOption[] {
  const { loadKw, basis, formFactor, phase = null, filters = {}, sort = "capacity" } = criteria;

  // full catalogue (capacity-ascending). Phase filters BEFORE grouping, so
  // defaultPair / fit / drop-outs all reflect the surviving pairings.
  const all = proposePairs(pack, null, basis, formFactor ? { formFactor } : {});
  const gated = all.filter((p) => passesPhase(p, phase));

  let options = groupByIdu(gated, loadKw);

  // physical-fit filters on the indoor unit
  const { maxWidthMm, maxDepthMm, maxHeightMm, minAirflowLs } = filters;
  options = options.filter((o) => {
    if (maxWidthMm != null && num(o.idu.width_mm) > maxWidthMm) return false;
    if (maxDepthMm != null && num(o.idu.depth_mm) > maxDepthMm) return false;
    if (maxHeightMm != null && num(o.idu.height_mm) > maxHeightMm) return false;
    if (minAirflowLs != null && (o.idu.airflow_ls ?? 0) < minAirflowLs) return false;
    return true;
  });

  // bestFit = smallest FITTING capacity in this view (only meaningful under a
  // load), independent of the chosen sort. Oversized and undersized rows are
  // never the pick of the bunch, however close they land.
  if (loadKw != null) {
    const fitting = options.filter((o) => o.fit === "fits");
    if (fitting.length) {
      let best = fitting[0];
      for (const o of fitting)
        if (o.defaultPair.capacityKw < best.defaultPair.capacityKw) best = o;
      best.bestFit = true;
    }
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
  /** every indoor model of this form factor the pack can pair */
  count: number;
  /** how many of them suit the load — 0 is a real, showable answer */
  fitCount: number;
}

/** Per-form-factor counts for the tab row: the whole catalogue, plus how much
    of it suits the load. Only the phase filter removes anything; fit filters
    narrow within a tab, not across tabs. */
export function formFactorSummary(
  pack: DataPack,
  loadKw: number | null,
  basis: SizingBasis,
  phase: Phase | null = null
): FormFactorCount[] {
  const all = proposePairs(pack, null, basis);
  const gated = all.filter((p) => passesPhase(p, phase));
  const counts = new Map<FormFactor, Set<string>>();
  const fits = new Map<FormFactor, Set<string>>();
  for (const p of gated) {
    const set = counts.get(p.idu.form_factor) ?? new Set<string>();
    set.add(p.idu.model);
    counts.set(p.idu.form_factor, set);
    if (pairFit(p, loadKw) === "fits") {
      const f = fits.get(p.idu.form_factor) ?? new Set<string>();
      f.add(p.idu.model);
      fits.set(p.idu.form_factor, f);
    }
  }
  return (Object.keys(FORM_FACTOR_LABELS) as FormFactor[])
    .filter((f) => counts.has(f))
    .map((f) => ({
      formFactor: f,
      label: FORM_FACTOR_LABELS[f],
      count: counts.get(f)!.size,
      fitCount: fits.get(f)?.size ?? 0,
    }));
}
