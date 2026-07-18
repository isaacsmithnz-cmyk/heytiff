/* Refrigerant pressure–temperature reference — pure data + math for the
   Running Pressures tool. Zero deps, no React (lib/studio discipline).

   Covers the refrigerants an Australian HVAC tech actually meets, ordered
   most-relevant-first. Saturation tables are standard published property
   data (gauge pressure at sea level, 101 kPa atmospheric), 5°C steps
   −20…65°C — the same numbers as a printed field PT chart, within ±1–3%.

   Glide: pure fluids and near-azeotropes (R32, R410A, R404A ≲0.7 K) use a
   single pressure per temperature (liquid === vapor, chart convention).
   R407C has real glide (~5–6 K), so it carries separate LIQUID (bubble)
   and VAPOR (dew) columns — superheat reads the vapor column, subcooling
   reads the liquid column, exactly like the printed two-column charts.

   NOT manufacturer pack data — physics reference only. */

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
    table: flat([
      [-20, 304], [-15, 387], [-10, 483], [-5, 592], [0, 716], [5, 857],
      [10, 1014], [15, 1191], [20, 1387], [25, 1605], [30, 1845], [35, 2110],
      [40, 2401], [45, 2719], [50, 3065], [55, 3443], [60, 3853], [65, 4298],
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
    table: flat([
      [-20, 299], [-15, 380], [-10, 472], [-5, 578], [0, 697], [5, 832],
      [10, 984], [15, 1154], [20, 1343], [25, 1553], [30, 1784], [35, 2039],
      [40, 2319], [45, 2626], [50, 2960], [55, 3325], [60, 3721], [65, 4152],
    ]),
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
    table: flat([
      [-20, 144], [-15, 195], [-10, 254], [-5, 321], [0, 397], [5, 483],
      [10, 580], [15, 690], [20, 809], [25, 943], [30, 1090], [35, 1254],
      [40, 1433], [45, 1628], [50, 1842], [55, 2074], [60, 2326], [65, 2599],
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
    /* bubble (liquid) / dew (vapor) — blend-computed, ±3%. Subcool from the
       LIQUID column, superheat from the VAPOR column. */
    table: [
      { c: -20, liquid: 172, vapor: 108 },
      { c: -15, liquid: 229, vapor: 156 },
      { c: -10, liquid: 295, vapor: 210 },
      { c: -5, liquid: 370, vapor: 272 },
      { c: 0, liquid: 457, vapor: 346 },
      { c: 5, liquid: 557, vapor: 430 },
      { c: 10, liquid: 668, vapor: 524 },
      { c: 15, liquid: 793, vapor: 632 },
      { c: 20, liquid: 933, vapor: 752 },
      { c: 25, liquid: 1089, vapor: 885 },
      { c: 30, liquid: 1262, vapor: 1035 },
      { c: 35, liquid: 1454, vapor: 1203 },
      { c: 40, liquid: 1666, vapor: 1387 },
      { c: 45, liquid: 1898, vapor: 1591 },
      { c: 50, liquid: 2152, vapor: 1811 },
      { c: 55, liquid: 2431, vapor: 2054 },
      { c: 60, liquid: 2735, vapor: 2326 },
      { c: 65, liquid: 3066, vapor: 2616 },
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
    table: flat([
      [-20, 32], [-15, 63], [-10, 100], [-5, 142], [0, 192], [5, 249],
      [10, 314], [15, 388], [20, 471], [25, 564], [30, 669], [35, 786],
      [40, 916], [45, 1059], [50, 1217], [55, 1390], [60, 1581], [65, 1789],
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
    table: flat([
      [-20, 199], [-15, 264], [-10, 338], [-5, 424], [0, 521], [5, 632],
      [10, 758], [15, 899], [20, 1058], [25, 1235], [30, 1431], [35, 1649],
      [40, 1890], [45, 2155], [50, 2446], [55, 2765], [60, 3115], [65, 3499],
    ]),
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
    table: flat([
      [-20, 144], [-15, 191], [-10, 244], [-5, 305], [0, 374], [5, 451],
      [10, 537], [15, 634], [20, 735], [25, 852], [30, 979], [35, 1118],
      [40, 1269], [45, 1434], [50, 1613], [55, 1806], [60, 2015], [65, 2240],
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
