/* Comparison-table column model for the HQ universal-table editor.

   Arranges each section's editable value fields into ordered column groups
   ("Capacity · kW", "Dimensions · mm", …) for the per-series comparison table,
   and partitions a series' columns into mapped groups vs a trailing amber
   "To add" set (fields no row in the series has yet).

   Pure and client-safe: value-imports fields.ts only (catalog.ts is
   server-side — type imports are erased). A drift-guard test keeps every
   section's group map in sync with EDITABLE_FIELDS. */

import {
  EDITABLE_FIELDS,
  fieldSpec,
  type EditableSection,
} from "@/lib/studio/packs/fields";
import type { FormFactor } from "@/lib/studio/packs/schema";
import type { HqRow } from "./catalog";

export interface HqColumn {
  field: string;
  /** short sub-header under the group ("Cooling", "W", "kg") */
  sub: string;
  /** restrict to these indoor form factors: the column applies to a series
      when ANY of its rows matches (real series are single-form). Filtered
      columns leave groups, toAdd AND totalFields for that series. Unset =
      applies everywhere. */
  only?: FormFactor[];
}

export interface HqColumnGroup {
  key: string;
  /** group header without unit ("Capacity") */
  label: string;
  /** uniform unit → header renders "Label · unit" and subs stay bare;
      unset/mixed → subs carry their own units */
  unit?: string;
  columns: HqColumn[];
}

const col = (field: string, sub: string, only?: FormFactor[]): HqColumn =>
  only ? { field, sub, only } : { field, sub };

/** forms with duct airways — mirrors DUCTED_FORMS in catalog.ts/ready.ts */
const DUCTED_ONLY: FormFactor[] = ["ducted", "bulkhead"];

export const TABLE_GROUPS: Record<EditableSection, HqColumnGroup[]> = {
  indoor_units: [
    { key: "capacity", label: "Capacity", unit: "kW", columns: [col("capacity_cool_kw", "Cooling"), col("capacity_heat_kw", "Heating")] },
    { key: "index", label: "Index", columns: [col("capacity_index", "Cap. index")] },
    { key: "air", label: "Air", columns: [col("airflow_ls", "Airflow L/s"), col("static_pressure_pa", "Static Pa"), col("filter", "Filter")] },
    { key: "airways", label: "Airways", unit: "mm", columns: [col("supply_opening", "Supply", DUCTED_ONLY), col("return_opening", "Return", DUCTED_ONLY)] },
    { key: "drain", label: "Drain", columns: [col("drain_pressure", "Pressure"), col("drain_pump", "Pump")] },
    { key: "dims", label: "Dimensions", unit: "mm", columns: [col("width_mm", "W"), col("depth_mm", "D"), col("height_mm", "H")] },
    { key: "mass", label: "Mass", columns: [col("weight_kg", "kg")] },
    { key: "pipes", label: "Pipe Ø", unit: "mm", columns: [col("conn_liquid_mm", "Liquid"), col("conn_gas_mm", "Gas")] },
    { key: "sound", label: "Sound", unit: "dBA", columns: [col("sound_low_dba", "Lo"), col("sound_high_dba", "Hi")] },
    { key: "power", label: "Power", columns: [col("power_supply", "Supply"), col("phase", "Phase"), col("max_amps_a", "Max amps")] },
    { key: "refrig", label: "Refrig.", columns: [col("refrigerant", "Type")] },
  ],
  outdoor_units: [
    { key: "capacity", label: "Capacity", unit: "kW", columns: [col("capacity_cool_kw", "Cooling"), col("capacity_heat_kw", "Heating")] },
    { key: "rating", label: "Rating", columns: [col("hp", "HP"), col("capacity_index", "Cap. index")] },
    { key: "pipes", label: "Pipe Ø", unit: "mm", columns: [col("conn_liquid_mm", "Liquid"), col("conn_gas_mm", "Gas")] },
    { key: "charge", label: "Charge", unit: "kg", columns: [col("precharged_kg", "Pre-charged"), col("max_charge_kg", "Max")] },
    {
      key: "connect",
      label: "Connectable",
      columns: [
        col("ports", "Ports"),
        col("max_idus", "Max IDUs"),
        col("ratio_min_pct", "Ratio min %"),
        col("ratio_max_pct", "Ratio max %"),
        col("idu_index_min", "Idx min"),
        col("idu_index_max", "Idx max"),
        col("pipe_table_ref", "Pipe table"),
      ],
    },
    { key: "dims", label: "Dimensions", unit: "mm", columns: [col("width_mm", "W"), col("depth_mm", "D"), col("height_mm", "H")] },
    { key: "mass", label: "Mass", columns: [col("weight_kg", "kg")] },
    { key: "sound", label: "Sound", unit: "dBA", columns: [col("sound_low_dba", "Lo"), col("sound_high_dba", "Hi")] },
    { key: "power", label: "Power", columns: [col("power_supply", "Supply"), col("phase", "Phase"), col("max_amps_a", "Max amps")] },
    { key: "refrig", label: "Refrig.", columns: [col("refrigerant", "Type")] },
  ],
  pair_tables: [
    { key: "rated", label: "Rated", unit: "kW", columns: [col("rated_cool_kw", "Cooling"), col("rated_heat_kw", "Heating")] },
    { key: "pipes", label: "Pipe Ø", unit: "mm", columns: [col("pipe_liquid_mm", "Liquid"), col("pipe_gas_mm", "Gas")] },
    { key: "limits", label: "Limits", unit: "m", columns: [col("max_length_m", "Length"), col("max_lift_m", "Lift")] },
  ],
};

export interface HqToAddColumn extends HqColumn {
  /** Tier-1 somewhere in the series (a row's claimed role needs it) */
  blocks: boolean;
  /** union of blocked roles across the series, first-appearance order */
  roles: string[];
}

export interface HqSeriesColumns {
  /** groups filtered to columns with ≥1 value in the series; empty groups dropped */
  groups: HqColumnGroup[];
  /** fields empty across EVERY row, registry order */
  toAdd: HqToAddColumn[];
  totalFields: number;
  mappedFields: number;
}

/** editable VALUE field names for a section, registry order (tags excluded) */
export const sectionFields = (section: EditableSection): string[] =>
  EDITABLE_FIELDS.filter((f) => f.section === section && f.type !== "tags").map(
    (f) => f.field
  );

/** Partition a series' columns: a field is "to add" only when no row has it.
    Columns with an `only` restriction that matches no row's form factor are
    excluded entirely — from groups, toAdd and the totals. */
export function seriesColumns(section: EditableSection, rows: HqRow[]): HqSeriesColumns {
  const colBy = new Map<string, HqColumn>(
    TABLE_GROUPS[section].flatMap((g) => g.columns.map((c) => [c.field, c] as const))
  );
  const applies = (c: HqColumn | undefined) =>
    !c?.only || rows.some((r) => r.formFactor && c.only!.includes(r.formFactor));

  const fields = sectionFields(section).filter((f) => applies(colBy.get(f)));
  const empty = new Set(fields.filter((f) => rows.every((r) => r.values[f] == null)));

  const groups = TABLE_GROUPS[section]
    .map((g) => ({ ...g, columns: g.columns.filter((c) => applies(c) && !empty.has(c.field)) }))
    .filter((g) => g.columns.length > 0);

  const toAdd: HqToAddColumn[] = fields
    .filter((f) => empty.has(f))
    .map((field) => {
      const roles: string[] = [];
      let blocks = false;
      for (const r of rows) {
        const gap = r.gaps.find((g) => g.field === field && g.fillable);
        if (!gap?.blocks) continue;
        blocks = true;
        for (const role of gap.roles) if (!roles.includes(role)) roles.push(role);
      }
      return { field, sub: fieldSpec(section, field)?.label ?? field, blocks, roles };
    });

  return {
    groups,
    toAdd,
    totalFields: fields.length,
    mappedFields: fields.length - toAdd.length,
  };
}
