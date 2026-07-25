/* Running-pressure estimation + pressure-pattern diagnosis. Pure functions,
   zero deps, no React (lib/studio discipline).

   Two jobs:
   1. estimatePressures() — what SHOULD the gauges read, given refrigerant,
      duty (cooling / heating / refrigeration) and the AMBIENT temperature.
      Ambient is the dominant variable a tech can actually measure on site,
      so the estimate keys off it rather than quoting one static band.
   2. diagnose() — given what the gauges ACTUALLY read, classify each side
      against the estimate and return the likely story plus what to check.

   The model is the standard field relationship set (condenser/evaporator
   "splits"), not manufacturer data:
     cooling      condensing ≈ ambient + CONDENSER_SPLIT
                  evaporating ≈ indoor  − EVAPORATOR_SPLIT
     heating      evaporating ≈ ambient − HP_EVAP_SPLIT
                  condensing  ≈ indoor  + HP_COND_SPLIT
     refrigeration condensing ≈ ambient + CONDENSER_SPLIT
                  evaporating ≈ box     − EVAPORATOR_SPLIT
   Splits are typical air-cooled figures and are exposed so the UI can say
   what it assumed. Diagnosis compares SATURATION TEMPERATURES rather than
   raw pressures, because a fixed kPa tolerance means wildly different
   things on R134a vs R410A. */

import {
  getRefrigerant,
  satPressureKpa,
  satTempC,
  type RefrigerantKey,
} from "./refrigerant";

export type Duty = "cooling" | "heating" | "refrigeration";

/* ─────────────────────────── split model ─────────────────────────── */

/** Condensing temp above ambient — air-cooled, clean coil, typical AU kit. */
export const CONDENSER_SPLIT_K = 14;
/** Evaporating temp below the conditioned-space temp, cooling duty. */
export const EVAPORATOR_SPLIT_K = 17;
/** Refrigeration runs a much tighter coil TD than comfort cooling — a cold
    room holding 2°C evaporates near −6°C, not −15°C. */
export const REFRIG_EVAP_SPLIT_K = 8;
/** Heat-pump evaporating temp below ambient (coil must be colder than air). */
export const HP_EVAP_SPLIT_K = 8;
/** Heat-pump condensing temp above the indoor temp. */
export const HP_COND_SPLIT_K = 20;

/** Sensible defaults for the "other" temperature per duty. */
export const DEFAULT_SPACE_C: Record<Duty, number> = {
  cooling: 24, // indoor return air
  heating: 20, // indoor room target
  refrigeration: 2, // cold-room box temp (medium temp)
};

/** Default ambient per duty — the condition you'd typically be testing in. */
export const DEFAULT_AMBIENT_C: Record<Duty, number> = {
  cooling: 35,
  heating: 7,
  refrigeration: 32,
};

export interface EstimateInput {
  refrigerant: RefrigerantKey;
  duty: Duty;
  /** outdoor ambient, °C */
  ambientC: number;
  /** indoor return air (cooling/heating) or box temp (refrigeration), °C */
  spaceC?: number;
}

export interface Estimate {
  /** saturation temperatures the splits predict */
  evapSatC: number;
  condSatC: number;
  /** gauge pressures, kPa — suction reads dew, discharge reads bubble */
  suctionKpa: number | null;
  dischargeKpa: number | null;
  /** true when a value fell outside the refrigerant's chart range */
  offChart: boolean;
  /** plain-language note on what was assumed */
  basis: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Expected saturation temps + gauge pressures for the duty and ambient. */
export function estimatePressures(input: EstimateInput): Estimate {
  const { refrigerant, duty, ambientC } = input;
  const spaceC = input.spaceC ?? DEFAULT_SPACE_C[duty];

  let evapSatC: number;
  let condSatC: number;
  let basis: string;

  if (duty === "heating") {
    evapSatC = ambientC - HP_EVAP_SPLIT_K;
    condSatC = spaceC + HP_COND_SPLIT_K;
    basis =
      `Evaporating ≈ ambient ${ambientC}°C − ${HP_EVAP_SPLIT_K} K · ` +
      `condensing ≈ indoor ${spaceC}°C + ${HP_COND_SPLIT_K} K`;
  } else {
    const evapSplit =
      duty === "refrigeration" ? REFRIG_EVAP_SPLIT_K : EVAPORATOR_SPLIT_K;
    condSatC = ambientC + CONDENSER_SPLIT_K;
    evapSatC = spaceC - evapSplit;
    const spaceLabel = duty === "refrigeration" ? "box" : "indoor";
    basis =
      `Condensing ≈ ambient ${ambientC}°C + ${CONDENSER_SPLIT_K} K · ` +
      `evaporating ≈ ${spaceLabel} ${spaceC}°C − ${evapSplit} K`;
  }

  evapSatC = round1(evapSatC);
  condSatC = round1(condSatC);

  const suctionKpa = satPressureKpa(refrigerant, evapSatC, "vapor");
  const dischargeKpa = satPressureKpa(refrigerant, condSatC, "liquid");

  return {
    evapSatC,
    condSatC,
    suctionKpa,
    dischargeKpa,
    offChart: suctionKpa === null || dischargeKpa === null,
    basis,
  };
}

/* ───────────────────────── diagnosis ───────────────────────── */

export type Level = "low" | "normal" | "high";
export type Severity = "ok" | "watch" | "fault";

/** How far a saturation temperature may stray before it reads as off.
    Wider on the high side because load and airflow swing it legitimately. */
export const SUCTION_TOL_K = 4;
export const DISCHARGE_TOL_K = 5;

export interface DiagnoseInput {
  refrigerant: RefrigerantKey;
  duty: Duty;
  ambientC: number;
  spaceC?: number;
  /** measured gauge pressures, kPa (convert from psi before calling) */
  suctionKpa: number;
  dischargeKpa: number;
  /** optional line temps — enable the superheat/subcool refinement */
  suctionLineC?: number | null;
  liquidLineC?: number | null;
}

export interface Reading {
  level: Level;
  /** measured saturation temp, °C (null = off chart) */
  satC: number | null;
  /** expected saturation temp, °C */
  expectedSatC: number;
  /** measured − expected, K (null = off chart) */
  deltaK: number | null;
}

export interface Diagnosis {
  suction: Reading;
  discharge: Reading;
  severity: Severity;
  /** one-line headline, e.g. "Both sides low — undercharge or leak" */
  headline: string;
  /** the reasoning in plain language */
  explanation: string;
  /** ordered things to check */
  checks: string[];
  /** superheat / subcooling when line temps were supplied */
  superheatK: number | null;
  subcoolingK: number | null;
  /** extra line the SH/SC pattern adds, when it says something */
  chargeNote: string | null;
  estimate: Estimate;
}

function level(deltaK: number | null, tol: number): Level {
  if (deltaK === null) return "normal";
  if (deltaK < -tol) return "low";
  if (deltaK > tol) return "high";
  return "normal";
}

/* The nine pressure patterns. Content is standard field diagnostics —
   deliberately no manufacturer fault codes (pack-data rule). */
interface Pattern {
  headline: string;
  explanation: string;
  checks: string[];
  severity: Severity;
}

function pattern(s: Level, d: Level, duty: Duty): Pattern {
  const coil = duty === "heating" ? "outdoor" : "indoor";
  const key = `${s}|${d}`;
  switch (key) {
    case "low|low":
      return {
        severity: "fault",
        headline: "Both sides low — undercharge or leak",
        explanation:
          "Low suction with low head is the classic short-of-gas signature: too little refrigerant to fill the evaporator, so the compressor pulls the low side down and there is nothing to stack up on the high side. Superheat will usually be high and subcooling low.",
        checks: [
          "Measure superheat — high superheat confirms undercharge",
          "Leak search: flare joints, service ports, coil returns, oil staining",
          "Check for oil at the outdoor unit base and along the pipe run",
          "Once repaired, recover, pressure-test, evacuate and weigh in the nameplate charge",
          `Rule out a starved ${coil} coil first if airflow is obviously blocked`,
        ],
      };
    case "low|normal":
      return {
        severity: "fault",
        headline: "Low suction, normal head — restriction or airflow starvation",
        explanation:
          "The high side looks healthy so charge is probably adequate, but the low side is being starved. Either the metering device or filter drier is restricting flow, or the evaporator simply is not getting enough air across it.",
        checks: [
          "Feel across the filter drier — a temperature drop means it is restricting",
          "Check filters, coil face and fan speed; look for iced coil",
          "Measure superheat — high superheat with good subcooling points to a restriction",
          "Verify the expansion valve bulb is tight, insulated and on the right line",
          "Check for a kinked or crushed liquid line",
        ],
      };
    case "low|high":
      return {
        severity: "fault",
        headline: "Low suction, high head — restriction with a struggling condenser",
        explanation:
          "Flow is choked between the high and low sides while heat is not leaving the condenser. Commonly a liquid-line restriction combined with a dirty condenser or failing condenser fan.",
        checks: [
          "Clean the condenser coil and confirm the fan runs at full speed",
          "Check clearances and any recirculation of discharge air",
          "Feel the filter drier for a temperature drop",
          "Check for non-condensables if the system was opened without evacuation",
          "Confirm the metering device is not stuck closed",
        ],
      };
    case "normal|low":
      return {
        severity: "fault",
        headline: "Normal suction, low head — compressor not pumping",
        explanation:
          "The compressor is running but not developing a pressure difference. Valve plate leak-by, a worn compressor, or on a heat pump a reversing valve bleeding hot gas back to the suction side.",
        checks: [
          "Measure running amps — well below nameplate suggests it is not loading",
          "Feel the discharge line: it should be markedly hot",
          "Heat pump: compare reversing valve body temperatures for internal bypass",
          "Watch whether the pressures equalise almost immediately on shutdown",
          "Confirm the readings on a second set of gauges before condemning the compressor",
        ],
      };
    case "normal|high":
      return {
        severity: "fault",
        headline: "High head, normal suction — condenser not rejecting heat",
        explanation:
          "The low side is fine, so charge and metering are probably right; the heat simply is not getting out of the condenser. Dirty coil, fan problem, poor clearance or non-condensables in the system.",
        checks: [
          "Clean the condenser coil — check between the fins, not just the face",
          "Confirm the condenser fan runs and turns the right way",
          "Check clearance and recirculation around the unit",
          "Suspect non-condensables (air) if the system was opened and not properly evacuated",
          "Compare subcooling — high subcooling here suggests overcharge as well",
        ],
      };
    case "high|low":
      return {
        severity: "fault",
        headline: "High suction, low head — compressor or reversing valve failure",
        explanation:
          "The two sides are moving toward each other, which means the compressor is not separating them. Discharge valve leak-by or a reversing valve bypassing internally.",
        checks: [
          "Measure running amps — low amps with poor differential is a strong signal",
          "Heat pump: check reversing valve body temperatures for bypass",
          "Check the discharge line temperature; a cool discharge line is not normal",
          "Perform a pump-down or blank-off test if the setup allows",
          "Expect compressor or valve replacement — confirm on a second gauge set first",
        ],
      };
    case "high|normal":
      return {
        severity: "watch",
        headline: "High suction, normal head — heavy load or overfeeding valve",
        explanation:
          `The ${coil} coil is absorbing more heat than the system can pull down, or the metering device is overfeeding it. Often simply a very hot space pulling down after start-up.`,
        checks: [
          "Let the system run 10–15 minutes and re-read — pull-down looks like this",
          "Measure superheat — low superheat means the valve is overfeeding",
          "Check the space for open doors, high occupancy or added heat load",
          "Confirm the expansion valve bulb is secure and correctly located",
          "Compare the unit's capacity against the room's actual load",
        ],
      };
    case "high|high":
      return {
        severity: "fault",
        headline: "Both sides high — overcharge, non-condensables or excess load",
        explanation:
          "Too much refrigerant, or something in the system that will not condense, raises both sides together. Extreme load can do the same, so rule that out before touching the charge.",
        checks: [
          "Measure subcooling — high subcooling confirms overcharge",
          "Check whether the system was topped up rather than weighed in",
          "Suspect non-condensables if it was opened without a proper evacuation",
          "Clean the condenser and verify fan operation before adjusting charge",
          "Recover to the nameplate charge by weight rather than bleeding to a pressure",
        ],
      };
    default:
      return {
        severity: "ok",
        headline: "Pressures look normal for these conditions",
        explanation:
          "Both sides sit within the expected band for this refrigerant, duty and ambient. If the customer still has a complaint, the cause is likely airflow, controls or sizing rather than the refrigerant circuit.",
        checks: [
          "Measure superheat and subcooling to confirm the charge is right",
          "Check the temperature split across the indoor coil",
          "Check filters, fan speed and duct/grille restrictions",
          "Verify the controller setpoint, mode and any schedule or eco limit",
          "Compare the unit's capacity against the room load if it simply cannot keep up",
        ],
      };
  }
}

/** SH/SC quadrant — refines the pressure story when line temps are given. */
function chargePattern(sh: number | null, sc: number | null): string | null {
  if (sh === null || sc === null) return null;
  const shHigh = sh > 12;
  const shLow = sh < 2;
  const scHigh = sc > 10;
  const scLow = sc < 2;
  if (shHigh && scLow) return "High superheat with low subcooling — consistent with undercharge or a leak.";
  if (shLow && scHigh) return "Low superheat with high subcooling — consistent with overcharge.";
  if (shHigh && scHigh) return "High superheat with high subcooling — consistent with a restriction between condenser and evaporator.";
  if (shLow && scLow) return "Low superheat with low subcooling — the compressor may not be pumping, or the valve is overfeeding.";
  if (!shHigh && !shLow && !scHigh && !scLow)
    return "Superheat and subcooling both sit in the normal range — the charge looks right.";
  return null;
}

/** Full pressure diagnosis: classify both sides, then explain and advise. */
export function diagnose(input: DiagnoseInput): Diagnosis {
  const estimate = estimatePressures({
    refrigerant: input.refrigerant,
    duty: input.duty,
    ambientC: input.ambientC,
    spaceC: input.spaceC,
  });

  const suctionSat = satTempC(input.refrigerant, input.suctionKpa, "vapor");
  const dischargeSat = satTempC(input.refrigerant, input.dischargeKpa, "liquid");

  const suctionDelta = suctionSat === null ? null : round1(suctionSat - estimate.evapSatC);
  const dischargeDelta = dischargeSat === null ? null : round1(dischargeSat - estimate.condSatC);

  /* Off-chart readings are themselves diagnostic: below the chart floor is a
     deep vacuum / empty system, above the ceiling is a serious high-side event. */
  const table = getRefrigerant(input.refrigerant).table;
  const suctionLevel: Level =
    suctionSat === null
      ? input.suctionKpa < table[0].vapor
        ? "low"
        : "high"
      : level(suctionDelta, SUCTION_TOL_K);
  const dischargeLevel: Level =
    dischargeSat === null
      ? input.dischargeKpa < table[0].liquid
        ? "low"
        : "high"
      : level(dischargeDelta, DISCHARGE_TOL_K);

  const p = pattern(suctionLevel, dischargeLevel, input.duty);

  const sh =
    suctionSat !== null && input.suctionLineC != null
      ? round1(input.suctionLineC - suctionSat)
      : null;
  const sc =
    dischargeSat !== null && input.liquidLineC != null
      ? round1(dischargeSat - input.liquidLineC)
      : null;

  return {
    suction: {
      level: suctionLevel,
      satC: suctionSat,
      expectedSatC: estimate.evapSatC,
      deltaK: suctionDelta,
    },
    discharge: {
      level: dischargeLevel,
      satC: dischargeSat,
      expectedSatC: estimate.condSatC,
      deltaK: dischargeDelta,
    },
    severity: p.severity,
    headline: p.headline,
    explanation: p.explanation,
    checks: p.checks,
    superheatK: sh,
    subcoolingK: sc,
    chargeNote: chargePattern(sh, sc),
    estimate,
  };
}

/** Which duties make sense for a refrigerant (drives the UI's mode chips). */
export function dutiesFor(refrigerant: RefrigerantKey): Duty[] {
  const r = getRefrigerant(refrigerant);
  if (r.heating.length > 0) return ["cooling", "heating"];
  return refrigerant === "R404A" ? ["refrigeration"] : ["cooling", "refrigeration"];
}
