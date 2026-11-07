/* THE TOOLBOX, ON THE PHONE (Isaac, 29 October 2026: "Build the rest", the
   overnight mock: "the phone's Toolbox shows the web's three tools, and none
   of them opens. Here they open, on real numbers").

   The phone works the web tools' own sums (lib/toolbox), so a figure is the
   same wherever it is looked at: Heat Load and Running Pressures are worked
   here and handed back, and the Fault Finder's trees go to the phone whole,
   to be walked on a roof with no signal. Pure. */

import { baseWm2, CLIMATE_ZONES, ORIENT_LABELS, ORIENTATIONS, type BuildingType, type GlazingLevel, type Orientation, type RoomCondition } from "@/lib/studio/loads";
import { HL_DEFAULTS, hlArea, hlLoadKw, parseNum, suggestClassKw, type HlState } from "@/lib/toolbox/heat-load";
import { DEFAULT_AMBIENT_C, DEFAULT_SPACE_C, diagnose, dutiesFor, estimatePressures, type Duty } from "@/lib/toolbox/diagnose";
import { kpaToPsi, psiToKpa, REFRIGERANTS, type RefrigerantKey } from "@/lib/toolbox/refrigerant";
import { OUTCOMES, QUESTIONS, remainingLabel, SYMPTOMS } from "@/lib/toolbox/guided";

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim().replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

const BUILDINGS: readonly BuildingType[] = ["residential", "light_commercial", "commercial"];
const GLAZINGS: readonly GlazingLevel[] = ["low", "moderate", "high"];
const CONDITIONS: readonly RoomCondition[] = ["well_insulated", "standard", "poor"];
const DUTIES: readonly Duty[] = ["cooling", "heating", "refrigeration"];

/** What the two calculators offer, said as the web tools say it. */
export function toolboxOptions() {
  return {
    heat: {
      defaults: { climateZone: HL_DEFAULTS.climateZone, buildingType: HL_DEFAULTS.buildingType, glazing: HL_DEFAULTS.glazing, condition: HL_DEFAULTS.condition, ceilingHeightM: Number(HL_DEFAULTS.ceilingHeightM), orientation: HL_DEFAULTS.orientation },
      zones: Object.entries(CLIMATE_ZONES).map(([n, z]) => ({ zone: Number(n), label: z.label, cities: z.cities })),
      buildings: [
        { value: "residential", label: "Residential" },
        { value: "light_commercial", label: "Light comm." },
        { value: "commercial", label: "Commercial" },
      ],
      glazing: [
        { value: "low", label: "Low" },
        { value: "moderate", label: "Moderate" },
        { value: "high", label: "High" },
      ],
      condition: [
        { value: "well_insulated", label: "Good" },
        { value: "standard", label: "Standard" },
        { value: "poor", label: "Poor" },
      ],
      orientations: ORIENTATIONS.map((o) => ({ value: o, label: ORIENT_LABELS[o] })),
    },
    pressures: {
      refrigerants: REFRIGERANTS.map((r) => ({ key: r.key, name: r.name, uses: r.uses, status: r.status, safety: r.safety, flammable: r.flammable, duties: dutiesFor(r.key) })),
      defaults: { ambientC: DEFAULT_AMBIENT_C, spaceC: DEFAULT_SPACE_C },
    },
  };
}

/** `wm2`: the base rate the load starts from, the zone's or the one typed over it. */
export type HeatAnswer = { areaM2: number | null; kw: number | null; classKw: number | null; wm2: number };

/** One room's load, from the phone's fields: the web calculator's own sum. */
export function heatLoad(input: Record<string, unknown>): HeatAnswer {
  const s: HlState = {
    areaMode: input.areaMode === "area" ? "area" : "dims",
    lengthM: String(input.lengthM ?? ""),
    widthM: String(input.widthM ?? ""),
    areaM2: String(input.areaM2 ?? ""),
    climateZone: CLIMATE_ZONES[num(input.climateZone) ?? -1] ? num(input.climateZone)! : HL_DEFAULTS.climateZone,
    buildingType: pick(input.buildingType, BUILDINGS, HL_DEFAULTS.buildingType),
    wm2Override: String(input.wm2Override ?? ""),
    glazing: pick(input.glazing, GLAZINGS, HL_DEFAULTS.glazing),
    condition: pick(input.condition, CONDITIONS, HL_DEFAULTS.condition),
    ceilingHeightM: String(input.ceilingHeightM ?? HL_DEFAULTS.ceilingHeightM),
    orientation: pick<Orientation>(input.orientation, ORIENTATIONS, HL_DEFAULTS.orientation),
    internal: input.internal === true,
  };
  const kw = hlLoadKw(s);
  const wm2 = parseNum(s.wm2Override) ?? baseWm2({ climateZone: s.climateZone, buildingType: s.buildingType });
  return { areaM2: hlArea(s), kw, classKw: kw === null ? null : suggestClassKw(kw), wm2 };
}

const REF_KEYS = REFRIGERANTS.map((r) => r.key);

/** What the gauges should read, and what the gauges DO read points to when
    they are given. Pressures arrive in the unit the phone shows. */
export function pressures(input: Record<string, unknown>) {
  const refrigerant = pick<RefrigerantKey>(input.refrigerant, REF_KEYS, "R32");
  const allowed = dutiesFor(refrigerant);
  const duty = pick<Duty>(input.duty, DUTIES, allowed[0]!);
  const ok = allowed.includes(duty) ? duty : allowed[0]!;
  const ambientC = num(input.ambientC) ?? DEFAULT_AMBIENT_C[ok];
  const spaceC = num(input.spaceC) ?? DEFAULT_SPACE_C[ok];
  const psi = input.unit === "psi";
  const toKpa = (v: number | null) => (v === null ? null : psi ? psiToKpa(v) : v);
  const estimate = estimatePressures({ refrigerant, duty: ok, ambientC, spaceC });
  const suction = toKpa(num(input.suction));
  const discharge = toKpa(num(input.discharge));
  const reading =
    suction !== null && discharge !== null && suction > 0 && discharge > 0
      ? diagnose({ refrigerant, duty: ok, ambientC, spaceC, suctionKpa: suction, dischargeKpa: discharge, suctionLineC: num(input.suctionLineC), liquidLineC: num(input.liquidLineC) })
      : null;
  const both = (kpa: number | null) => (kpa === null ? null : { kpa: Math.round(kpa), psi: Math.round(kpaToPsi(kpa)) });
  return {
    refrigerant,
    duty: ok,
    ambientC,
    spaceC,
    estimate: { suction: both(estimate.suctionKpa), discharge: both(estimate.dischargeKpa), evapSatC: estimate.evapSatC, condSatC: estimate.condSatC, basis: estimate.basis, offChart: estimate.offChart },
    diagnosis: reading && {
      severity: reading.severity,
      headline: reading.headline,
      explanation: reading.explanation,
      checks: reading.checks,
      suction: reading.suction,
      discharge: reading.discharge,
      superheatK: reading.superheatK,
      subcoolingK: reading.subcoolingK,
      chargeNote: reading.chargeNote,
    },
  };
}

/* the web tools' paths, as the phone names its own screens */
const PHONE_TOOL: Record<string, string> = {
  "/dashboard/toolbox/heat-load": "/tool-heat",
  "/dashboard/toolbox/running-pressures": "/tool-pressures",
};

/** The Fault Finder's trees, whole, for the phone to keep: every symptom,
    question and outcome, each question with how far it has left to go. */
export function faultTrees() {
  return {
    symptoms: SYMPTOMS,
    questions: QUESTIONS.map((q) => ({ ...q, remaining: remainingLabel(q.id) })),
    outcomes: OUTCOMES.map((o) => (o.tool ? { ...o, tool: { label: o.tool.label, path: PHONE_TOOL[o.tool.href] ?? null } } : o)),
  };
}
