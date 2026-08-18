/* Design Studio — engine-ready flags (Stage 2).
   "Engine-ready" is always COMPUTED, never hand-set (universal-table-schema.md).
   A model is offered by the engine only when its role's required set is
   complete; partial ingestion is therefore always safe — an incomplete row is
   simply not offered. The `missing` lists double as the extraction to-do list
   and the generated gap questionnaire ("airflow missing for this range"). */

import { hasDuctAirway } from "../form-factors";
import {
  isSpigotOpening,
  spigotDiametersMm,
  type DataPack,
  type IndoorUnit,
  type OpeningSpec,
  type OutdoorUnit,
} from "./schema";

export type ReadyRole =
  | "placeable"
  | "split"
  | "multi"
  | "vrf-idu"
  | "vrf-odu"
  | "ducted";

export interface Readiness {
  roles: Record<ReadyRole, boolean>;
  /** per role → the required fields/links still missing (empty when ready) */
  missing: Partial<Record<ReadyRole, string[]>>;
}

/** Is a numeric field present and positive? (0/NaN/undefined all fail.) */
function has(n: number | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** Airway opening present? "built-in"/"spigots"/"open" are complete answers —
    "open" says the face takes a duct at an installer-decided size, which is as
    much as some books ever publish; a box needs a positive W and H, and a
    sized spigot face needs at least one real takeoff. (Never pass an
    OpeningSpec to `has` — it's number-typed.) */
function hasOpening(o: OpeningSpec | undefined): boolean {
  if (o === "built-in" || o === "spigots" || o === "open") return true;
  if (isSpigotOpening(o)) return spigotDiametersMm(o).some((d) => d > 0);
  return typeof o === "object" && o !== null && has(o.w_mm) && has(o.h_mm);
}

function placeableMissing(u: {
  model?: string;
  width_mm?: number;
  depth_mm?: number;
}): string[] {
  const m: string[] = [];
  if (!u.model) m.push("model");
  if (!has(u.width_mm)) m.push("width_mm");
  if (!has(u.depth_mm)) m.push("depth_mm");
  return m;
}

/* ───────────────────────── indoor units ───────────────────────── */

export function indoorReadiness(pack: DataPack, idu: IndoorUnit): Readiness {
  const missing: Readiness["missing"] = {};

  // Placeable
  const placeM = placeableMissing(idu);
  if (!idu.form_factor) placeM.push("form_factor");
  if (!idu.allowed_planes?.length) placeM.push("allowed_planes");
  if (placeM.length) missing.placeable = placeM;
  const placeable = placeM.length === 0;

  const capMsg = () => {
    const m: string[] = [];
    if (!has(idu.capacity_cool_kw)) m.push("capacity_cool_kw");
    if (!has(idu.capacity_heat_kw)) m.push("capacity_heat_kw");
    return m;
  };

  // Split-ready (IDU side): placeable + caps + a validated pair_tables row.
  if (idu.system_roles?.includes("split-pair")) {
    const m = [...placeM, ...capMsg()];
    const hasPair = pack.pair_tables.some((p) => p.idu_model === idu.model);
    if (!hasPair) m.push("pair_tables row");
    if (m.length) missing.split = m;
  }

  // Multi-ready (IDU side): placeable + caps + connection sizes + index if declared.
  if (idu.system_roles?.includes("multi")) {
    const m = [...placeM, ...capMsg()];
    if (!has(idu.conn_liquid_mm)) m.push("conn_liquid_mm");
    if (!has(idu.conn_gas_mm)) m.push("conn_gas_mm");
    if (m.length) missing.multi = m;
  }

  // VRF-ready (IDU): placeable + caps + capacity_index + connection sizes.
  if (idu.system_roles?.includes("vrf")) {
    const m = [...placeM, ...capMsg()];
    if (!has(idu.capacity_index)) m.push("capacity_index");
    if (!has(idu.conn_liquid_mm)) m.push("conn_liquid_mm");
    if (!has(idu.conn_gas_mm)) m.push("conn_gas_mm");
    if (m.length) missing["vrf-idu"] = m;
  }

  // Ducted-ready: placeable + airflow + supply/return airway openings (they
  // size the plenum base — ducted spec §1b). Static stays optional in v1 (no
  // ESP check yet).
  if (hasDuctAirway(idu.form_factor)) {
    const m = [...placeM];
    if (!has(idu.airflow_ls)) m.push("airflow_ls");
    if (!hasOpening(idu.supply_opening)) m.push("supply_opening");
    if (!hasOpening(idu.return_opening)) m.push("return_opening");
    if (m.length) missing.ducted = m;
  }

  return {
    roles: {
      placeable,
      split: idu.system_roles?.includes("split-pair") ? !missing.split : false,
      multi: idu.system_roles?.includes("multi") ? !missing.multi : false,
      "vrf-idu": idu.system_roles?.includes("vrf") ? !missing["vrf-idu"] : false,
      "vrf-odu": false,
      ducted: hasDuctAirway(idu.form_factor) ? !missing.ducted : false,
    },
    missing,
  };
}

/* ───────────────────────── outdoor units ───────────────────────── */

export function outdoorReadiness(pack: DataPack, odu: OutdoorUnit): Readiness {
  const missing: Readiness["missing"] = {};

  const placeM = placeableMissing(odu);
  if (placeM.length) missing.placeable = placeM;
  const placeable = placeM.length === 0;

  const capMsg = () => {
    const m: string[] = [];
    if (!has(odu.capacity_cool_kw)) m.push("capacity_cool_kw");
    if (!has(odu.capacity_heat_kw)) m.push("capacity_heat_kw");
    return m;
  };

  // Multi-ready (ODU): placeable + caps + complete multi_rules for this ODU.
  if (odu.system_type === "multi") {
    const m = [...placeM, ...capMsg()];
    if (!has(odu.ports)) m.push("ports");
    const rule = pack.multi_rules.find((r) => r.odu_model_ref === odu.model);
    if (!rule) m.push("multi_rules row");
    else if (!rule.compatibility?.length) m.push("multi_rules.compatibility");
    if (m.length) missing.multi = m;
  }

  // VRF-ready (ODU): placeable + caps + ratio limits + a complete vrf_pipe_tables
  // for its series (sizing + joints + limits + charge).
  if (odu.system_type === "vrf") {
    const m = [...placeM, ...capMsg()];
    if (!has(odu.capacity_index)) m.push("capacity_index");
    if (!has(odu.ratio_min_pct) || !has(odu.ratio_max_pct)) m.push("ratio limits");
    if (!has(odu.max_idus)) m.push("max_idus");
    if (!odu.pipe_table_ref) m.push("pipe_table_ref");
    else {
      const t = pack.vrf_pipe_tables.find((v) => v.series === odu.pipe_table_ref);
      if (!t) m.push("vrf_pipe_tables row");
      else {
        if (!t.pipe_sizing) m.push("vrf_pipe_tables.pipe_sizing");
        if (!t.joint_selection?.steps?.length) m.push("vrf_pipe_tables.joint_selection");
        if (!t.limits) m.push("vrf_pipe_tables.limits");
        if (!t.additional_charge) m.push("vrf_pipe_tables.additional_charge");
      }
    }
    if (m.length) missing["vrf-odu"] = m;
  }

  return {
    roles: {
      placeable,
      split: false,
      multi: odu.system_type === "multi" ? !missing.multi : false,
      "vrf-idu": false,
      "vrf-odu": odu.system_type === "vrf" ? !missing["vrf-odu"] : false,
      ducted: false,
    },
    missing,
  };
}

/* ──────────────────────── pack-wide rollup ──────────────────────── */

export interface RangeCompleteness {
  series: string;
  brand: string;
  role: ReadyRole;
  ready: number;
  total: number;
  /** aggregated missing fields across the not-ready models in this range */
  gaps: string[];
}

/** Per-series/role "14 of 22 engine-ready" rollup — powers the pack browser
    and the extraction to-do list. */
export function completenessByRange(pack: DataPack): RangeCompleteness[] {
  const acc = new Map<string, RangeCompleteness>();
  const bump = (
    brand: string,
    series: string,
    role: ReadyRole,
    ready: boolean,
    gaps: string[]
  ) => {
    const key = `${brand}::${series}::${role}`;
    const cur =
      acc.get(key) ?? { series, brand, role, ready: 0, total: 0, gaps: [] };
    cur.total += 1;
    if (ready) cur.ready += 1;
    else for (const g of gaps) if (!cur.gaps.includes(g)) cur.gaps.push(g);
    acc.set(key, cur);
  };

  for (const idu of pack.indoor_units) {
    const r = indoorReadiness(pack, idu);
    (["placeable", "split", "multi", "vrf-idu", "ducted"] as ReadyRole[]).forEach(
      (role) => {
        // only count roles the unit claims (placeable + ducted always relevant)
        const claims =
          role === "placeable" ||
          (role === "ducted" && hasDuctAirway(idu.form_factor)) ||
          (role === "split" && idu.system_roles?.includes("split-pair")) ||
          (role === "multi" && idu.system_roles?.includes("multi")) ||
          (role === "vrf-idu" && idu.system_roles?.includes("vrf"));
        if (claims) bump(idu.brand, idu.series, role, r.roles[role], r.missing[role] ?? []);
      }
    );
  }
  for (const odu of pack.outdoor_units) {
    const r = outdoorReadiness(pack, odu);
    (["placeable", "multi", "vrf-odu"] as ReadyRole[]).forEach((role) => {
      const claims =
        role === "placeable" ||
        (role === "multi" && odu.system_type === "multi") ||
        (role === "vrf-odu" && odu.system_type === "vrf");
      if (claims) bump(odu.brand, odu.series, role, r.roles[role], r.missing[role] ?? []);
    });
  }
  return [...acc.values()];
}
