/* HQ drill-down arrangement — brand catalog grouped by system type → form
   factor → series.

   SERVER-SIDE ONLY as a value import: this module pulls FORM_FACTOR_LABELS from
   the studio's select.ts, which value-imports the split engine. Client
   components must import TYPES ONLY from here (type imports are erased) — the
   grouped VM ships to the client as props with all display labels baked in.

   Membership is FAN-OUT: a row appears under every system type in its
   `systemTypes` (a split wall unit tagged VRF-capable shows under both). Pairs
   are split-world data and only ever appear under the split branch. */

import type { HqCatalogView, HqRow } from "./catalog";
import { FORM_FACTORS, type SystemType } from "@/lib/studio/packs/schema";
import { FORM_FACTOR_LABELS } from "@/lib/studio/select";

export const SYSTEM_TYPE_LABELS: Record<SystemType, string> = {
  split: "Split systems",
  multi: "Multi-split",
  vrf: "VRF (City Multi)",
};

const SYSTEM_ORDER: SystemType[] = ["split", "multi", "vrf"];

export interface HqSeriesGroup {
  series: string;
  rows: HqRow[];
  /** engine-ready rows in this group */
  ready: number;
  total: number;
  /** union of blocking gap field names across the group, first-appearance order */
  blockingFields: string[];
}

export interface HqFormGroup {
  formFactor: string;
  label: string;
  seriesGroups: HqSeriesGroup[];
}

export interface HqSystemGroup {
  key: SystemType;
  label: string;
  iduForms: HqFormGroup[];
  oduSeries: HqSeriesGroup[];
  pairSeries: HqSeriesGroup[];
  counts: { idu: number; odu: number; pairs: number; ready: number; blocking: number };
}

export interface HqBrandGroups {
  /** always exactly three, in fixed split → multi → vrf order */
  systems: HqSystemGroup[];
}

/** capacity-ascending unit order (stable within a series; null sorts last) */
function unitOrder(a: HqRow, b: HqRow): number {
  const cap = (r: HqRow) => {
    const v = r.values.capacity_cool_kw;
    return typeof v === "number" ? v : Number.POSITIVE_INFINITY;
  };
  return cap(a) - cap(b) || a.title.localeCompare(b.title);
}

function seriesGroups(
  rows: HqRow[],
  order: (a: HqRow, b: HqRow) => number,
  othersLast = false
): HqSeriesGroup[] {
  const bySeries = new Map<string, HqRow[]>();
  for (const r of rows) {
    const list = bySeries.get(r.series);
    if (list) list.push(r);
    else bySeries.set(r.series, [r]);
  }
  const groups = [...bySeries.entries()].map(([series, list]) => {
    const sorted = [...list].sort(order);
    const blockingFields: string[] = [];
    for (const r of sorted) {
      for (const g of r.gaps) {
        if (g.blocks && !blockingFields.includes(g.field)) blockingFields.push(g.field);
      }
    }
    return {
      series,
      rows: sorted,
      ready: sorted.filter((r) => r.engineReady).length,
      total: sorted.length,
      blockingFields,
    };
  });
  groups.sort((a, b) => {
    if (othersLast) {
      if (a.series === "Other" && b.series !== "Other") return 1;
      if (b.series === "Other" && a.series !== "Other") return -1;
    }
    return a.series.localeCompare(b.series);
  });
  return groups;
}

/** Group a brand's catalog view for the drill-down page. */
export function groupBrandCatalog(view: HqCatalogView): HqBrandGroups {
  const systems = SYSTEM_ORDER.map((key): HqSystemGroup => {
    const idus = view.indoor.filter((r) => r.systemTypes.includes(key));
    const odus = view.outdoor.filter((r) => r.systemTypes.includes(key));
    const pairs = key === "split" ? view.pairs : [];

    // indoor: form factor (canonical order) → series groups
    const byForm = new Map<string, HqRow[]>();
    for (const r of idus) {
      const f = r.formFactor ?? "other";
      const list = byForm.get(f);
      if (list) list.push(r);
      else byForm.set(f, [r]);
    }
    const knownForms = FORM_FACTORS.filter((f) => byForm.has(f)).map(String);
    const unknownForms = [...byForm.keys()]
      .filter((f) => !(FORM_FACTORS as readonly string[]).includes(f))
      .sort((a, b) => a.localeCompare(b));
    const iduForms: HqFormGroup[] = [...knownForms, ...unknownForms].map((f) => ({
      formFactor: f,
      label: FORM_FACTOR_LABELS[f as keyof typeof FORM_FACTOR_LABELS] ?? f,
      seriesGroups: seriesGroups(byForm.get(f)!, unitOrder),
    }));

    const units = [...idus, ...odus];
    return {
      key,
      label: SYSTEM_TYPE_LABELS[key],
      iduForms,
      oduSeries: seriesGroups(odus, unitOrder),
      pairSeries: seriesGroups(pairs, (a, b) => a.title.localeCompare(b.title), true),
      counts: {
        idu: idus.length,
        odu: odus.length,
        pairs: pairs.length,
        ready: units.filter((r) => r.engineReady).length,
        blocking:
          units.reduce((n, r) => n + r.blockingCount, 0) +
          pairs.reduce((n, r) => n + r.blockingCount, 0),
      },
    };
  });

  return { systems };
}
