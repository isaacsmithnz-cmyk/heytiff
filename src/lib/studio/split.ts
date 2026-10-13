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
import { coversLoad } from "./fit";
import { chargeTableEndM, pastChargeTable } from "./materials";

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
  const covering = all.filter((p) => coversLoad(p.capacityKw, loadKw));
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
    | "past-charge-table"
    | "near-equivalent-limit"
    | "uncalibrated"
    | "under-capacity";
  message: string;
}

/** How close to an EQUIVALENT-length limit a run may come, measured, before
    it is amber. The Studio measures the drawn run and the rise between where
    its ends are mounted; the book's equivalent length adds an allowance for
    every bend and fitting, which the Studio doesn't know and never invents.
    Typical split runs carry a handful of elbows at a few tenths of a metre to
    a metre each, so at 80% of the limit (12 m short of a 60 m figure) the
    fittings can plausibly decide it — that is the point to look, never a
    reason to refuse. */
export const EQUIV_LENGTH_CLOSE_RATIO = 0.8;

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
        /* an EQUIVALENT limit counts the rise and the fittings: judge it on
           the run plus the climb the drawing leaves out — the least the
           equivalent length can be — and warn close to it */
        const equivalent = pair.max_length_basis === "equivalent";
        const climbM = equivalent ? path.unmeasuredRiseM : 0;
        const measuredM = lengthM + climbM;
        const withRise = climbM > 0.05 ? ` with ${climbM.toFixed(1)} m of rise` : "";
        if (measuredM > pair.max_length_m)
          findings.push({
            severity: "red",
            code: "over-length",
            message: equivalent
              ? `Run is ${measuredM.toFixed(1)} m${withRise} — max for this pair is ${pair.max_length_m} m equivalent, and that is before its bends and fittings`
              : `Run is ${lengthM.toFixed(1)} m — max for this pair is ${pair.max_length_m} m`,
          });
        /* a stepped charge table ends (Daikin prints "Impossible" past its
           last column): a run the pair allows but the table doesn't reach
           has no top-up the book will give, so it can't be installed by it */
        else if (
          pastChargeTable(pair.additional_charge, { liquidLengthM: lengthM, liquidSizeMm: pair.pipe_liquid_mm })
        ) {
          const end = chargeTableEndM(pair.additional_charge, pair.pipe_liquid_mm);
          findings.push({
            severity: "red",
            code: "past-charge-table",
            message: `Run is ${lengthM.toFixed(1)} m — the book's charge table for this pair stops at ${end != null ? +end.toFixed(1) : "?"} m`,
          });
        }
        if (
          !findings.some((f) => f.code === "over-length" || f.code === "past-charge-table") &&
          equivalent &&
          measuredM >= pair.max_length_m * EQUIV_LENGTH_CLOSE_RATIO
        )
          findings.push({
            severity: "amber",
            code: "near-equivalent-limit",
            message: `Run is ${measuredM.toFixed(1)} m${withRise}, within ${Math.round((1 - EQUIV_LENGTH_CLOSE_RATIO) * 100)}% of the book's ${pair.max_length_m} m — an equivalent length, which also counts bends and fittings. Allow for its fittings`,
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
