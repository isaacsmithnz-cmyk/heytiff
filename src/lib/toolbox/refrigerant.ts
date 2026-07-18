/* Refrigerant pressure–temperature reference — pure data + math for the
   Running Pressures tool. Zero deps, no React (lib/studio discipline).

   Covers the refrigerants an Australian HVAC tech actually meets, ordered
   most-relevant-first. Tables are kPa GAUGE (sea level, −101.325 kPa from
   absolute), 5°C steps −20…65°C.

   DATA PROVENANCE (web-verified 2026-07-18, explicitly authorised):
   - R32, R22, R134a, R290: NIST Chemistry WebBook (SRD 69) saturation
     pressures, converted absolute → gauge. Exact to the kPa.
   - R410A: A-Gas (UK) PT chart (liquid/vapour barg columns).
   - R404A, R407C: iGas USA PT charts (liquid/vapour psig columns × 6.895).
   Blends carry their real LIQUID (bubble) and VAPOR (dew) columns —
   superheat reads vapor, subcooling reads liquid, like a printed two-column
   card. R410A/R404A glide is small (<1 K); R407C glides ~6 K, so using the
   right column there genuinely matters.

   NOT manufacturer pack data — refrigerant physics reference only. */

export type RefrigerantKey =
  | "R32"
  | "R410A"
  | "R22"
  | "R407C"
  | "R134a"
  | "R404A"
  | "R290";

export interface SatPoint {
  /** saturation temperature °C */
  c: number;
  /** bubble-point pressure, kPa gauge (liquid column) */
  liquid: number;
  /** dew-point pressure, kPa gauge (vapor column) */
  vapor: number;
}

export interface OperatingWindow {
  key: string;
  label: string;
  side: "suction" | "discharge";
  /** saturation-temperature window, °C */
  satLoC: number;
  satHiC: number;
  note: string;
}

export interface Refrigerant {
  key: RefrigerantKey;
  /** chemistry / blend one-liner */
  name: string;
  /** where you meet it in the field */
  uses: string;
  /** short status chip, e.g. "Current standard" */
  status: string;
  /** ASHRAE safety class + plain meaning */
  safety: string;
  /** true = flammable enough to change work practice (A2L/A3) */
  flammable: boolean;
  /** temperature glide, K (0 = pure/azeotropic chart convention) */
  glideK: number;
  /** UI accent colour */
  color: string;
  table: SatPoint[];
  /** typical stabilised operating windows for THIS refrigerant's usual duty */
  cooling: OperatingWindow[];
  heating: OperatingWindow[];
}

/* ─────────────────── shared window presets ───────────────────
   AC refrigerants share the split/ducted sanity bands; refrigeration and
   chiller fluids get their own duty windows. */

const AC_COOLING: OperatingWindow[] = [
  {
    key: "cool-suction",
    label: "Suction (low side)",
    side: "suction",
    satLoC: 0,
    satHiC: 12,
    note: "Evaporating ~0–12°C. Below 0°C risks coil icing — check airflow and charge.",
  },
  {
    key: "cool-discharge",
    label: "Discharge (high side)",
    side: "discharge",
    satLoC: 40,
    satHiC: 55,
    note: "Condensing ≈ outdoor ambient + 10–15 K. On a 35°C day expect ~45–50°C.",
  },
];

const AC_HEATING: OperatingWindow[] = [
  {
    key: "heat-suction",
    label: "Suction (low side)",
    side: "suction",
    satLoC: -15,
    satHiC: 5,
    note: "Evaporating ≈ outdoor ambient − 5–10 K. Outdoor coil frost is normal; defrost should clear it.",
  },
  {
    key: "heat-discharge",
    label: "Discharge (high side)",
    side: "discharge",
    satLoC: 35,
    satHiC: 55,
    note: "Condensing ~35–55°C depending on indoor load and target temperature.",
  },
];

/** single-value table helper for pure / near-azeotropic fluids */
const flat = (rows: [number, number][]): SatPoint[] =>
  rows.map(([c, kpa]) => ({ c, liquid: kpa, vapor: kpa }));

/* ───────────────────────── refrigerants ───────────────────────── */

export const REFRIGERANTS: Refrigerant[] = [
  {
    key: "R32",
    name: "Difluoromethane — pure fluid",
    uses: "New splits, multis & light ducted (~2018 on)",
    status: "Current standard",
    safety: "A2L — mildly flammable",
    flammable: true,
    glideK: 0,
    color: "#00E5C0",
    /* NIST WebBook, abs − 101.325 */
    table: flat([
      [-20, 304], [-15, 387], [-10, 481], [-5, 589], [0, 712], [5, 850],
      [10, 1006], [15, 1180], [20, 1373], [25, 1588], [30, 1826], [35, 2089],
      [40, 2377], [45, 2694], [50, 3040], [55, 3419], [60, 3832], [65, 4283],
    ]),
    cooling: AC_COOLING,
    heating: AC_HEATING,
  },
  {
    key: "R410A",
    name: "R32/R125 blend — near-azeotrope (glide < 0.2 K)",
    uses: "The installed base — most splits, ducted & VRF ~2005–2020",
    status: "Installed base",
    safety: "A1 — non-flammable",
    flammable: false,
    glideK: 0.1,
    color: "#2E68FF",
    /* A-Gas PT chart, barg × 100 — real liquid/vapour columns */
    table: [
      { c: -20, liquid: 299, vapor: 298 },
      { c: -15, liquid: 381, vapor: 379 },
      { c: -10, liquid: 473, vapor: 471 },
      { c: -5, liquid: 580, vapor: 578 },
      { c: 0, liquid: 699, vapor: 697 },
      { c: 5, liquid: 836, vapor: 833 },
      { c: 10, liquid: 987, vapor: 984 },
      { c: 15, liquid: 1158, vapor: 1154 },
      { c: 20, liquid: 1346, vapor: 1342 },
      { c: 25, liquid: 1557, vapor: 1551 },
      { c: 30, liquid: 1788, vapor: 1782 },
      { c: 35, liquid: 2045, vapor: 2038 },
      { c: 40, liquid: 2324, vapor: 2317 },
      { c: 45, liquid: 2633, vapor: 2626 },
      { c: 50, liquid: 2969, vapor: 2962 },
      { c: 55, liquid: 3339, vapor: 3331 },
      { c: 60, liquid: 3741, vapor: 3733 },
      { c: 65, liquid: 4182, vapor: 4176 },
    ],
    cooling: AC_COOLING,
    heating: AC_HEATING,
  },
  {
    key: "R22",
    name: "Chlorodifluoromethane (HCFC) — pure fluid",
    uses: "Legacy splits & package units — service only, imports ended 2016",
    status: "Phase-out — legacy",
    safety: "A1 — non-flammable",
    flammable: false,
    glideK: 0,
    color: "#FF8A00",
    /* NIST WebBook, abs − 101.325 */
    table: flat([
      [-20, 144], [-15, 195], [-10, 253], [-5, 321], [0, 397], [5, 483],
      [10, 580], [15, 688], [20, 809], [25, 943], [30, 1091], [35, 1254],
      [40, 1432], [45, 1628], [50, 1841], [55, 2074], [60, 2326], [65, 2600],
    ]),
    cooling: AC_COOLING,
    heating: AC_HEATING,
  },
  {
    key: "R407C",
    name: "R32/R125/R134a blend — real glide, two-column chart",
    uses: "R22 retrofits in older ducted & package units",
    status: "R22 retrofit",
    safety: "A1 — non-flammable",
    flammable: false,
    glideK: 5.5,
    color: "#8A2BE2",
    /* iGas PT chart, psig × 6.895 — bubble (liquid) / dew (vapor). Subcool
       from the LIQUID column, superheat from the VAPOR column. */
    table: [
      { c: -20, liquid: 179, vapor: 113 },
      { c: -15, liquid: 237, vapor: 162 },
      { c: -10, liquid: 303, vapor: 219 },
      { c: -5, liquid: 380, vapor: 284 },
      { c: 0, liquid: 467, vapor: 359 },
      { c: 5, liquid: 565, vapor: 445 },
      { c: 10, liquid: 675, vapor: 543 },
      { c: 15, liquid: 798, vapor: 654 },
      { c: 20, liquid: 936, vapor: 779 },
      { c: 25, liquid: 1089, vapor: 919 },
      { c: 30, liquid: 1258, vapor: 1075 },
      { c: 35, liquid: 1444, vapor: 1248 },
      { c: 40, liquid: 1648, vapor: 1440 },
      { c: 45, liquid: 1871, vapor: 1653 },
      { c: 50, liquid: 2115, vapor: 1886 },
      { c: 55, liquid: 2380, vapor: 2144 },
      { c: 60, liquid: 2668, vapor: 2428 },
      { c: 65, liquid: 2980, vapor: 2739 },
    ],
    cooling: AC_COOLING,
    heating: AC_HEATING,
  },
  {
    key: "R134a",
    name: "Tetrafluoroethane — pure fluid",
    uses: "Chillers, cool rooms (high temp), vehicle AC, domestic fridges",
    status: "Chillers & transport",
    safety: "A1 — non-flammable",
    flammable: false,
    glideK: 0,
    color: "#38BDF8",
    /* NIST WebBook, abs − 101.325 */
    table: flat([
      [-20, 31], [-15, 63], [-10, 99], [-5, 142], [0, 191], [5, 248],
      [10, 313], [15, 387], [20, 470], [25, 564], [30, 669], [35, 786],
      [40, 915], [45, 1059], [50, 1217], [55, 1390], [60, 1580], [65, 1789],
    ]),
    cooling: [
      {
        key: "cool-suction",
        label: "Suction (low side)",
        side: "suction",
        satLoC: 0,
        satHiC: 8,
        note: "Chiller / medium-temp duty evaporates ~0–8°C. Vehicle AC similar at idle test.",
      },
      {
        key: "cool-discharge",
        label: "Discharge (high side)",
        side: "discharge",
        satLoC: 40,
        satHiC: 55,
        note: "Condensing ≈ ambient + 10–15 K.",
      },
    ],
    heating: [],
  },
  {
    key: "R404A",
    name: "R125/R143a/R134a blend — near-azeotrope (glide ~0.5 K)",
    uses: "Cold rooms & freezers — commercial refrigeration",
    status: "Refrigeration",
    safety: "A1 — non-flammable",
    flammable: false,
    glideK: 0.5,
    color: "#FF3366",
    /* iGas PT chart, psig × 6.895 — real liquid/vapour columns */
    table: [
      { c: -20, liquid: 205, vapor: 199 },
      { c: -15, liquid: 268, vapor: 260 },
      { c: -10, liquid: 338, vapor: 330 },
      { c: -5, liquid: 418, vapor: 409 },
      { c: 0, liquid: 509, vapor: 499 },
      { c: 5, liquid: 611, vapor: 600 },
      { c: 10, liquid: 726, vapor: 714 },
      { c: 15, liquid: 854, vapor: 842 },
      { c: 20, liquid: 996, vapor: 983 },
      { c: 25, liquid: 1153, vapor: 1140 },
      { c: 30, liquid: 1327, vapor: 1313 },
      { c: 35, liquid: 1518, vapor: 1504 },
      { c: 40, liquid: 1728, vapor: 1713 },
      { c: 45, liquid: 1958, vapor: 1943 },
      { c: 50, liquid: 2209, vapor: 2195 },
      { c: 55, liquid: 2484, vapor: 2469 },
      { c: 60, liquid: 2783, vapor: 2770 },
      { c: 65, liquid: 3112, vapor: 3099 },
    ],
    cooling: [
      {
        key: "mt-suction",
        label: "Suction — cold room (MT)",
        side: "suction",
        satLoC: -10,
        satHiC: 0,
        note: "Medium-temp rooms evaporate ~−10…0°C.",
      },
      {
        key: "lt-suction",
        label: "Suction — freezer (LT)",
        side: "suction",
        satLoC: -20,
        satHiC: -10,
        note: "Low-temp freezers evaporate ~−30…−20°C — the chart floor is −20°C, so the band shows its upper end.",
      },
      {
        key: "cool-discharge",
        label: "Discharge (high side)",
        side: "discharge",
        satLoC: 25,
        satHiC: 45,
        note: "Condensing 25–45°C — many plants float the head pressure with ambient.",
      },
    ],
    heating: [],
  },
  {
    key: "R290",
    name: "Propane — natural hydrocarbon, pure fluid",
    uses: "Portables, monoblocs, some heat pumps & fridges",
    status: "Natural — growing",
    safety: "A3 — highly flammable",
    flammable: true,
    glideK: 0,
    color: "#22C55E",
    /* NIST WebBook, abs − 101.325 */
    table: flat([
      [-20, 143], [-15, 190], [-10, 244], [-5, 305], [0, 373], [5, 450],
      [10, 535], [15, 630], [20, 735], [25, 851], [30, 978], [35, 1117],
      [40, 1268], [45, 1433], [50, 1612], [55, 1806], [60, 2015], [65, 2242],
    ]),
    cooling: AC_COOLING,
    heating: AC_HEATING,
  },
];

export const REFRIGERANT_KEYS: readonly RefrigerantKey[] = REFRIGERANTS.map((r) => r.key);

export function getRefrigerant(key: RefrigerantKey): Refrigerant {
  return REFRIGERANTS.find((r) => r.key === key) ?? REFRIGERANTS[0];
}

/* ─────────────────────────── interpolation ─────────────────────────── */

export type SatSide = "liquid" | "vapor";

/** Saturation pressure (kPa gauge) at a temperature, linear between table
    points. `side` picks the bubble (liquid) or dew (vapor) column — they
    only differ on glide blends. Null outside the table range. */
export function satPressureKpa(
  key: RefrigerantKey,
  tempC: number,
  side: SatSide = "vapor"
): number | null {
  const t = getRefrigerant(key).table;
  if (tempC < t[0].c || tempC > t[t.length - 1].c) return null;
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i], b = t[i + 1];
    if (tempC >= a.c && tempC <= b.c) {
      const f = (tempC - a.c) / (b.c - a.c);
      return Math.round((a[side] + f * (b[side] - a[side])) * 10) / 10;
    }
  }
  return null;
}

/** Saturation temperature (°C) at a gauge pressure — the lookup a tech does
    reading their manifold. Null outside the table range. */
export function satTempC(
  key: RefrigerantKey,
  kpaGauge: number,
  side: SatSide = "vapor"
): number | null {
  const t = getRefrigerant(key).table;
  if (kpaGauge < t[0][side] || kpaGauge > t[t.length - 1][side]) return null;
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i], b = t[i + 1];
    if (kpaGauge >= a[side] && kpaGauge <= b[side]) {
      const f = (kpaGauge - a[side]) / (b[side] - a[side]);
      return Math.round((a.c + f * (b.c - a.c)) * 10) / 10;
    }
  }
  return null;
}

/* ─────────────────────── superheat / subcooling ─────────────────────── */

/** Superheat (K): suction line temp − DEW temp at suction pressure.
    Null when the pressure is off-chart. Negative = reading error or flooding. */
export function superheatK(
  key: RefrigerantKey,
  suctionKpaGauge: number,
  suctionLineTempC: number
): number | null {
  const sat = satTempC(key, suctionKpaGauge, "vapor");
  if (sat === null) return null;
  return Math.round((suctionLineTempC - sat) * 10) / 10;
}

/** Subcooling (K): BUBBLE temp at liquid pressure − liquid line temp.
    Null when the pressure is off-chart. Negative = flash gas in the liquid line. */
export function subcoolingK(
  key: RefrigerantKey,
  liquidKpaGauge: number,
  liquidLineTempC: number
): number | null {
  const sat = satTempC(key, liquidKpaGauge, "liquid");
  if (sat === null) return null;
  return Math.round((sat - liquidLineTempC) * 10) / 10;
}

/* ────────────────────────────── units ────────────────────────────── */

export const KPA_PER_PSI = 6.894757;

export function kpaToPsi(kpa: number): number {
  return Math.round((kpa / KPA_PER_PSI) * 10) / 10;
}

export function psiToKpa(psi: number): number {
  return Math.round(psi * KPA_PER_PSI * 10) / 10;
}

/* ───────────────────── operating window pressures ─────────────────────
   A window's pressure band (kPa gauge) from its sat temps — suction reads
   the vapor column, discharge the liquid column (matches gauge practice). */

export function windowPressures(
  key: RefrigerantKey,
  w: OperatingWindow
): { lo: number; hi: number } | null {
  const side: SatSide = w.side === "suction" ? "vapor" : "liquid";
  const lo = satPressureKpa(key, w.satLoC, side);
  const hi = satPressureKpa(key, w.satHiC, side);
  if (lo === null || hi === null) return null;
  return { lo: Math.round(lo), hi: Math.round(hi) };
}
