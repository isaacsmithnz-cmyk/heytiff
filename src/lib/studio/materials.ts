/* Design Studio — materials / takeoff v1 (Stage 4).
   A pure function: (document, dataPack) → schedule. Grouped per system;
   sections vary by type. Empty design = empty schedule — nothing hardcoded,
   ever (design-studio-plan.md, Layer 4). v1 covers split systems: units, pipe
   by size × drawn length, additional refrigerant charge. Later modules add
   their own sections without touching this shape. */

import type { DesignDocument, DesignSystem } from "./document";
import type { AdditionalChargeRule, DataPack, PairTable } from "./packs/schema";
import { buildSystemGraph, totalPipeLengthM } from "./graph";
import { validateSplitSystem } from "./split";

/* ───────────────── additional-charge rule evaluator ─────────────────
   One evaluator per method (universal-table-schema.md — typed rule blocks).
   Returns grams, or null when the rule needs data we don't have yet. */

export function evaluateAdditionalCharge(
  rule: AdditionalChargeRule,
  ctx: { liquidLengthM: number; liquidSizeMm?: number }
): number | null {
  switch (rule.method) {
    case "none_required":
      return 0;
    case "threshold_then_rate":
      return Math.max(0, ctx.liquidLengthM - rule.free_up_to_m) * rule.g_per_m_beyond;
    case "per_meter_by_liquid_size": {
      if (ctx.liquidSizeMm == null) return null;
      const rate = rule.rates[String(ctx.liquidSizeMm)];
      if (rate == null) return null;
      const chargeable = Math.max(
        0,
        ctx.liquidLengthM - (rule.precharged_allowance_m ?? 0)
      );
      return chargeable * rate;
    }
    case "formula_coefficients": {
      if (ctx.liquidSizeMm == null) return null;
      const term = rule.terms.find((t) => t.liquid_mm === ctx.liquidSizeMm);
      if (!term) return null;
      const g =
        ctx.liquidLengthM * term.coeff_g_per_m - (rule.deduction_g ?? 0);
      return Math.max(rule.min_charge_g ?? 0, g);
    }
    case "fixed_per_idu":
      return null; // needs an idu-size key — no consumer yet
  }
}

/* ─────────────────────────── the schedule ─────────────────────────── */

export interface UnitLine {
  model: string;
  description: string;
  qty: number;
}

export interface PipeLine {
  liquid_mm: number;
  gas_mm: number;
  /** metres of pair-coil run (one-way drawn length incl. riser verticals) */
  lengthM: number;
}

export interface ChargeLine {
  grams: number;
  note: string;
}

export interface SystemSchedule {
  systemId: string;
  name: string;
  type: DesignSystem["type"];
  brand: string;
  colour: string;
  units: UnitLine[];
  pipe: PipeLine[];
  charge: ChargeLine | null;
  /** things the schedule can't quantify yet (uncalibrated floors etc.) */
  notes: string[];
}

export interface MaterialsSchedule {
  systems: SystemSchedule[];
}

const describeUnit = (pack: DataPack, model: string): string => {
  const idu = pack.indoor_units.find((u) => u.model === model);
  if (idu)
    return `${idu.form_factor} indoor unit · ${idu.capacity_cool_kw}/${idu.capacity_heat_kw} kW`;
  const odu = pack.outdoor_units.find((o) => o.model === model);
  if (odu)
    return `outdoor unit · ${odu.capacity_cool_kw}/${odu.capacity_heat_kw} kW`;
  return "unit";
};

function splitSchedule(
  doc: DesignDocument,
  pack: DataPack,
  system: DesignSystem
): SystemSchedule {
  const out: SystemSchedule = {
    systemId: system.id,
    name: system.name,
    type: system.type,
    brand: system.brand,
    colour: system.colour,
    units: [],
    pipe: [],
    charge: null,
    notes: [],
  };

  // units — counted from what's actually placed
  const placed = doc.objects.filter(
    (o) => o.systemId === system.id && o.type === "unit"
  );
  const counts = new Map<string, number>();
  for (const u of placed) {
    const m = String(u.props.model ?? "");
    if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  for (const [model, qty] of counts)
    out.units.push({ model, qty, description: describeUnit(pack, model) });
  out.units.sort((a, b) => a.model.localeCompare(b.model));

  // pipe — total drawn length at the pair's sizes
  const graph = buildSystemGraph(doc.objects, doc.floors, system.id);
  const lengthM = totalPipeLengthM(graph);
  const hasRuns = doc.objects.some(
    (o) => o.systemId === system.id && o.type === "pipe-run"
  );
  const pair: PairTable | null = validateSplitSystem(doc, pack, system.id).pair;

  if (hasRuns && lengthM == null) {
    out.notes.push("Pipe lengths unknown — calibrate the floor to quantify the run");
  } else if (lengthM != null && lengthM > 0 && pair) {
    const rounded = Math.round(lengthM * 10) / 10;
    out.pipe.push({
      liquid_mm: pair.pipe_liquid_mm,
      gas_mm: pair.pipe_gas_mm,
      lengthM: rounded,
    });
    const grams = evaluateAdditionalCharge(pair.additional_charge, {
      liquidLengthM: lengthM,
      liquidSizeMm: pair.pipe_liquid_mm,
    });
    if (grams == null) {
      out.notes.push("Additional charge rule needs data not yet in the pack");
    } else {
      out.charge = {
        grams: Math.round(grams),
        note:
          grams === 0
            ? "No additional refrigerant required at this run length"
            : `Additional refrigerant beyond the pre-charge`,
      };
    }
  } else if (lengthM != null && lengthM > 0 && !pair) {
    out.notes.push("Pipe drawn but the unit pairing isn't approved — sizes unknown");
  }

  return out;
}

/** The whole job's takeoff. Empty design → { systems: [] }. */
export function buildMaterials(
  doc: DesignDocument,
  pack: DataPack | null
): MaterialsSchedule {
  if (!pack) return { systems: [] };
  const systems: SystemSchedule[] = [];
  for (const system of doc.systems) {
    if (system.type === "split") systems.push(splitSchedule(doc, pack, system));
    // other system types register their sections in later stages
  }
  return { systems };
}

export interface RollupRow {
  model: string;
  description: string;
  qty: number;
}

/** Cross-system unit rollup ("whole job" schedule) — the same model ordered
    by two systems shows once with the summed qty. Screen and print share it. */
export function rollupUnits(schedule: MaterialsSchedule): RollupRow[] {
  const map = new Map<string, RollupRow>();
  for (const s of schedule.systems)
    for (const u of s.units) {
      const cur = map.get(u.model);
      if (cur) cur.qty += u.qty;
      else map.set(u.model, { model: u.model, description: u.description, qty: u.qty });
    }
  return [...map.values()].sort((a, b) => a.model.localeCompare(b.model));
}
