/* HQ universal-table view-model — the "smart" layer.

   Turns a raw pack + staff overrides into a serialisable, per-row annotated
   catalog: effective values, which fields are MISSING, and whether each gap
   BLOCKS an engine role (Tier-1) or is merely nice-to-know (Tier-3). All
   classification is DERIVED from ready.ts (the single tier engine) — nothing is
   hand-listed — so it can never drift from what the studio actually requires.

   Pure: the server page computes the effective pack here and ships this VM to
   the client instead of the whole DataPack (rule blocks stripped, smaller). */

import type {
  DataPack,
  FormFactor,
  IndoorUnit,
  OutdoorUnit,
  PairTable,
  SystemRole,
  SystemType,
} from "@/lib/studio/packs/schema";
import {
  indoorReadiness,
  outdoorReadiness,
  type Readiness,
  type ReadyRole,
} from "@/lib/studio/packs/ready";
import { multiCapableIdus } from "@/lib/studio/multi";
import {
  EDITABLE_FIELDS,
  fieldSpec,
  isOpeningBox,
  type EditableSection,
  type FieldValue,
  type OpeningBox,
} from "@/lib/studio/packs/fields";
import { applyOverrides, type FieldOverride } from "@/lib/studio/packs/overrides";
import { validatePack } from "@/lib/studio/packs/validate";
import { rowKey } from "@/lib/studio/packs/loader";
import type { ValidationIssue } from "@/lib/studio/packs/validate";

export interface HqGap {
  /** the missing field name, or a structural label (e.g. "pair_tables row") */
  field: string;
  /** engine-blocking (Tier-1) vs nice-to-know (Tier-3) */
  blocks: boolean;
  /** human role labels the gap blocks (e.g. ["ducted","vrf-idu"]); [] when !blocks */
  roles: string[];
  /** true when a v1-editable scalar (staff can fill it here); false = structural */
  fillable: boolean;
}

export interface HqOverrideMark {
  by: string | null;
  at: string | null;
  /** the underlying pack value being shadowed (null when the pack had none) */
  packValue: FieldValue | null;
}

/** an effective cell value: scalar, or an airway opening box ("built-in" /
    "spigots" arrive as plain strings) */
export type HqValue = number | string | OpeningBox | null;

export interface HqRow {
  section: EditableSection;
  rowKey: string;
  title: string;
  subtitle: string;
  /** every system type this row serves — FAN-OUT membership, not a partition.
      A split IDU that also connects to VRF (via branch box, once rules land)
      carries both and appears under both branches of the drill-down. */
  systemTypes: SystemType[];
  /** the effective claimed roles verbatim (IDU only) — what the tag editor
      reads and writes (`system_roles` overrides) */
  roles?: SystemRole[];
  /** memberships DERIVED from pack rules rather than tags (IDU only) — e.g.
      multi via an outdoor rule's family whitelist (multi.ts: "computed, never
      hand-set"). Shown distinctly from tags; not editable. */
  derived?: SystemType[];
  /** series family (e.g. "MSZ-AP", "PEFY-P-VMA-E"); pairs inherit their IDU's */
  series: string;
  /** indoor units only */
  formFactor?: FormFactor;
  /** every editable field for the section → effective value (null when absent) */
  values: Record<string, HqValue>;
  gaps: HqGap[];
  blockingCount: number;
  engineReady: boolean;
  /** field → who/when/pack-value, for cells carrying a manual override */
  overridden: Record<string, HqOverrideMark>;
}

export interface HqCatalogView {
  brand: string;
  version: string;
  indoor: HqRow[];
  outdoor: HqRow[];
  pairs: HqRow[];
  validationErrors: ValidationIssue[];
  /** overrides whose (section,rowKey) no longer match any row — stale, worth
      cleaning up (e.g. after a pack re-issue renamed a model) */
  orphans: FieldOverride[];
}

const DUCTED_FORMS = new Set(["ducted", "bulkhead"]);

/** IDU system_roles → system types, deduped, order preserved (fan-out: a unit
    tagged for several systems belongs to all of them). Defensive default:
    roleless units count as split so they never vanish from the drill-down. */
function iduSystemTypes(roles: SystemRole[] | undefined): SystemType[] {
  const map: Record<SystemRole, SystemType> = {
    "split-pair": "split",
    multi: "multi",
    vrf: "vrf",
  };
  const out: SystemType[] = [];
  for (const r of roles ?? []) {
    const t = map[r];
    if (t && !out.includes(t)) out.push(t);
  }
  return out.length ? out : ["split"];
}

// Nice-to-know (Tier-3) fields whose absence never blocks anything but is worth
// surfacing so staff can complete a row. Role-specific fields (airflow_ls,
// capacity_index, …) are NOT listed here — they surface as blocking gaps only
// when they actually gate a claimed role (via ready.ts).
const IDU_NICE = [
  "sound_low_dba",
  "sound_high_dba",
  "weight_kg",
  "power_supply",
  "max_amps_a",
];
const ODU_NICE = [
  "sound_low_dba",
  "sound_high_dba",
  "weight_kg",
  "power_supply",
  "max_amps_a",
  "precharged_kg",
];

/** Effective cell value for a field: scalar passthrough, airway boxes for
    opening-type fields (copied to a clean two-key object), null otherwise. */
function valueOf(
  section: EditableSection,
  row: Record<string, unknown>,
  field: string
): HqValue {
  const v = row[field];
  if (typeof v === "number" || typeof v === "string") return v;
  if (fieldSpec(section, field)?.type === "opening" && isOpeningBox(v)) {
    return { w_mm: v.w_mm, h_mm: v.h_mm };
  }
  return null;
}

/** Blocking gaps from a readiness result: each missing field → the claimed
    roles that require it. */
function blockingGaps(section: EditableSection, readiness: Readiness): Map<string, HqGap> {
  const byField = new Map<string, HqGap>();
  for (const [role, fields] of Object.entries(readiness.missing)) {
    for (const f of fields ?? []) {
      const g =
        byField.get(f) ??
        ({ field: f, blocks: true, roles: [], fillable: !!fieldSpec(section, f) } as HqGap);
      if (!g.roles.includes(role)) g.roles.push(role as ReadyRole);
      byField.set(f, g);
    }
  }
  return byField;
}

/** Nice-to-know gaps: nice fields that are absent and not already blocking. */
function niceGaps(
  section: EditableSection,
  effRow: Record<string, unknown>,
  niceFields: string[],
  blocking: Map<string, HqGap>
): HqGap[] {
  const out: HqGap[] = [];
  for (const f of niceFields) {
    if (blocking.has(f)) continue;
    if (valueOf(section, effRow, f) === null) {
      out.push({ field: f, blocks: false, roles: [], fillable: !!fieldSpec(section, f) });
    }
  }
  return out;
}

function packValueOf(
  row: Record<string, unknown>,
  field: string
): FieldValue | null {
  const v = row[field];
  if (typeof v === "number" || typeof v === "string") return v;
  if (isOpeningBox(v)) return v;
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  return null;
}

function overrideMarks(
  section: EditableSection,
  rawRow: Record<string, unknown>,
  rowOverrides: FieldOverride[]
): Record<string, HqOverrideMark> {
  const marks: Record<string, HqOverrideMark> = {};
  for (const o of rowOverrides) {
    marks[o.field] = {
      by: o.by ?? null,
      at: o.at ?? null,
      packValue: packValueOf(rawRow, o.field),
    };
  }
  return marks;
}

function editableValues(
  section: EditableSection,
  effRow: Record<string, unknown>,
  fields: string[]
): Record<string, HqValue> {
  const values: Record<string, HqValue> = {};
  for (const f of fields) values[f] = valueOf(section, effRow, f);
  return values;
}

// editable VALUE field names per section, in registry order (stable columns).
// Tags-type fields (system_roles) are excluded — they render as the tag
// control, never as value pills.
const valueFields = (section: EditableSection) =>
  EDITABLE_FIELDS.filter((f) => f.section === section && f.type !== "tags").map(
    (f) => f.field
  );
const EDITABLE_BY_SECTION: Record<EditableSection, string[]> = {
  indoor_units: valueFields("indoor_units"),
  outdoor_units: valueFields("outdoor_units"),
  pair_tables: valueFields("pair_tables"),
};

function fieldsForSection(section: EditableSection): string[] {
  return EDITABLE_BY_SECTION[section];
}

function buildIduRow(
  effPack: DataPack,
  effIdu: IndoorUnit,
  rawIdu: IndoorUnit,
  rowOverrides: FieldOverride[],
  ruleMultiModels: Set<string>
): HqRow {
  const readiness = indoorReadiness(effPack, effIdu);
  const blocking = blockingGaps("indoor_units", readiness);
  const nice = [...IDU_NICE];
  if (DUCTED_FORMS.has(effIdu.form_factor)) nice.push("static_pressure_pa");
  const eff = effIdu as unknown as Record<string, unknown>;
  const gaps = [...blocking.values(), ...niceGaps("indoor_units", eff, nice, blocking)];

  // tags first, then rule-derived memberships the tags don't already claim
  const tagged = iduSystemTypes(effIdu.system_roles);
  const derived: SystemType[] =
    ruleMultiModels.has(effIdu.model) && !tagged.includes("multi") ? ["multi"] : [];

  return {
    section: "indoor_units",
    rowKey: rowKey("indoor_units", effIdu),
    title: effIdu.model,
    subtitle: `${effIdu.form_factor} · ${effIdu.series}`,
    systemTypes: [...tagged, ...derived],
    roles: effIdu.system_roles ?? [],
    derived,
    series: effIdu.series || "Other",
    formFactor: effIdu.form_factor,
    values: editableValues("indoor_units", eff, fieldsForSection("indoor_units")),
    gaps,
    blockingCount: blocking.size,
    engineReady: blocking.size === 0,
    overridden: overrideMarks("indoor_units", rawIdu as unknown as Record<string, unknown>, rowOverrides),
  };
}

function buildOduRow(
  effPack: DataPack,
  effOdu: OutdoorUnit,
  rawOdu: OutdoorUnit,
  rowOverrides: FieldOverride[]
): HqRow {
  const readiness = outdoorReadiness(effPack, effOdu);
  const blocking = blockingGaps("outdoor_units", readiness);
  const eff = effOdu as unknown as Record<string, unknown>;
  const gaps = [...blocking.values(), ...niceGaps("outdoor_units", eff, ODU_NICE, blocking)];
  return {
    section: "outdoor_units",
    rowKey: rowKey("outdoor_units", effOdu),
    title: effOdu.model,
    subtitle: `${effOdu.system_type} · ${effOdu.series}`,
    systemTypes: [effOdu.system_type],
    series: effOdu.series || "Other",
    values: editableValues("outdoor_units", eff, fieldsForSection("outdoor_units")),
    gaps,
    blockingCount: blocking.size,
    engineReady: blocking.size === 0,
    overridden: overrideMarks("outdoor_units", rawOdu as unknown as Record<string, unknown>, rowOverrides),
  };
}

function buildPairRow(
  effPair: PairTable,
  rawPair: PairTable,
  rowOverrides: FieldOverride[],
  idu: IndoorUnit | undefined
): HqRow {
  // Pairs have no ready.ts role of their own. The only hard engine gate is the
  // simulation, which needs at least one rated capacity; missing both blocks it.
  const eff = effPair as unknown as Record<string, unknown>;
  const ratedMissing =
    valueOf("pair_tables", eff, "rated_cool_kw") === null &&
    valueOf("pair_tables", eff, "rated_heat_kw") === null;
  const gaps: HqGap[] = [];
  for (const f of fieldsForSection("pair_tables")) {
    if (valueOf("pair_tables", eff, f) !== null) continue;
    const isRated = f === "rated_cool_kw" || f === "rated_heat_kw";
    if (isRated && ratedMissing) {
      gaps.push({ field: f, blocks: true, roles: ["simulation"], fillable: true });
    } else {
      gaps.push({ field: f, blocks: false, roles: [], fillable: true });
    }
  }
  const blockingCount = gaps.filter((g) => g.blocks).length;
  return {
    section: "pair_tables",
    rowKey: rowKey("pair_tables", effPair),
    title: `${effPair.idu_model} × ${effPair.odu_model}`,
    subtitle: "",
    // pairs are split-world data (1:1 matching); series inherited from the IDU
    systemTypes: ["split"],
    series: idu?.series || "Other",
    values: editableValues("pair_tables", eff, fieldsForSection("pair_tables")),
    gaps,
    blockingCount,
    engineReady: blockingCount === 0,
    overridden: overrideMarks("pair_tables", rawPair as unknown as Record<string, unknown>, rowOverrides),
  };
}

function groupOverrides(overrides: FieldOverride[]): Map<string, FieldOverride[]> {
  const m = new Map<string, FieldOverride[]>();
  for (const o of overrides) {
    const k = `${o.section}::${o.rowKey}`;
    const list = m.get(k);
    if (list) list.push(o);
    else m.set(k, [o]);
  }
  return m;
}

/** Build the annotated catalog view for one pack, with staff overrides applied. */
export function buildCatalogView(
  rawPack: DataPack,
  overrides: FieldOverride[],
  meta?: { brand?: string; version?: string }
): HqCatalogView {
  const eff = applyOverrides(rawPack, overrides);
  const grouped = groupOverrides(overrides);
  const ovFor = (section: EditableSection, key: string) =>
    grouped.get(`${section}::${key}`) ?? [];

  // rule-derived multi capability, engine-exact (multi.ts family whitelists —
  // extracted pack data only, computed the same way the studio computes it)
  const ruleMultiModels = new Set(multiCapableIdus(eff).map((u) => u.model));

  const indoor = rawPack.indoor_units.map((raw, i) =>
    buildIduRow(
      eff,
      eff.indoor_units[i],
      raw,
      ovFor("indoor_units", rowKey("indoor_units", raw)),
      ruleMultiModels
    )
  );
  const outdoor = rawPack.outdoor_units.map((raw, i) =>
    buildOduRow(eff, eff.outdoor_units[i], raw, ovFor("outdoor_units", rowKey("outdoor_units", raw)))
  );
  const iduByModel = new Map(eff.indoor_units.map((u) => [u.model, u]));
  const pairs = rawPack.pair_tables.map((raw, i) =>
    buildPairRow(
      eff.pair_tables[i],
      raw,
      ovFor("pair_tables", rowKey("pair_tables", raw)),
      iduByModel.get(raw.idu_model)
    )
  );

  // orphans: overrides that matched no row in the pack (applyOverrides ignores them)
  const validKeys: Record<string, Set<string>> = {
    indoor_units: new Set(rawPack.indoor_units.map((r) => rowKey("indoor_units", r))),
    outdoor_units: new Set(rawPack.outdoor_units.map((r) => rowKey("outdoor_units", r))),
    pair_tables: new Set(rawPack.pair_tables.map((r) => rowKey("pair_tables", r))),
  };
  const orphans = overrides.filter((o) => !validKeys[o.section]?.has(o.rowKey));

  return {
    brand: meta?.brand ?? rawPack.meta.brand,
    version: meta?.version ?? rawPack.meta.version,
    indoor,
    outdoor,
    pairs,
    validationErrors: validatePack(eff).errors,
    orphans,
  };
}

export interface CatalogKpis {
  units: number;
  engineReady: number;
  readyPct: number;
  blockingGaps: number;
}

/** Roll a view up into overview KPIs (units = IDU+ODU; pairs are not units). */
export function catalogKpis(view: HqCatalogView): CatalogKpis {
  const rows = [...view.indoor, ...view.outdoor];
  const engineReady = rows.filter((r) => r.engineReady).length;
  const blockingGaps = [...rows, ...view.pairs].reduce((n, r) => n + r.blockingCount, 0);
  return {
    units: rows.length,
    engineReady,
    readyPct: rows.length ? Math.round((engineReady / rows.length) * 100) : 0,
    blockingGaps,
  };
}
