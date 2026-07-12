/* Unit spec registry — the single source of truth for the columns the unit
   browser can show, the rows the comparer lays out, and the detail panel's
   spec sheet. Every spec is attributed to a source via `group`: the indoor
   unit, the outdoor unit (of the currently chosen pairing), or the pairing
   itself — grouped consumers (columns menu, comparer, detail panel) render
   the group headings so short labels stay unambiguous. In the flat table,
   unprefixed headers describe the indoor unit (the row IS the indoor model);
   outdoor columns carry an explicit marker. Cells return plain strings (this
   file stays React-free — badges are component-layer markup). Sizing/filter
   correctness lives in select.ts — this file is presentation only. */

import type { FormFactor } from "./packs/schema";
import type { SelectSort, UnitOption } from "./select";
import type { PairProposal } from "./split";

export type SpecGroup = "idu" | "odu" | "pair";

export const SPEC_GROUP_LABELS: Record<SpecGroup, string> = {
  idu: "Indoor unit",
  odu: "Outdoor unit",
  pair: "Pairing",
};

/** "30–38 dBA" (range) · "38 dBA" (single figure or low==high) · "—" */
export function formatSoundRange(low?: number, high?: number): string {
  if (low != null && high != null && low !== high) return `${low}–${high} dBA`;
  const v = high ?? low;
  return v != null ? `${v} dBA` : "—";
}

export interface UnitSpec {
  id: string;
  /** which unit the value describes — indoor, outdoor, or the pairing */
  group: SpecGroup;
  /** never a table column or Columns-menu entry; detail panel + comparer only */
  detailOnly?: boolean;
  /** column header in the table */
  header: string;
  /** table cell text for a row (idu + its chosen pair) */
  cell: (o: UnitOption, pair: PairProposal) => string;
  /** engine sort key, when this column is sortable */
  sortKey?: SelectSort;
  /** shown by default (the rest are opt-in via the Columns menu) */
  defaultOn: boolean;
  /** column only relevant for this form factor (e.g. airflow → ducted) */
  only?: FormFactor;
  // ── comparer/detail metadata ──
  /** human label, e.g. "Sound" (the header is the terse table form; the
      group heading carries the indoor/outdoor attribution) */
  label: string;
  unit?: string;
  /** raw numeric for best-in-row highlighting; null when not applicable */
  numeric?: (o: UnitOption, pair: PairProposal) => number | null;
  /** which direction wins when comparing */
  better?: "higher" | "lower";
}

export const UNIT_SPECS: UnitSpec[] = [
  {
    id: "capacity",
    group: "pair",
    header: "Cool / Heat",
    label: "Capacity",
    unit: "kW",
    cell: (_o, p) => `${p.coolKw} / ${p.heatKw} kW`,
    numeric: (_o, p) => p.capacityKw,
    better: "higher",
    sortKey: "capacity",
    defaultOn: true,
  },
  {
    id: "width",
    group: "idu",
    header: "W mm",
    label: "Width",
    unit: "mm",
    cell: (o) => String(o.idu.width_mm),
    numeric: (o) => o.idu.width_mm,
    better: "lower",
    sortKey: "width",
    defaultOn: true,
  },
  {
    id: "depth",
    group: "idu",
    header: "D mm",
    label: "Depth",
    unit: "mm",
    cell: (o) => String(o.idu.depth_mm),
    numeric: (o) => o.idu.depth_mm,
    better: "lower",
    sortKey: "depth",
    defaultOn: true,
  },
  {
    id: "height",
    group: "idu",
    header: "H mm",
    label: "Height",
    unit: "mm",
    cell: (o) => String(o.idu.height_mm),
    numeric: (o) => o.idu.height_mm,
    better: "lower",
    sortKey: "height",
    defaultOn: true,
  },
  {
    id: "airflow",
    group: "idu",
    header: "Airflow",
    label: "Airflow",
    unit: "L/s",
    cell: (o) => `${o.idu.airflow_ls ?? "—"} L/s`,
    numeric: (o) => o.idu.airflow_ls ?? null,
    better: "higher",
    sortKey: "airflow",
    defaultOn: true,
    only: "ducted",
  },
  {
    /* id kept from the pre-range single figure — saved column choices with
       "sound" enabled keep meaning the INDOOR unit's rating */
    id: "sound",
    group: "idu",
    header: "Sound (in)",
    label: "Sound",
    unit: "dBA",
    cell: (o) => formatSoundRange(o.idu.sound_low_dba, o.idu.sound_high_dba),
    numeric: (o) => o.idu.sound_high_dba ?? o.idu.sound_low_dba ?? null,
    better: "lower",
    defaultOn: false,
  },
  {
    id: "weight",
    group: "idu",
    header: "Weight kg",
    label: "Weight",
    unit: "kg",
    cell: (o) => (o.idu.weight_kg != null ? String(o.idu.weight_kg) : "—"),
    numeric: (o) => o.idu.weight_kg ?? null,
    better: "lower",
    defaultOn: false,
  },
  {
    id: "connLiquid",
    group: "idu",
    header: "Liquid mm",
    label: "Liquid line",
    unit: "mm",
    cell: (o) => String(o.idu.conn_liquid_mm),
    numeric: (o) => o.idu.conn_liquid_mm,
    defaultOn: false,
  },
  {
    id: "connGas",
    group: "idu",
    header: "Gas mm",
    label: "Gas line",
    unit: "mm",
    cell: (o) => String(o.idu.conn_gas_mm),
    numeric: (o) => o.idu.conn_gas_mm,
    defaultOn: false,
  },
  {
    id: "power",
    group: "idu",
    header: "Power",
    label: "Power supply",
    cell: (o) => o.idu.power_supply ?? "—",
    defaultOn: false,
  },
  {
    id: "series",
    group: "idu",
    header: "Series",
    label: "Series",
    cell: (o) => o.idu.series || "—",
    defaultOn: false,
  },
  {
    id: "oduPhase",
    group: "odu",
    header: "Phase",
    label: "Power phase",
    cell: (_o, p) => (p.odu.phase === "3" ? "3φ" : "1φ"),
    defaultOn: false,
  },
  {
    id: "oduSound",
    group: "odu",
    header: "Sound (out)",
    label: "Sound",
    unit: "dBA",
    cell: (_o, p) => formatSoundRange(p.odu.sound_low_dba, p.odu.sound_high_dba),
    numeric: (_o, p) => p.odu.sound_high_dba ?? p.odu.sound_low_dba ?? null,
    better: "lower",
    defaultOn: false,
  },
  {
    id: "oduSize",
    group: "odu",
    header: "ODU W×D×H",
    label: "Size",
    unit: "mm",
    // composite — no numeric, so no best-in-row (three columns would bloat
    // the table for a rarely-scanned spec)
    cell: (_o, p) =>
      p.odu.width_mm != null && p.odu.depth_mm != null && p.odu.height_mm != null
        ? `${p.odu.width_mm} × ${p.odu.depth_mm} × ${p.odu.height_mm}`
        : "—",
    defaultOn: false,
  },
  {
    id: "oduWeight",
    group: "odu",
    header: "ODU kg",
    label: "Weight",
    unit: "kg",
    cell: (_o, p) => (p.odu.weight_kg != null ? String(p.odu.weight_kg) : "—"),
    numeric: (_o, p) => p.odu.weight_kg ?? null,
    better: "lower",
    defaultOn: false,
  },
  {
    id: "oduPower",
    group: "odu",
    header: "ODU power",
    label: "Power supply",
    cell: (_o, p) => p.odu.power_supply ?? "—",
    defaultOn: false,
  },
  {
    id: "pipeRun",
    group: "pair",
    header: "Max run m",
    label: "Max pipe run",
    unit: "m",
    cell: (_o, p) => `${p.pair.max_length_m} m`,
    numeric: (_o, p) => p.pair.max_length_m,
    better: "higher",
    defaultOn: false,
  },
  {
    id: "pipeLift",
    group: "pair",
    detailOnly: true,
    header: "Max lift m",
    label: "Max lift",
    unit: "m",
    cell: (_o, p) => `${p.pair.max_lift_m} m`,
    numeric: (_o, p) => p.pair.max_lift_m,
    better: "higher",
    defaultOn: false,
  },
  {
    id: "pairPipes",
    group: "pair",
    detailOnly: true,
    header: "Pipe ø",
    label: "Pipe ø (liq / gas)",
    unit: "mm",
    cell: (_o, p) => `${p.pair.pipe_liquid_mm} / ${p.pair.pipe_gas_mm} mm`,
    defaultOn: false,
  },
  {
    id: "refrigerant",
    group: "pair",
    detailOnly: true,
    header: "Refrigerant",
    label: "Refrigerant",
    cell: (o) => o.idu.refrigerant,
    defaultOn: false,
  },
];

/** the table-capable specs (detail-only rows never become columns) */
export const COLUMN_SPECS = UNIT_SPECS.filter((s) => !s.detailOnly);

/** specs of one group, registry order — the comparer/detail section contents */
export function specsInGroup(group: SpecGroup): UnitSpec[] {
  return UNIT_SPECS.filter((s) => s.group === group);
}

export const DEFAULT_COLUMN_IDS = COLUMN_SPECS.filter((s) => s.defaultOn).map(
  (s) => s.id
);

const LS_KEY = "heytiff.studio.unit-columns";

/** The installer's saved column choice (per-device). Falls back to the
    defaults and drops any ids no longer in the registry (or no longer
    column-capable). Historical note: ids "sound"/"weight" have always meant
    the INDOOR unit's specs — outdoor equivalents are "oduSound"/"oduWeight". */
export function loadColumnIds(): string[] {
  if (typeof window === "undefined") return DEFAULT_COLUMN_IDS;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_COLUMN_IDS;
    const ids = JSON.parse(raw) as unknown;
    if (Array.isArray(ids)) {
      const valid = ids.filter(
        (id): id is string =>
          typeof id === "string" && COLUMN_SPECS.some((s) => s.id === id)
      );
      return valid.length ? valid : DEFAULT_COLUMN_IDS;
    }
  } catch {
    /* corrupt value — fall back to defaults */
  }
  return DEFAULT_COLUMN_IDS;
}

export function saveColumnIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable (private mode, quota) — the view just won't persist */
  }
}
