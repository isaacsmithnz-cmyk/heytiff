/* Design Studio — multi-split engine (Stage 5). One shared outdoor, an indoor
   unit per room: the per-room selections live on `settings.multiIdus`
   (roomId → indoor model) and the shared outdoor reuses `settings.pairOdu`
   (the split key, so components/object resolution work unchanged). Pure
   functions over (document, dataPack) — no React, no canvas.

   Selection reads ONLY the pack's multi sections for matching — which indoor
   units a multi outdoor accepts comes from `multi_rules.compatibility`
   (universal-table-schema.md §5), never a guess. The badge the cockpit shows
   ("3/4 ports · 112% combo") is derived here. */

import type { DesignDocument, DesignObject, DesignSystem } from "./document";
import type {
  CompatibilityRule,
  DataPack,
  IndoorUnit,
  MultiRule,
  OutdoorUnit,
} from "./packs/schema";
import { outdoorReadiness } from "./packs/ready";
import { capacityFit, type UnitFit } from "./fit";
import { roomLoadKw, type RoomObj } from "./loads-room";
import { roomsServedBy } from "./coverage";
import { sizingCapacityKw, type SizingBasis } from "./loads";
import { buildSystemGraph, findPath } from "./graph";
// type-only — a runtime import of split.ts here would cycle (its systemBadge
// dispatches to validateMultiSystem below)
import type { BadgeStatus, Finding } from "./split";

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

/* ───────────────────── graph validation (the badge) ─────────────────────
   The multi mirror of validateSplitSystem: judges what is actually PLACED on
   the plan. Selection state (settings.multiIdus) stays the cockpit's business
   (multiConnection / coverage). One shared outdoor, a branch per indoor. */

export interface MultiBranch {
  /** placed indoor-unit object id */
  iduId: string;
  model: string;
  /** null = model not in the pack */
  idu: IndoorUnit | null;
  /** props.roomId stamp; "" when the unit sits outside any room */
  roomId: string;
  roomName: string;
  /** 0-based port after allocation; null = no rule / beyond the port count */
  port: number | null;
  liquidMm: number | null;
  gasMm: number | null;
  connected: boolean;
  /** metres along this branch's IDU→ODU path; null = unconnected/uncalibrated */
  lengthM: number | null;
  liftM: number | null;
}

export interface MultiValidation {
  status: BadgeStatus;
  findings: Finding[];
  /** one per placed indoor unit, in port order */
  branches: MultiBranch[];
  /** Σ branch path lengths — each port runs its own pair coil end-to-end, so
      a shared drawn segment counts once per branch riding it (the books state
      the total limit as the sum of the per-room lines). Null while any placed
      indoor is unconnected or any branch is uncalibrated. */
  totalLengthM: number | null;
  rule: MultiRule | null;
  oduModel: string;
  odu: DesignObject | null;
}

const propModel = (o: DesignObject): string => String(o.props.model ?? "");

/** Validate one multi-split system: one shared approved outdoor, every placed
    indoor connected to it, each branch and the total within the rule's
    length/lift limits. Mirrors validateSplitSystem stanza for stanza. */
export function validateMultiSystem(
  doc: DesignDocument,
  pack: DataPack,
  systemId: string
): MultiValidation {
  const findings: Finding[] = [];
  const objs = doc.objects.filter((o) => o.systemId === systemId);
  const units = objs.filter((o) => o.type === "unit");
  const idus = units.filter((o) => o.props.role === "idu");
  const odus = units.filter((o) => o.props.role === "odu");
  const runs = objs.filter((o) => o.type === "pipe-run");
  const risers = objs.filter((o) => o.type === "riser");

  // Unlike split, multi rooms carry the system id — so "empty" is judged on
  // placed gear only, not on every object the system owns.
  if (units.length + runs.length + risers.length === 0) {
    return {
      status: "empty",
      findings,
      branches: [],
      totalLengthM: null,
      rule: null,
      oduModel: "",
      odu: null,
    };
  }

  if (idus.length === 0)
    findings.push({ severity: "red", code: "no-idu", message: "Place the indoor units" });
  if (odus.length === 0)
    findings.push({
      severity: "red",
      code: "no-odu",
      message: "Place the shared outdoor unit",
    });
  if (odus.length > 1)
    findings.push({
      severity: "red",
      code: "extra-units",
      message: "A multi-split system shares exactly one outdoor unit",
    });

  const odu = odus[0] ?? null;
  const oduModel = odu ? propModel(odu) : "";

  // the outdoor's rule row — from the PLACED outdoor, as split resolves its
  // pair from what's on the plan
  let rule: MultiRule | null = null;
  let oduSpec: OutdoorUnit | null = null;
  if (odu) {
    oduSpec = pack.outdoor_units.find((o) => o.model === oduModel) ?? null;
    if (!oduSpec) {
      findings.push({
        severity: "red",
        code: "unknown-model",
        message: `Unknown model: ${oduModel}`,
      });
    } else {
      rule = pack.multi_rules.find((r) => r.odu_model_ref === oduModel) ?? null;
      if (!rule)
        findings.push({
          severity: "red",
          code: "no-rule",
          message: `${oduModel} has no multi rules in this pack`,
        });
    }
  }

  // placed indoor specs (duplicates count — two of a model use two ports)
  const specByModel = new Map(pack.indoor_units.map((u) => [u.model, u]));
  const unknownIdus = new Set<string>();
  const iduSpecs: IndoorUnit[] = [];
  for (const u of idus) {
    const spec = specByModel.get(propModel(u));
    if (spec) iduSpecs.push(spec);
    else if (propModel(u)) unknownIdus.add(propModel(u));
  }
  for (const m of unknownIdus)
    findings.push({ severity: "red", code: "unknown-model", message: `Unknown model: ${m}` });

  // catalogue compatibility — MultiFinding shares Finding's shape (split.ts)
  if (oduSpec && rule) findings.push(...checkMultiCompatibility(rule, oduSpec, iduSpecs));

  const roomName = (roomId: string): string => {
    if (!roomId) return "";
    const room = doc.objects.find((o) => o.id === roomId && o.type === "room");
    return String(room?.props.name ?? "");
  };

  // Port allocation: the books hang the highest-capacity indoor on port A —
  // the port with the larger gas line on the 4/5/6-port outdoors. Catalogue
  // cool kW (basis-independent) so the takeoff never flips with the sizing
  // basis; ties break by model then object id for determinism.
  const ordered = [...idus].sort((a, b) => {
    const ka = specByModel.get(propModel(a))?.capacity_cool_kw ?? -1;
    const kb = specByModel.get(propModel(b))?.capacity_cool_kw ?? -1;
    return (
      kb - ka ||
      propModel(a).localeCompare(propModel(b)) ||
      a.id.localeCompare(b.id)
    );
  });

  // connectivity + limits (graph v0) — needs the shared outdoor placed
  const graph = odu ? buildSystemGraph(doc.objects, doc.floors, systemId) : null;
  const branches: MultiBranch[] = [];
  let totalLengthM: number | null = odu && idus.length ? 0 : null;
  let uncalibrated = false;

  ordered.forEach((u, i) => {
    const model = propModel(u);
    const port = rule && i < rule.port_pipe_sizes.length ? i : null;
    const sizes = port != null && rule ? rule.port_pipe_sizes[port] : null;
    const roomId = String(u.props.roomId ?? "");
    const rn = roomName(roomId);

    const path = graph && odu ? findPath(graph, u.id, odu.id) : null;
    const lengthM = path?.lengthM ?? null;
    const liftM = path ? path.liftM : null;

    if (odu && !path) {
      totalLengthM = null;
      findings.push({
        severity: "red",
        code: "not-connected",
        message:
          runs.length === 0
            ? "Draw the refrigerant runs between each indoor and the outdoor unit"
            : `${rn || model || "An indoor unit"} isn't connected — snap a run to its anchors`,
      });
    } else if (path && lengthM == null) {
      totalLengthM = null;
      uncalibrated = true;
    } else if (path && lengthM != null) {
      if (totalLengthM != null) totalLengthM += lengthM;
      if (rule) {
        if (lengthM > rule.max_per_branch_m)
          findings.push({
            severity: "red",
            code: "over-length",
            message: `${rn || model}: branch is ${lengthM.toFixed(1)} m — max ${rule.max_per_branch_m} m per branch on ${oduModel}`,
          });
        if (liftM != null && liftM > rule.max_lift_m)
          findings.push({
            severity: "red",
            code: "over-lift",
            message: `${rn || model}: height difference is ${liftM.toFixed(1)} m — max ${rule.max_lift_m} m on ${oduModel}`,
          });
      }
    }

    branches.push({
      iduId: u.id,
      model,
      idu: specByModel.get(model) ?? null,
      roomId,
      roomName: rn,
      port,
      liquidMm: sizes?.liquid_mm ?? null,
      gasMm: sizes?.gas_mm ?? null,
      connected: Boolean(path),
      lengthM,
      liftM,
    });
  });

  if (uncalibrated)
    findings.push({
      severity: "amber",
      code: "uncalibrated",
      message: "Floor not calibrated — pipe lengths are unknown",
    });

  if (totalLengthM != null && rule && totalLengthM > rule.max_total_pipe_m)
    findings.push({
      severity: "red",
      code: "over-total-length",
      message: `Total pipework is ${totalLengthM.toFixed(1)} m — max ${rule.max_total_pipe_m} m on ${oduModel}`,
    });

  if (graph && graph.orphanRuns.length)
    findings.push({
      severity: "amber",
      code: "orphan-run",
      message: `${graph.orphanRuns.length} run${graph.orphanRuns.length > 1 ? "s" : ""} not attached at both ends`,
    });

  const status: BadgeStatus = findings.some((f) => f.severity === "red")
    ? "red"
    : findings.some((f) => f.severity === "amber")
      ? "amber"
      : "green";
  return { status, findings, branches, totalLengthM, rule, oduModel, odu };
}
