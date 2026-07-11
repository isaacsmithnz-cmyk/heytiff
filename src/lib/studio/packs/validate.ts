/* Design Studio — data-pack validator (Stage 2).
   The CI gate: ingestion = edit JSON → run this → CI blocks broken packs
   (universal-table-schema.md — Storage & validation). Validates field types +
   units, enum membership, uniqueness, and — the part a generic schema lib can't
   do — REFERENTIAL INTEGRITY across sections. A broken cross-reference is an
   input-time error, never a blank on a design. Role-completeness lives in
   ready.ts (the engine-ready flags); this file guarantees the pack is
   structurally sound so those flags mean what they say. */

import {
  PACK_SCHEMA_VERSION,
  FORM_FACTORS,
  REFRIGERANTS,
  SYSTEM_ROLES,
  ADDITIONAL_CHARGE_METHODS,
  COMPATIBILITY_METHODS,
  PIPE_SIZING_METHODS,
  type DataPack,
  type AdditionalChargeRule,
  type CompatibilityRule,
  type PipeSizingRule,
  type Provenance,
} from "./schema";

const PLANES = new Set([
  "floor-cavity",
  "room",
  "ceiling-cavity",
  "roof-cavity",
  "external-ground",
  "external-roof",
]);

const PART_TYPES = new Set([
  "joint",
  "header",
  "bc-box",
  "branch-box",
  "reducer",
  "flare-adaptor",
  "twinning-kit",
]);

export interface ValidationIssue {
  severity: "error" | "warning";
  /** section key, e.g. "outdoor_units" */
  section: string;
  /** row identity — model/ref/index — for the message */
  row: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/* ─────────────────────────── field helpers ─────────────────────────── */

const num = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown): v is number => num(v) && v > 0;
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function checkProvenance(
  push: (m: string) => void,
  p: Provenance | undefined
): void {
  if (!p) return push("provenance missing");
  if (!["extracted", "user-entered", "legacy-ductr"].includes(p.kind))
    push(`provenance.kind invalid: ${p.kind}`);
  if (!str(p.source)) push("provenance.source missing");
}

function checkAdditionalCharge(
  push: (m: string) => void,
  c: AdditionalChargeRule | undefined
): void {
  if (!c) return push("additional_charge missing");
  if (!(ADDITIONAL_CHARGE_METHODS as readonly string[]).includes(c.method))
    return push(`additional_charge.method unknown: ${(c as { method: string }).method}`);
  if (c.method === "per_meter_by_liquid_size") {
    if (!c.rates || Object.keys(c.rates).length === 0)
      push("additional_charge.rates empty");
    else
      for (const [k, v] of Object.entries(c.rates))
        if (!num(v)) push(`additional_charge.rates[${k}] not numeric`);
  }
}

function checkCompatibility(
  push: (m: string) => void,
  blocks: CompatibilityRule[] | undefined
): void {
  if (!blocks || blocks.length === 0) return push("compatibility empty");
  blocks.forEach((b, i) => {
    if (!(COMPATIBILITY_METHODS as readonly string[]).includes(b.method))
      push(`compatibility[${i}].method unknown: ${(b as { method: string }).method}`);
    if (b.method === "index_ratio_band") {
      if (!pos(b.ratio_min_pct) || !pos(b.ratio_max_pct))
        push(`compatibility[${i}] ratio band incomplete`);
      if (num(b.ratio_min_pct) && num(b.ratio_max_pct) && b.ratio_min_pct > b.ratio_max_pct)
        push(`compatibility[${i}] ratio_min > ratio_max`);
    }
  });
}

function checkPipeSizing(
  push: (m: string) => void,
  label: string,
  r: PipeSizingRule | undefined
): void {
  if (!r) return push(`${label} missing`);
  if (!(PIPE_SIZING_METHODS as readonly string[]).includes(r.method))
    return push(`${label}.method unknown: ${(r as { method: string }).method}`);
  if (!r.steps?.length) return push(`${label}.steps empty`);
  r.steps.forEach((s, i) => {
    if (!pos(s.liquid_mm) || !pos(s.gas_mm))
      push(`${label}.steps[${i}] pipe size missing`);
    const key = r.method === "size_by_downstream_index" ? "index_max" : "kw_max";
    if (!num((s as Record<string, unknown>)[key]))
      push(`${label}.steps[${i}].${key} missing`);
  });
}

/* ─────────────────────────── the validator ─────────────────────────── */

export function validatePack(pack: DataPack): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const err = (section: string, row: string) => (m: string) =>
    errors.push({ severity: "error", section, row, message: m });
  const warn = (section: string, row: string, m: string) =>
    warnings.push({ severity: "warning", section, row, message: m });

  // meta
  if (!pack.meta) errors.push({ severity: "error", section: "meta", row: "-", message: "meta missing" });
  else {
    if (pack.meta.packSchemaVersion !== PACK_SCHEMA_VERSION)
      warn("meta", pack.meta.version ?? "-", `packSchemaVersion ${pack.meta.packSchemaVersion} != ${PACK_SCHEMA_VERSION}`);
    if (!str(pack.meta.brand)) err("meta", "-")("meta.brand missing");
    if (!str(pack.meta.version)) err("meta", "-")("meta.version missing");
  }

  const brandIds = new Set(pack.brands.map((b) => b.id));
  const iduModels = new Set<string>();
  const oduModels = new Set<string>();
  const partModels = new Set<string>();
  const seriesRefs = new Set<string>(); // vrf_pipe_tables.series

  // brands — unique ids
  const seenBrand = new Set<string>();
  for (const b of pack.brands) {
    const push = err("brands", b.id ?? "-");
    if (!str(b.id)) push("id missing");
    if (!str(b.name)) push("name missing");
    if (seenBrand.has(b.id)) push("duplicate brand id");
    seenBrand.add(b.id);
  }

  // indoor units
  for (const u of pack.indoor_units) {
    const push = err("indoor_units", u.model ?? "-");
    if (!str(u.model)) push("model missing");
    else if (iduModels.has(u.model)) push("duplicate model");
    iduModels.add(u.model);
    if (!brandIds.has(u.brand)) push(`brand not in brands[]: ${u.brand}`);
    if (!(FORM_FACTORS as readonly string[]).includes(u.form_factor))
      push(`form_factor invalid: ${u.form_factor}`);
    if (!pos(u.capacity_cool_kw)) push("capacity_cool_kw missing/invalid");
    if (!pos(u.capacity_heat_kw)) push("capacity_heat_kw missing/invalid");
    if (!pos(u.conn_liquid_mm)) push("conn_liquid_mm missing");
    if (!pos(u.conn_gas_mm)) push("conn_gas_mm missing");
    if (!PLANES.has(u.default_plane)) push(`default_plane invalid: ${u.default_plane}`);
    if (!Array.isArray(u.allowed_planes) || u.allowed_planes.some((p) => !PLANES.has(p)))
      push("allowed_planes invalid");
    if (!Array.isArray(u.system_roles) || u.system_roles.some((r) => !(SYSTEM_ROLES as readonly string[]).includes(r)))
      push("system_roles invalid");
    if (!(REFRIGERANTS as readonly string[]).includes(u.refrigerant))
      push(`refrigerant invalid: ${u.refrigerant}`);
    checkProvenance(push, u.provenance);
  }

  // outdoor units
  for (const o of pack.outdoor_units) {
    const push = err("outdoor_units", o.model ?? "-");
    if (!str(o.model)) push("model missing");
    else if (oduModels.has(o.model)) push("duplicate model");
    oduModels.add(o.model);
    if (!brandIds.has(o.brand)) push(`brand not in brands[]: ${o.brand}`);
    if (!["split", "multi", "vrf"].includes(o.system_type))
      push(`system_type invalid: ${o.system_type}`);
    if (!pos(o.capacity_cool_kw)) push("capacity_cool_kw missing/invalid");
    if (!pos(o.capacity_heat_kw)) push("capacity_heat_kw missing/invalid");
    if (o.phase !== "1" && o.phase !== "3") push("phase must be '1' or '3'");
    if (!(REFRIGERANTS as readonly string[]).includes(o.refrigerant))
      push(`refrigerant invalid: ${o.refrigerant}`);
    checkProvenance(push, o.provenance);
  }

  // parts — collect models first (referenced by vrf tables, multi rules)
  for (const p of pack.parts) {
    const push = err("parts", p.model ?? "-");
    if (!str(p.model)) push("model missing");
    else if (partModels.has(p.model)) push("duplicate model");
    partModels.add(p.model);
    if (!PART_TYPES.has(p.part_type)) push(`part_type invalid: ${p.part_type}`);
    if (!brandIds.has(p.brand)) push(`brand not in brands[]: ${p.brand}`);
    checkProvenance(push, p.provenance);
  }

  // pair_tables — referential integrity
  pack.pair_tables.forEach((pt, i) => {
    const push = err("pair_tables", pt.idu_model && pt.odu_model ? `${pt.idu_model}+${pt.odu_model}` : `#${i}`);
    if (!iduModels.has(pt.idu_model)) push(`idu_model not found: ${pt.idu_model}`);
    if (!oduModels.has(pt.odu_model)) push(`odu_model not found: ${pt.odu_model}`);
    if (!pos(pt.pipe_liquid_mm) || !pos(pt.pipe_gas_mm)) push("pipe sizes missing");
    if (!pos(pt.max_length_m) || !num(pt.max_lift_m)) push("length/lift limits missing");
    checkAdditionalCharge(push, pt.additional_charge);
    checkProvenance(push, pt.provenance);
  });

  // multi_rules — referential integrity + rule blocks
  const seenMultiOdu = new Set<string>();
  pack.multi_rules.forEach((r, i) => {
    const push = err("multi_rules", r.odu_model_ref ?? `#${i}`);
    if (!oduModels.has(r.odu_model_ref)) push(`odu_model_ref not found: ${r.odu_model_ref}`);
    if (seenMultiOdu.has(r.odu_model_ref)) push(`duplicate multi_rules for ${r.odu_model_ref}`);
    seenMultiOdu.add(r.odu_model_ref);
    checkCompatibility(push, r.compatibility);
    checkAdditionalCharge(push, r.additional_charge);
    for (const ref of r.branch_box_refs ?? [])
      if (!partModels.has(ref)) push(`branch_box_ref not in parts[]: ${ref}`);
    checkProvenance(push, r.provenance);
  });

  // vrf_pipe_tables — the heaviest referential surface
  pack.vrf_pipe_tables.forEach((t, i) => {
    const push = err("vrf_pipe_tables", t.series ?? `#${i}`);
    if (!str(t.series)) push("series missing");
    else if (seriesRefs.has(t.series)) push("duplicate series");
    seriesRefs.add(t.series);
    checkPipeSizing(push, "pipe_sizing", t.pipe_sizing);
    if (t.branch_sizing) checkPipeSizing(push, "branch_sizing", t.branch_sizing);
    if (t.odu_to_first_joint)
      checkPipeSizing(push, "odu_to_first_joint", t.odu_to_first_joint);
    if (!t.joint_selection?.steps?.length) push("joint_selection.steps empty");
    else
      t.joint_selection.steps.forEach((s, j) => {
        if (!num(s.index_max)) push(`joint_selection.steps[${j}].index_max missing`);
        if (!partModels.has(s.part_ref)) push(`joint_selection part_ref not in parts[]: ${s.part_ref}`);
      });
    for (const [odu, ref] of Object.entries(t.joint_selection?.first_joint_by_odu ?? {})) {
      if (!oduModels.has(odu)) push(`first_joint_by_odu key not an ODU: ${odu}`);
      if (!partModels.has(ref)) push(`first_joint_by_odu part_ref not in parts[]: ${ref}`);
    }
    (t.header_selection?.steps ?? []).forEach((s, j) => {
      if (!partModels.has(s.part_ref)) push(`header_selection part_ref not in parts[]: ${s.part_ref}`);
      if (!num(s.branches_max) || !num(s.index_max)) push(`header_selection.steps[${j}] incomplete`);
    });
    if (!t.limits) push("limits missing");
    checkAdditionalCharge(push, t.additional_charge);
    checkProvenance(push, t.provenance);
  });

  // post-collection outdoor checks (refs into series, ODUs, parts — all now complete)
  for (const o of pack.outdoor_units) {
    const push = err("outdoor_units", o.model);
    if (o.system_type === "vrf" && o.pipe_table_ref && !seriesRefs.has(o.pipe_table_ref))
      push(`pipe_table_ref has no vrf_pipe_tables series: ${o.pipe_table_ref}`);
    // combined multi-module banks reference their constituent modules + twinning kit
    if (o.combined) {
      if (!o.modules || o.modules.length < 2)
        push("combined ODU needs modules[] with ≥2 entries");
      for (const m of o.modules ?? [])
        if (!oduModels.has(m)) push(`module not an outdoor unit: ${m}`);
      if (o.twinning_kit_ref && !partModels.has(o.twinning_kit_ref))
        push(`twinning_kit_ref not in parts[]: ${o.twinning_kit_ref}`);
    } else if (o.modules?.length) {
      warn("outdoor_units", o.model, "modules[] set but combined is not true");
    }
  }

  // accessories — compatibility refs (allow family patterns ending in *)
  for (const a of pack.accessories) {
    const push = err("accessories", a.model ?? "-");
    for (const ref of a.compatible_with ?? []) {
      if (ref.endsWith("*")) continue; // family pattern
      if (!iduModels.has(ref) && !oduModels.has(ref))
        push(`compatible_with not a known unit: ${ref}`);
    }
    checkProvenance(push, a.provenance);
  }

  return { ok: errors.length === 0, errors, warnings };
}
