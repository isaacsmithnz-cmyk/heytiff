/* Unit spec registry — the single source of truth for the columns the unit
   browser can show and, later, the rows the comparer lays out. Each spec knows
   how to render its cell (table) and expose a raw number (comparer best-in-row),
   plus whether higher or lower is "better". Defaults are the specs installers
   want up front (capacity + physical size); everything else is opt-in and the
   choice persists per-device. Sizing/filter correctness lives in select.ts —
   this file is presentation only. */

import type { FormFactor } from "./packs/schema";
import type { SelectSort, UnitOption } from "./select";
import type { PairProposal } from "./split";

export interface UnitSpec {
  id: string;
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
  // ── comparer metadata (consumed by the cross-brand comparer) ──
  /** human label, e.g. "Sound" (the header is the terse table form) */
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
    id: "sound",
    header: "Sound dBA",
    label: "Sound",
    unit: "dBA",
    cell: (o) => (o.idu.sound_dba != null ? String(o.idu.sound_dba) : "—"),
    numeric: (o) => o.idu.sound_dba ?? null,
    better: "lower",
    defaultOn: false,
  },
  {
    id: "weight",
    header: "Weight kg",
    label: "Weight",
    unit: "kg",
    cell: (o) => (o.idu.weight_kg != null ? String(o.idu.weight_kg) : "—"),
    numeric: (o) => o.idu.weight_kg ?? null,
    better: "lower",
    defaultOn: false,
  },
  {
    id: "pipeRun",
    header: "Max run m",
    label: "Max pipe run",
    unit: "m",
    cell: (_o, p) => `${p.pair.max_length_m} m`,
    numeric: (_o, p) => p.pair.max_length_m,
    better: "higher",
    defaultOn: false,
  },
  {
    id: "connLiquid",
    header: "Liquid mm",
    label: "Liquid line",
    unit: "mm",
    cell: (o) => String(o.idu.conn_liquid_mm),
    numeric: (o) => o.idu.conn_liquid_mm,
    defaultOn: false,
  },
  {
    id: "connGas",
    header: "Gas mm",
    label: "Gas line",
    unit: "mm",
    cell: (o) => String(o.idu.conn_gas_mm),
    numeric: (o) => o.idu.conn_gas_mm,
    defaultOn: false,
  },
  {
    id: "power",
    header: "Power",
    label: "Power supply",
    cell: (o) => o.idu.power_supply ?? "—",
    defaultOn: false,
  },
  {
    id: "series",
    header: "Series",
    label: "Series",
    cell: (o) => o.idu.series || "—",
    defaultOn: false,
  },
];

export const DEFAULT_COLUMN_IDS = UNIT_SPECS.filter((s) => s.defaultOn).map((s) => s.id);

const LS_KEY = "heytiff.studio.unit-columns";

/** The installer's saved column choice (per-device). Falls back to the defaults
    and drops any ids no longer in the registry. */
export function loadColumnIds(): string[] {
  if (typeof window === "undefined") return DEFAULT_COLUMN_IDS;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_COLUMN_IDS;
    const ids = JSON.parse(raw) as unknown;
    if (Array.isArray(ids)) {
      const valid = ids.filter(
        (id): id is string => typeof id === "string" && UNIT_SPECS.some((s) => s.id === id)
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
