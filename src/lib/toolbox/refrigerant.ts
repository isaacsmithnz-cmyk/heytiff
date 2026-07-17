/* Refrigerant pressure–temperature reference — pure data + math for the
   Running Pressures tool. Zero deps, no React (lib/studio discipline).

   Saturation tables are standard published R32 / R410A property data (gauge
   pressure at sea level, 101 kPa atmospheric), 5°C steps −20…65°C — the same
   numbers as a printed field PT chart, within ±1%. R410A's temperature glide
   is < 0.2 K so the single-value chart convention applies (dew ≈ bubble);
   R32 is a pure fluid. NOT manufacturer pack data — physics reference only. */

export type Refrigerant = "R32" | "R410A";

export interface SatPoint {
  /** saturation temperature °C */
  c: number;
  /** saturation pressure, kPa gauge */
  kpa: number;
}

/** R32 saturation, kPa gauge. */
export const R32_SAT: SatPoint[] = [
  { c: -20, kpa: 304 },
  { c: -15, kpa: 387 },
  { c: -10, kpa: 483 },
  { c: -5, kpa: 592 },
  { c: 0, kpa: 716 },
  { c: 5, kpa: 857 },
  { c: 10, kpa: 1014 },
  { c: 15, kpa: 1191 },
  { c: 20, kpa: 1387 },
  { c: 25, kpa: 1605 },
  { c: 30, kpa: 1845 },
  { c: 35, kpa: 2110 },
  { c: 40, kpa: 2401 },
  { c: 45, kpa: 2719 },
  { c: 50, kpa: 3065 },
  { c: 55, kpa: 3443 },
  { c: 60, kpa: 3853 },
  { c: 65, kpa: 4298 },
];

/** R410A saturation, kPa gauge. */
export const R410A_SAT: SatPoint[] = [
  { c: -20, kpa: 299 },
  { c: -15, kpa: 380 },
  { c: -10, kpa: 472 },
  { c: -5, kpa: 578 },
  { c: 0, kpa: 697 },
  { c: 5, kpa: 832 },
  { c: 10, kpa: 984 },
  { c: 15, kpa: 1154 },
  { c: 20, kpa: 1343 },
  { c: 25, kpa: 1553 },
  { c: 30, kpa: 1784 },
  { c: 35, kpa: 2039 },
  { c: 40, kpa: 2319 },
  { c: 45, kpa: 2626 },
  { c: 50, kpa: 2960 },
  { c: 55, kpa: 3325 },
  { c: 60, kpa: 3721 },
  { c: 65, kpa: 4152 },
];

export const SAT_TABLES: Record<Refrigerant, SatPoint[]> = {
  R32: R32_SAT,
  R410A: R410A_SAT,
};

export const REFRIGERANTS: readonly Refrigerant[] = ["R32", "R410A"];

/* ─────────────────────────── interpolation ─────────────────────────── */

/** Saturation pressure (kPa gauge) at a temperature, linear between table
    points. Null outside the table range — don't extrapolate a field chart. */
export function satPressureKpa(refrigerant: Refrigerant, tempC: number): number | null {
  const t = SAT_TABLES[refrigerant];
  if (tempC < t[0].c || tempC > t[t.length - 1].c) return null;
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i], b = t[i + 1];
    if (tempC >= a.c && tempC <= b.c) {
      const f = (tempC - a.c) / (b.c - a.c);
      return Math.round((a.kpa + f * (b.kpa - a.kpa)) * 10) / 10;
    }
  }
  return null;
}

/** Saturation temperature (°C) at a gauge pressure — the inverse lookup a
    tech does reading their manifold. Null outside the table range. */
export function satTempC(refrigerant: Refrigerant, kpaGauge: number): number | null {
  const t = SAT_TABLES[refrigerant];
  if (kpaGauge < t[0].kpa || kpaGauge > t[t.length - 1].kpa) return null;
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i], b = t[i + 1];
    if (kpaGauge >= a.kpa && kpaGauge <= b.kpa) {
      const f = (kpaGauge - a.kpa) / (b.kpa - a.kpa);
      return Math.round((a.c + f * (b.c - a.c)) * 10) / 10;
    }
  }
  return null;
}

/* ─────────────────────── superheat / subcooling ─────────────────────── */

/** Superheat (K): suction line temp − saturation temp at suction pressure.
    Null when the pressure is off-chart. Negative = reading error or flooding. */
export function superheatK(
  refrigerant: Refrigerant,
  suctionKpaGauge: number,
  suctionLineTempC: number
): number | null {
  const sat = satTempC(refrigerant, suctionKpaGauge);
  if (sat === null) return null;
  return Math.round((suctionLineTempC - sat) * 10) / 10;
}

/** Subcooling (K): saturation temp at liquid pressure − liquid line temp.
    Null when the pressure is off-chart. Negative = flash gas in the liquid line. */
export function subcoolingK(
  refrigerant: Refrigerant,
  liquidKpaGauge: number,
  liquidLineTempC: number
): number | null {
  const sat = satTempC(refrigerant, liquidKpaGauge);
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

/* ───────────────────── typical operating windows ─────────────────────
   Field sanity windows expressed as SATURATION TEMPERATURES, converted to
   pressure through the tables above so both refrigerants read correctly.
   Inverter systems modulate continuously — these are "does this look sane"
   bands for a stabilised system, not a spec. */

export interface OperatingWindow {
  key: string;
  label: string;
  side: "suction" | "discharge";
  /** saturation-temperature window, °C */
  satLoC: number;
  satHiC: number;
  note: string;
}

export const COOLING_WINDOWS: OperatingWindow[] = [
  {
    key: "cool-suction",
    label: "Suction (low side)",
    side: "suction",
    satLoC: 0,
    satHiC: 12,
    note: "Evaporating temperature ~0–12°C. Below 0°C risks coil icing — check airflow and charge.",
  },
  {
    key: "cool-discharge",
    label: "Discharge (high side)",
    side: "discharge",
    satLoC: 40,
    satHiC: 55,
    note: "Condensing temperature ≈ outdoor ambient + 10–15 K. On a 35°C day expect ~45–50°C.",
  },
];

export const HEATING_WINDOWS: OperatingWindow[] = [
  {
    key: "heat-suction",
    label: "Suction (low side)",
    side: "suction",
    satLoC: -15,
    satHiC: 5,
    note: "Evaporating temperature ≈ outdoor ambient − 5–10 K. Frosting outdoor coil is normal; defrost should clear it.",
  },
  {
    key: "heat-discharge",
    label: "Discharge (high side)",
    side: "discharge",
    satLoC: 35,
    satHiC: 55,
    note: "Condensing temperature ~35–55°C depending on indoor load and target temperature.",
  },
];

/** A window's pressure band (kPa gauge) for a refrigerant, from its sat temps. */
export function windowPressures(
  refrigerant: Refrigerant,
  w: OperatingWindow
): { lo: number; hi: number } | null {
  const lo = satPressureKpa(refrigerant, w.satLoC);
  const hi = satPressureKpa(refrigerant, w.satHiC);
  if (lo === null || hi === null) return null;
  return { lo: Math.round(lo), hi: Math.round(hi) };
}
