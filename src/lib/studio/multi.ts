/* Design Studio — multi-split engine (Stage 5). One shared outdoor, an indoor
   unit per room: the per-room selections live on `settings.multiIdus`
   (roomId → indoor model) and the shared outdoor reuses `settings.pairOdu`
   (the split key, so components/object resolution work unchanged). Pure
   functions over (document, dataPack) — no React, no canvas.

   Selection reads ONLY the pack's multi sections for matching — which indoor
   units a multi outdoor accepts comes from `multi_rules.compatibility`
   (universal-table-schema.md §5), never a guess. The badge the cockpit shows
   ("3/4 ports · 112% combo") is derived here. */

import type { DesignDocument, DesignSystem } from "./document";
import type {
  CompatibilityRule,
  DataPack,
  FormFactor,
  IndoorUnit,
  MultiRule,
  OutdoorUnit,
} from "./packs/schema";
import { outdoorReadiness } from "./packs/ready";
import { capacityFit, type UnitFit } from "./fit";
import { roomLoadKw, type RoomObj } from "./loads-room";
import { roomsServedBy } from "./coverage";
import { sizingCapacityKw, type SizingBasis } from "./loads";
import {
  FORM_FACTOR_LABELS,
  type FormFactorCount,
  type SelectFilters,
  type SelectSort,
} from "./select";

/* ─────────────────────────── settings readers ─────────────────────────── */

/** `settings.multiIdus` — roomId → chosen indoor model. Tolerates any stored
    shape; non-string entries are dropped. (coverage.ts reads the same key
    inline for its pending calculation — keep the two in step.) */
export function multiIduSelections(system: DesignSystem): Record<string, string> {
  const v = system.settings.multiIdus;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [roomId, model] of Object.entries(v as Record<string, unknown>)) {
    if (typeof model === "string" && model) out[roomId] = model;
  }
  return out;
}

/* ─────────────────────── multi-capable indoor units ───────────────────────
   The ME pack doesn't stamp `system_roles: ["multi"]` on indoor rows — the
   authorisation lives in the outdoor rules' compatibility blocks (family
   whitelists are printed model prefixes, e.g. "MSZ-AP" ← "MSZ-AP25VGK").
   Capability is therefore DERIVED: an indoor unit is multi-capable when at
   least one multi rule's compatibility could accept it. Computed, never
   hand-set — same spirit as ready.ts. */

const inFamily = (model: string, families: string[]): boolean =>
  families.some((f) => model.startsWith(f));

/** could this indoor unit satisfy this rule's compatibility, on its own? */
function iduEligibleForRule(rule: MultiRule, idu: IndoorUnit): boolean {
  return rule.compatibility.every((c) => {
    switch (c.method) {
      case "family_whitelist_with_limits":
        if (!inFamily(idu.model, c.families)) return false;
        if (c.per_port_max_kw != null && idu.capacity_cool_kw > c.per_port_max_kw)
          return false;
        if (c.capacity_min_kw != null && idu.capacity_cool_kw < c.capacity_min_kw)
          return false;
        if (c.capacity_max_kw != null && idu.capacity_cool_kw > c.capacity_max_kw)
          return false;
        if (
          (c.index_min != null || c.index_max != null) &&
          idu.capacity_index == null
        )
          return false;
        if (c.index_min != null && (idu.capacity_index ?? 0) < c.index_min) return false;
        if (c.index_max != null && (idu.capacity_index ?? 0) > c.index_max) return false;
        return true;
      case "explicit_combination_table":
        return c.combos.some((combo) => combo.includes(idu.model));
      case "index_ratio_band":
        if (idu.capacity_index == null) return false;
        if (c.index_min != null && idu.capacity_index < c.index_min) return false;
        if (c.index_max != null && idu.capacity_index > c.index_max) return false;
        return true;
    }
  });
}

const hasNum = (n: number | undefined): boolean =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

/** placeable + sized indoor units accepted by at least one multi outdoor */
export function multiCapableIdus(pack: DataPack): IndoorUnit[] {
  if (pack.multi_rules.length === 0) return [];
  return pack.indoor_units.filter(
    (u) =>
      hasNum(u.capacity_cool_kw) &&
      hasNum(u.capacity_heat_kw) &&
      hasNum(u.width_mm) &&
      hasNum(u.depth_mm) &&
      pack.multi_rules.some((r) => iduEligibleForRule(r, u))
  );
}

/* ─────────────────────── per-room IDU proposals ─────────────────────── */

/** Oversize cap for the per-room ranking — mirrors select.ts (OVERSIZE_CAP). */
export const MULTI_OVERSIZE_CAP = 1.5;

export interface MultiIduProposal {
  idu: IndoorUnit;
  /** capacity under the sizing basis */
  capacityKw: number;
  /** how that capacity sizes against the room load */
  fit: UnitFit;
  /** smallest option that SUITS the room load */
  bestFit: boolean;
}

/** Multi-capable indoor units sized under `basis`, smallest-first, each
    labelled with how it sizes against the load. Nothing is filtered out —
    the picker leads with what suits and files the rest underneath, same as
    the split selector. Without a load everything reads `fits`. */
export function proposeMultiIdus(
  pack: DataPack,
  loadKw: number | null,
  basis: SizingBasis
): MultiIduProposal[] {
  const all: MultiIduProposal[] = multiCapableIdus(pack).map((idu) => {
    const capacityKw = sizingCapacityKw(idu, basis);
    return {
      idu,
      capacityKw,
      fit: capacityFit(capacityKw, loadKw, MULTI_OVERSIZE_CAP),
      bestFit: false,
    };
  });
  all.sort((a, b) => a.capacityKw - b.capacityKw || a.idu.model.localeCompare(b.idu.model));

  // smallest SUITABLE unit — an oversized or undersized row is never the pick
  const best = all.find((p) => p.fit === "fits");
  if (loadKw != null && best) best.bestFit = true;
  return all;
}

/* ─────────────────────── compatibility validation ───────────────────────
   "All present blocks must pass" (schema §5). Hard breaches — a model outside
   the whitelist, too many units, a port limit exceeded — are red. Bounds a
   PARTIAL selection can still grow into (ratio under its minimum) are amber. */

export interface MultiFinding {
  severity: "red" | "amber";
  code:
    | "not-in-whitelist"
    | "over-max-count"
    | "over-per-port"
    | "outside-capacity-band"
    | "outside-index-band"
    | "not-in-combination-table"
    | "ratio-under"
    | "ratio-over"
    | "index-unknown"
    | "over-ports"
    | "no-rule";
  message: string;
}

function checkBlock(
  c: CompatibilityRule,
  odu: OutdoorUnit,
  idus: IndoorUnit[]
): MultiFinding[] {
  const out: MultiFinding[] = [];
  switch (c.method) {
    case "family_whitelist_with_limits": {
      for (const u of idus) {
        if (!inFamily(u.model, c.families))
          out.push({
            severity: "red",
            code: "not-in-whitelist",
            message: `${u.model} isn't approved on ${odu.model}`,
          });
        else if (c.per_port_max_kw != null && u.capacity_cool_kw > c.per_port_max_kw)
          out.push({
            severity: "red",
            code: "over-per-port",
            message: `${u.model} is ${u.capacity_cool_kw} kW — max ${c.per_port_max_kw} kW per port on ${odu.model}`,
          });
        else if (
          (c.capacity_min_kw != null && u.capacity_cool_kw < c.capacity_min_kw) ||
          (c.capacity_max_kw != null && u.capacity_cool_kw > c.capacity_max_kw)
        )
          out.push({
            severity: "red",
            code: "outside-capacity-band",
            message: `${u.model} is outside ${odu.model}'s capacity band`,
          });
        else if (
          (c.index_min != null && (u.capacity_index ?? -Infinity) < c.index_min) ||
          (c.index_max != null && (u.capacity_index ?? Infinity) > c.index_max)
        )
          out.push({
            severity: "red",
            code: "outside-index-band",
            message: `${u.model} is outside ${odu.model}'s index band`,
          });
      }
      if (c.max_count != null && idus.length > c.max_count)
        out.push({
          severity: "red",
          code: "over-max-count",
          message: `${idus.length} indoor units — ${odu.model} accepts up to ${c.max_count}`,
        });
      return out;
    }
    case "explicit_combination_table": {
      // a partial selection passes while it is a sub-multiset of SOME combo
      const counts = new Map<string, number>();
      for (const u of idus) counts.set(u.model, (counts.get(u.model) ?? 0) + 1);
      const fitsSome = c.combos.some((combo) => {
        const avail = new Map<string, number>();
        for (const m of combo) avail.set(m, (avail.get(m) ?? 0) + 1);
        for (const [m, n] of counts) if ((avail.get(m) ?? 0) < n) return false;
        return true;
      });
      if (idus.length > 0 && !fitsSome)
        out.push({
          severity: "red",
          code: "not-in-combination-table",
          message: `This combination isn't in ${odu.model}'s approved table`,
        });
      return out;
    }
    case "index_ratio_band": {
      if (idus.length > c.max_idus)
        out.push({
          severity: "red",
          code: "over-max-count",
          message: `${idus.length} indoor units — ${odu.model} accepts up to ${c.max_idus}`,
        });
      // the band's per-unit index bounds are a hard limit, same as the
      // whitelist arm's — `iduEligibleForRule` honours them, so the whole-set
      // check must too or an out-of-range unit picked by hand passes silently
      for (const u of idus) {
        const idx = u.capacity_index;
        if (idx == null) continue; // reported as index-unknown below
        if (
          (c.index_min != null && idx < c.index_min) ||
          (c.index_max != null && idx > c.index_max)
        )
          out.push({
            severity: "red",
            code: "outside-index-band",
            message: `${u.model} is index P${idx} — ${odu.model} takes P${c.index_min ?? 0}–P${c.index_max ?? "∞"}`,
          });
      }
      const missing = idus.filter((u) => u.capacity_index == null);
      if (missing.length) {
        out.push({
          severity: "amber",
          code: "index-unknown",
          message: `Capacity index missing for ${missing.length} unit${missing.length === 1 ? "" : "s"} — ratio unchecked`,
        });
        return out;
      }
      if (odu.capacity_index == null) {
        out.push({
          severity: "amber",
          code: "index-unknown",
          message: `${odu.model} has no capacity index — ratio unchecked`,
        });
        return out;
      }
      if (idus.length > 0) {
        const ratio =
          (idus.reduce((a, u) => a + (u.capacity_index ?? 0), 0) / odu.capacity_index) *
          100;
        if (ratio > c.ratio_max_pct)
          out.push({
            severity: "red",
            code: "ratio-over",
            message: `Connected index is ${Math.round(ratio)}% — max ${c.ratio_max_pct}% on ${odu.model}`,
          });
        // under-minimum is amber: more rooms/units may still be coming
        else if (ratio < c.ratio_min_pct)
          out.push({
            severity: "amber",
            code: "ratio-under",
            message: `Connected index is ${Math.round(ratio)}% — ${odu.model} needs ≥ ${c.ratio_min_pct}%`,
          });
      }
      return out;
    }
  }
}

/** Every compatibility block + the port count, for a chosen indoor set. */
export function checkMultiCompatibility(
  rule: MultiRule,
  odu: OutdoorUnit,
  idus: IndoorUnit[]
): MultiFinding[] {
  const findings = rule.compatibility.flatMap((c) => checkBlock(c, odu, idus));
  if (odu.ports != null && idus.length > odu.ports)
    findings.push({
      severity: "red",
      code: "over-ports",
      message: `${idus.length} indoor units — ${odu.model} has ${odu.ports} ports`,
    });
  return findings;
}

/* ─────────────────────── shared-outdoor proposals ─────────────────────── */

export interface MultiOduProposal {
  odu: OutdoorUnit;
  rule: MultiRule;
  /** capacity under the sizing basis */
  capacityKw: number;
  ports: number;
  /** findings against the CURRENT indoor set (empty = clean fit) */
  findings: MultiFinding[];
  /** no red findings for the current indoor set */
  fits: boolean;
  /** smallest clean fit that also covers the summed room load (when known) */
  recommended: boolean;
}

/** Multi-ready outdoors (ready.ts gate) judged against the chosen indoor
    set, fitting units first, smallest first. `requiredKw` — normally the
    summed served-room loads — picks the recommendation; without it the
    smallest clean fit is recommended. */
export function proposeMultiOdus(
  pack: DataPack,
  idus: IndoorUnit[],
  basis: SizingBasis,
  opts: { requiredKw?: number | null } = {}
): MultiOduProposal[] {
  const out: MultiOduProposal[] = [];
  for (const odu of pack.outdoor_units) {
    if (odu.system_type !== "multi") continue;
    if (!outdoorReadiness(pack, odu).roles.multi) continue;
    const rule = pack.multi_rules.find((r) => r.odu_model_ref === odu.model);
    if (!rule || odu.ports == null) continue; // readiness guarantees these; belt+braces
    const findings = checkMultiCompatibility(rule, odu, idus);
    out.push({
      odu,
      rule,
      capacityKw: sizingCapacityKw(odu, basis),
      ports: odu.ports,
      findings,
      fits: !findings.some((f) => f.severity === "red"),
      recommended: false,
    });
  }
  out.sort(
    (a, b) =>
      Number(b.fits) - Number(a.fits) ||
      a.capacityKw - b.capacityKw ||
      a.odu.model.localeCompare(b.odu.model)
  );
  const required = opts.requiredKw ?? null;
  const pick =
    (required != null
      ? out.find((p) => p.fits && p.capacityKw >= required)
      : undefined) ?? out.find((p) => p.fits);
  if (pick) pick.recommended = true;
  return out;
}

/* ───────────────────── the connection derivation ─────────────────────
   Everything the cockpit's capacity hero + shared-outdoor section render:
   the per-room picks (placed unit wins, else the stored selection), the
   connected capacity, the resolved outdoor, and the rule findings. */

export interface MultiRoomPick {
  room: RoomObj;
  /** "" = no indoor unit chosen for this room yet */
  model: string;
  idu: IndoorUnit | null;
  /** sizing capacity; null when the model isn't in the pack (or none chosen) */
  kw: number | null;
  placed: boolean;
  placedId: string | null;
}

export interface MultiConnection {
  rooms: MultiRoomPick[];
  /** rooms with an indoor unit chosen or placed */
  iduCount: number;
  /** Σ chosen indoor sizing capacity — null until any unit resolves a kw */
  connectedKw: number | null;
  /** Σ known served-room loads (the outdoor sizing hint) — null until any derive */
  requiredKw: number | null;
  /** served rooms whose load couldn't derive (uncalibrated floor etc.) */
  unknownRooms: number;
  /** placed outdoor model wins, else settings.pairOdu; "" = none */
  oduModel: string;
  odu: OutdoorUnit | null;
  /** the outdoor's sizing capacity — the gauge denominator */
  oduKw: number | null;
  rule: MultiRule | null;
  ports: number | null;
  portsUsed: number;
  /** connected / outdoor capacity ×100, uncapped (over-connection reads >100) */
  comboPct: number | null;
  oduPlaced: boolean;
  placedOduId: string | null;
  findings: MultiFinding[];
}

export function multiConnection(
  doc: DesignDocument,
  pack: DataPack | null,
  system: DesignSystem,
  basis: SizingBasis
): MultiConnection {
  const served = roomsServedBy(doc, system.id);
  const selections = multiIduSelections(system);
  const mine = doc.objects.filter((o) => o.systemId === system.id && o.type === "unit");

  let requiredKw: number | null = null;
  let unknownRooms = 0;
  const rooms: MultiRoomPick[] = served.map((room) => {
    const load = roomLoadKw(doc, room);
    if (load == null) unknownRooms++;
    else requiredKw = (requiredKw ?? 0) + load;

    const placedIdu =
      mine.find((o) => o.props.role === "idu" && o.props.roomId === room.id) ?? null;
    const model = String(placedIdu?.props.model ?? selections[room.id] ?? "");
    const idu = model ? (pack?.indoor_units.find((u) => u.model === model) ?? null) : null;
    return {
      room,
      model,
      idu,
      kw: idu ? sizingCapacityKw(idu, basis) : null,
      placed: Boolean(placedIdu),
      placedId: placedIdu?.id ?? null,
    };
  });

  const chosen = rooms.filter((r) => r.model);
  const withKw = chosen.filter((r) => r.kw != null);
  const connectedKw = withKw.length
    ? withKw.reduce((a, r) => a + (r.kw ?? 0), 0)
    : null;

  const placedOdu = mine.find((o) => o.props.role === "odu") ?? null;
  const oduModel = String(placedOdu?.props.model ?? system.settings.pairOdu ?? "");
  const odu = oduModel
    ? (pack?.outdoor_units.find((o) => o.model === oduModel) ?? null)
    : null;
  const rule = odu
    ? (pack?.multi_rules.find((r) => r.odu_model_ref === odu.model) ?? null)
    : null;

  const oduKw = odu ? sizingCapacityKw(odu, basis) : null;
  const comboPct =
    connectedKw != null && oduKw != null && oduKw > 0
      ? (connectedKw / oduKw) * 100
      : null;

  const iduSpecs = chosen.map((r) => r.idu).filter((u): u is IndoorUnit => u != null);
  const findings: MultiFinding[] = [];
  if (odu) {
    if (rule) findings.push(...checkMultiCompatibility(rule, odu, iduSpecs));
    else
      findings.push({
        severity: "amber",
        code: "no-rule",
        message: `No multi rules for ${odu.model} in this pack`,
      });
  }

  return {
    rooms,
    iduCount: chosen.length,
    connectedKw,
    requiredKw,
    unknownRooms,
    oduModel,
    odu,
    oduKw,
    rule,
    ports: odu?.ports ?? null,
    portsUsed: chosen.length,
    comboPct,
    oduPlaced: Boolean(placedOdu),
    placedOduId: placedOdu?.id ?? null,
    findings,
  };
}

/* ── the per-room selector: the big units modal, in multi's terms ─────────
   The modal was built for the pair flow, where a row IS an indoor unit plus
   the outdoor units it can pair with. A multi row has no pairing: the outdoor
   is chosen ONCE for the whole system, and each room only picks its indoor
   head. These two functions are the multi equivalents of select.ts's
   `unitOptions` and `formFactorSummary`, deliberately mirroring their
   semantics — same filters, same "bestFit is the smallest FITTING option",
   same sort keys — so the one modal ranks the same way whichever flow is
   driving it. Eligibility is multi-capability (derived from the outdoor
   rules' family whitelists, see multiCapableIdus), never the pair table. */

const numOr = (v: number | undefined): number =>
  typeof v === "number" ? v : Infinity;

export interface MultiSelectCriteria {
  loadKw: number | null;
  basis: SizingBasis;
  /** null = every capable form factor */
  formFactor?: FormFactor | null;
  filters?: SelectFilters;
  sort?: SelectSort;
}

/** Multi-capable indoor units for ONE room: filtered, ranked and flagged the
    way the modal's table expects. */
export function multiUnitOptions(
  pack: DataPack,
  criteria: MultiSelectCriteria
): MultiIduProposal[] {
  const { loadKw, basis, formFactor = null, filters = {}, sort = "capacity" } = criteria;

  let rows = proposeMultiIdus(pack, loadKw, basis).filter(
    (p) => formFactor == null || p.idu.form_factor === formFactor
  );

  const { maxWidthMm, maxDepthMm, maxHeightMm, minAirflowLs } = filters;
  rows = rows.filter((p) => {
    if (maxWidthMm != null && numOr(p.idu.width_mm) > maxWidthMm) return false;
    if (maxDepthMm != null && numOr(p.idu.depth_mm) > maxDepthMm) return false;
    if (maxHeightMm != null && numOr(p.idu.height_mm) > maxHeightMm) return false;
    if (minAirflowLs != null && (p.idu.airflow_ls ?? 0) < minAirflowLs) return false;
    return true;
  });

  /* proposeMultiIdus flags bestFit across the WHOLE capable catalogue; once a
     tab or the fit filters have narrowed the view, that flag can point at a
     row nobody can see — leaving the table with no recommendation at all. So
     re-derive it here: the smallest FITTING capacity in THIS view, exactly as
     unitOptions does.

     The clear can't change today's answer — the proposer only ever flags the
     globally smallest fitting row, which is still the smallest in any subset
     that contains it — so it is a belt, not the fix. It is here so this
     function's answer depends on its own view and nothing else, which stops
     being free the day the proposer flags anything different. The fix is the
     re-derivation below; delete that and a narrowed tab shows no
     recommendation at all. */
  rows = rows.map((p) => ({ ...p, bestFit: false }));
  if (loadKw != null) {
    const fitting = rows.filter((p) => p.fit === "fits");
    if (fitting.length) {
      let best = fitting[0];
      for (const p of fitting) if (p.capacityKw < best.capacityKw) best = p;
      best.bestFit = true;
    }
  }

  const key = (p: MultiIduProposal): number => {
    switch (sort) {
      case "capacity":
        return p.capacityKw;
      case "width":
        return numOr(p.idu.width_mm);
      case "depth":
        return numOr(p.idu.depth_mm);
      case "height":
        return numOr(p.idu.height_mm);
      case "airflow":
        return -(p.idu.airflow_ls ?? -Infinity);
    }
  };
  rows.sort((a, b) => key(a) - key(b) || a.idu.model.localeCompare(b.idu.model));
  return rows;
}

/** Tab counts over the multi-capable catalogue (the pair-flow summary counts
    pairings, which a multi has none of). */
export function multiFormFactorSummary(
  pack: DataPack,
  loadKw: number | null,
  basis: SizingBasis
): FormFactorCount[] {
  const rows = proposeMultiIdus(pack, loadKw, basis);
  const counts = new Map<FormFactor, Set<string>>();
  const fits = new Map<FormFactor, Set<string>>();
  for (const p of rows) {
    const set = counts.get(p.idu.form_factor) ?? new Set<string>();
    set.add(p.idu.model);
    counts.set(p.idu.form_factor, set);
    if (p.fit === "fits") {
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
