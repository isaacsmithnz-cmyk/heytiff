/* Design Studio — Split (1:1) system module (Stage 4).
   The first system module, deliberately the simplest: it exercises the whole
   spine (system → room load → pair selection → placement → run → validation →
   materials). Pure functions over (document, dataPack) — no React, no canvas.
   (design-studio-plan.md, Layer 3 "Split" + Stage 4 lock gate.)

   Selection reads ONLY pair_tables for matching — the split engine never
   guesses a pairing (universal-table-schema.md §4). */

import type { DesignDocument, DesignObject, DesignSystem } from "./document";
import type { DataPack, IndoorUnit, OutdoorUnit, PairTable } from "./packs/schema";
import { indoorReadiness } from "./packs/ready";
import { buildSystemGraph, findPath, type SystemGraph } from "./graph";
import { sizingCapacityKw, type SizingBasis } from "./loads";

/* ─────────────────────────── pair proposals ─────────────────────────── */

export interface PairProposal {
  pair: PairTable;
  idu: IndoorUnit;
  odu: OutdoorUnit;
  /** capacity under the sizing basis (pair ratings when present, else unit) */
  capacityKw: number;
  coolKw: number;
  heatKw: number;
  /** smallest pair that still covers the load */
  recommended: boolean;
}

/** Matched pairs from the brand's pair table, engine-ready only, sized under
    `basis`. With a load: covering pairs sorted smallest-first and the first
    marked recommended. Without a load: the full catalogue, smallest-first. */
export function proposePairs(
  pack: DataPack,
  loadKw: number | null,
  basis: SizingBasis,
  opts: { formFactor?: string } = {}
): PairProposal[] {
  const idus = new Map(pack.indoor_units.map((u) => [u.model, u]));
  const odus = new Map(pack.outdoor_units.map((o) => [o.model, o]));

  const all: PairProposal[] = [];
  for (const pair of pack.pair_tables) {
    const idu = idus.get(pair.idu_model);
    const odu = odus.get(pair.odu_model);
    if (!idu || !odu) continue;
    if (opts.formFactor && idu.form_factor !== opts.formFactor) continue;
    if (!indoorReadiness(pack, idu).roles.split) continue;
    const coolKw = pair.rated_cool_kw ?? idu.capacity_cool_kw;
    const heatKw = pair.rated_heat_kw ?? idu.capacity_heat_kw;
    all.push({
      pair,
      idu,
      odu,
      coolKw,
      heatKw,
      capacityKw: sizingCapacityKw(
        { capacity_cool_kw: coolKw, capacity_heat_kw: heatKw },
        basis
      ),
      recommended: false,
    });
  }
  all.sort((a, b) => a.capacityKw - b.capacityKw || a.idu.model.localeCompare(b.idu.model));

  if (loadKw == null) return all;
  const covering = all.filter((p) => p.capacityKw >= loadKw);
  if (covering.length) covering[0].recommended = true;
  return covering;
}

/* ─────────────────────────── validation ─────────────────────────── */

export type Severity = "red" | "amber";

export interface Finding {
  severity: Severity;
  code:
    | "no-idu"
    | "no-odu"
    | "extra-units"
    | "unknown-model"
    | "pair-not-approved"
    | "not-connected"
    | "orphan-run"
    | "over-length"
    | "over-lift"
    | "uncalibrated"
    | "under-capacity";
  message: string;
}

export type BadgeStatus = "green" | "amber" | "red" | "empty";

export interface SplitValidation {
  status: BadgeStatus;
  findings: Finding[];
  /** metres along the IDU→ODU path; null = unknown (uncalibrated / no path) */
  lengthM: number | null;
  liftM: number | null;
  pair: PairTable | null;
  idu: DesignObject | null;
  odu: DesignObject | null;
}

const unitModel = (o: DesignObject): string => String(o.props.model ?? "");

/** Validate one split system: exactly 1 IDU + 1 ODU, an approved pair, an
    actual connected run, and length/lift within the pair's limits. */
export function validateSplitSystem(
  doc: DesignDocument,
  pack: DataPack,
  systemId: string
): SplitValidation {
  const findings: Finding[] = [];
  const objs = doc.objects.filter((o) => o.systemId === systemId);
  const units = objs.filter((o) => o.type === "unit");
  const idus = units.filter((o) => o.props.role === "idu");
  const odus = units.filter((o) => o.props.role === "odu");
  const runs = objs.filter((o) => o.type === "pipe-run");

  if (objs.length === 0) {
    return { status: "empty", findings, lengthM: null, liftM: null, pair: null, idu: null, odu: null };
  }

  if (idus.length === 0)
    findings.push({ severity: "red", code: "no-idu", message: "Place an indoor unit" });
  if (odus.length === 0)
    findings.push({ severity: "red", code: "no-odu", message: "Place an outdoor unit" });
  if (idus.length > 1 || odus.length > 1)
    findings.push({
      severity: "red",
      code: "extra-units",
      message: "A split system is exactly one indoor + one outdoor unit",
    });

  const idu = idus[0] ?? null;
  const odu = odus[0] ?? null;

  // approved pairing
  let pair: PairTable | null = null;
  if (idu && odu) {
    const iduModel = unitModel(idu);
    const oduModel = unitModel(odu);
    const iduKnown = pack.indoor_units.some((u) => u.model === iduModel);
    const oduKnown = pack.outdoor_units.some((o) => o.model === oduModel);
    if (!iduKnown || !oduKnown) {
      findings.push({
        severity: "red",
        code: "unknown-model",
        message: `Unknown model: ${!iduKnown ? iduModel : oduModel}`,
      });
    } else {
      pair =
        pack.pair_tables.find(
          (p) => p.idu_model === iduModel && p.odu_model === oduModel
        ) ?? null;
      if (!pair)
        findings.push({
          severity: "red",
          code: "pair-not-approved",
          message: `${iduModel} + ${oduModel} is not an approved pairing`,
        });
    }
  }

  // connectivity + limits (graph v0)
  let lengthM: number | null = null;
  let liftM: number | null = null;
  let graph: SystemGraph | null = null;
  if (idu && odu) {
    graph = buildSystemGraph(doc.objects, doc.floors, systemId);
    const path = findPath(graph, idu.id, odu.id);
    if (!path) {
      findings.push({
        severity: "red",
        code: "not-connected",
        message:
          runs.length === 0
            ? "Draw the refrigerant run between the units"
            : "The run doesn't join the indoor and outdoor unit — snap its ends to the unit anchors",
      });
    } else {
      lengthM = path.lengthM;
      liftM = path.liftM;
      if (lengthM == null) {
        findings.push({
          severity: "amber",
          code: "uncalibrated",
          message: "Floor not calibrated — pipe lengths are unknown",
        });
      } else if (pair) {
        if (lengthM > pair.max_length_m)
          findings.push({
            severity: "red",
            code: "over-length",
            message: `Run is ${lengthM.toFixed(1)} m — max for this pair is ${pair.max_length_m} m`,
          });
        if (liftM > pair.max_lift_m)
          findings.push({
            severity: "red",
            code: "over-lift",
            message: `Height difference is ${liftM.toFixed(1)} m — max for this pair is ${pair.max_lift_m} m`,
          });
      }
    }
    if (graph.orphanRuns.length)
      findings.push({
        severity: "amber",
        code: "orphan-run",
        message: `${graph.orphanRuns.length} run${graph.orphanRuns.length > 1 ? "s" : ""} not attached at both ends`,
      });
  }

  const status: BadgeStatus = findings.some((f) => f.severity === "red")
    ? "red"
    : findings.some((f) => f.severity === "amber")
      ? "amber"
      : "green";
  return { status, findings, lengthM, liftM, pair, idu, odu };
}

/** Badge for any system type — split is the only module so far; other types
    render as empty (no rules registered yet). */
export function systemBadge(
  doc: DesignDocument,
  pack: DataPack | null,
  system: DesignSystem
): SplitValidation {
  if (system.type === "split" && pack) {
    return validateSplitSystem(doc, pack, system.id);
  }
  return {
    status: "empty",
    findings: [],
    lengthM: null,
    liftM: null,
    pair: null,
    idu: null,
    odu: null,
  };
}
