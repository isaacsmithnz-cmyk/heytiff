/* Design Studio — Rooms & Loads engine (Stage 3).
   Pure functions, zero deps, no React/canvas/network — the same discipline as
   packs/ and document.ts. Turns a room's area + inputs into a design heat load
   (kW), selects the sizing basis, detects orientation from the north arrow, and
   declares the ventilation airflow-requirement schema the vent module (Stage 9)
   will use. (design-studio-plan.md — Layer 2 "Rooms & loads engine".)

   The heat-load model, the NCC climate-zone W/m² table, and the orientation
   solar-gain multipliers are harvested verbatim from the legacy DUCTR builder
   (_design/vrf-builder/HARVEST.md → app.html 2901-3118, "Grade A" cargo) so the
   numbers reproduce the existing tool exactly. The plan calls this simple
   area×W/m² model a starting point — it lives behind the `roomHeatLoadKw`
   boundary so a fuller calc can replace it without touching callers. */

import type { Point } from "./document";

/* ────────────────── climate zones (Australian NCC, W/m²) ──────────────────
   Rule-of-thumb watts per m² by zone × building type. Source (per DUCTR):
   AIRAH feedback / refrigeration apprenticeship standard (Zone 5 res = 145). */

export type BuildingType = "residential" | "light_commercial" | "commercial";

export interface ClimateZone {
  label: string;
  cities: string;
  residential: number;
  light_commercial: number;
  commercial: number;
  note: string;
}

export const CLIMATE_ZONES: Record<number, ClimateZone> = {
  1: { label: "Zone 1 — High humidity, warm winter", cities: "Darwin, Broome, Cairns, Katherine", residential: 185, light_commercial: 205, commercial: 220, note: "Tropical. Continuous high humidity means latent load is significant — size conservatively." },
  2: { label: "Zone 2 — Warm humid summer, mild winter", cities: "Brisbane, Gold Coast, Townsville, Sunshine Coast", residential: 160, light_commercial: 180, commercial: 195, note: "Subtropical. High summer humidity adds to sensible load. Cooling dominates." },
  3: { label: "Zone 3 — Hot dry summer, warm winter", cities: "Alice Springs, Tennant Creek, Geraldton", residential: 165, light_commercial: 185, commercial: 200, note: "Arid interior. Very high peak temperatures but low humidity. Good insulation pays off." },
  4: { label: "Zone 4 — Hot dry summer, cool winter", cities: "Broken Hill, Dubbo, Mildura, Griffith", residential: 150, light_commercial: 170, commercial: 185, note: "Continental. Both cooling and heating matter — verify heating is not the design condition." },
  5: { label: "Zone 5 — Warm temperate", cities: "Sydney, Perth, Adelaide, Newcastle, Wollongong", residential: 145, light_commercial: 160, commercial: 175, note: "Standard Australian rule-of-thumb zone. 145 W/m² is the refrigeration apprenticeship standard." },
  6: { label: "Zone 6 — Mild temperate", cities: "Melbourne, Geelong, Canberra", residential: 130, light_commercial: 145, commercial: 160, note: "Heating often governs in Zone 6. Check heating capacity at min ambient before finalising." },
  7: { label: "Zone 7 — Cool temperate", cities: "Hobart, Orange, Ballarat, Armidale", residential: 120, light_commercial: 133, commercial: 145, note: "Heating-dominated. Size on heating output — cooling capacity at +35°C is secondary." },
  8: { label: "Zone 8 — Alpine", cities: "Mt Hotham, Thredbo, Falls Creek", residential: 110, light_commercial: 123, commercial: 135, note: "Extreme heating loads. Verify low-ambient heating performance of selected ODU." },
};

export const DEFAULT_CLIMATE_ZONE = 5;

/* ────────────────────────── load factors ────────────────────────── */

export type GlazingLevel = "low" | "moderate" | "high";
export type RoomCondition = "well_insulated" | "standard" | "poor";
export type Orientation = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

/** Glazing area multiplier (more glass → more load). */
export const GLAZING_MULT: Record<GlazingLevel, number> = { low: 0.8, moderate: 1.0, high: 1.24 };
/** Building thermal-condition multiplier. */
export const CONDITION_MULT: Record<RoomCondition, number> = { well_insulated: 0.85, standard: 1.0, poor: 1.2 };
/** Orientation solar-gain multiplier (Southern Hemisphere; W is worst — low
    afternoon sun at peak heat). Applied to the primary exposed wall. */
export const ORIENT_MULT: Record<Orientation, number> = { N: 1.0, NE: 1.1, E: 1.15, SE: 0.95, S: 0.85, SW: 1.15, W: 1.3, NW: 1.2 };

export const ORIENT_LABELS: Record<Orientation, string> = {
  N: "North", NE: "North-East", E: "East", SE: "South-East",
  S: "South", SW: "South-West", W: "West", NW: "North-West",
};

/** Internal / party rooms have no solar exposure at all — the mildest case.
    DUCTR pinned them at ×1.00, which let a marked SOUTH wall (×0.85) LOWER the
    load below the no-walls baseline; floor internal rooms at the table minimum
    instead, so marking external walls can never DECREASE the load. */
export const NO_SOLAR_MULT = Math.min(...Object.values(ORIENT_MULT)); // = S ×0.85

/** Ceiling-height multiplier — graduated, replacing DUCTR's flat ×1.1 which
    under-sized tall spaces (a 4 m ceiling is ~67% more air than 2.4 m, not
    10%). ≤2.7 m is the standard band (×1.00); above it the factor grows with
    half the raw volume ratio (loads aren't purely volumetric — envelope and
    solar dominate), floored at the legacy ×1.10 so old estimates never shrink,
    and capped at ×1.50 (~4.8 m — beyond that it's warehouse territory and the
    area rule-of-thumb itself stops being credible). 3.0 m → ×1.125,
    3.5 m → ×1.23, 4.0 m → ×1.33. */
export function heightMult(ceilingHeightM: number): number {
  if (ceilingHeightM <= 2.7) return 1;
  return Math.min(1.5, Math.max(1.1, 1 + 0.5 * (ceilingHeightM / 2.4 - 1)));
}

export const ORIENTATIONS: readonly Orientation[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** The base W/m² for a job's climate zone + building type, honouring a manual
    override. Falls back to Zone 5 / residential like the legacy tool. */
export function baseWm2(opts: {
  climateZone: number;
  buildingType: BuildingType;
  override?: number | null;
}): number {
  if (opts.override && opts.override > 0) return opts.override;
  const z = CLIMATE_ZONES[opts.climateZone] ?? CLIMATE_ZONES[DEFAULT_CLIMATE_ZONE];
  return z[opts.buildingType] ?? z.residential;
}

/* ─────────────────────────── heat load ─────────────────────────── */

export interface RoomLoadInputs {
  /** room area in m² — from the drawn polygon × floor scale (geometry.ts) */
  areaM2: number;
  climateZone: number;
  buildingType: BuildingType;
  /** manual W/m² override; null/absent = use the zone table */
  baseWm2Override?: number | null;
  glazing?: GlazingLevel; // default moderate
  condition?: RoomCondition; // default standard
  ceilingHeightM?: number; // default 2.4; >2.7 graduated via heightMult (4 m → ×1.33)
  orientation?: Orientation; // primary exposed wall; default N
  /** internal room sharing a party wall — no solar gain (NO_SOLAR_MULT) */
  partyWall?: boolean;
  /** false = internal room, no external walls — no solar gain (NO_SOLAR_MULT) */
  hasExternalWalls?: boolean; // default true
}

/** The room's design load in kW — the harvested `calc­HeatLoad` model:
    `round(area × W/m² × glazing × condition × height × orientation)` watts,
    then ÷1000. Rounding happens in WATTS (matches the legacy tool exactly), so
    the result carries up to 3 decimal places. Swap this function to change the
    load method; callers depend only on its signature. */
export function roomHeatLoadKw(input: RoomLoadInputs): number {
  const base = baseWm2({
    climateZone: input.climateZone,
    buildingType: input.buildingType,
    override: input.baseWm2Override,
  });
  const glass = GLAZING_MULT[input.glazing ?? "moderate"];
  const cond = CONDITION_MULT[input.condition ?? "standard"];
  const height = heightMult(input.ceilingHeightM ?? 2.4);
  const noSolar = input.partyWall || input.hasExternalWalls === false;
  const orient = noSolar ? NO_SOLAR_MULT : ORIENT_MULT[input.orientation ?? "N"];
  const watts = Math.round(input.areaM2 * base * glass * cond * height * orient);
  return watts / 1000;
}

/* ───────────────────────── sizing basis ─────────────────────────
   The load is one number; the sizing basis decides which of a unit's ratings
   must cover it. worst-of-both = the unit must satisfy BOTH cool and heat, i.e.
   size against the smaller of the two ratings. (DesignSettings.sizingBasis.) */

export type SizingBasis = "cooling" | "heating" | "worst-of-both";

export function sizingCapacityKw(
  unit: { capacity_cool_kw: number; capacity_heat_kw: number },
  basis: SizingBasis
): number {
  switch (basis) {
    case "cooling":
      return unit.capacity_cool_kw;
    case "heating":
      return unit.capacity_heat_kw;
    case "worst-of-both":
      return Math.min(unit.capacity_cool_kw, unit.capacity_heat_kw);
  }
}

/** Does a unit cover a room's load under the chosen basis? */
export function unitMeetsLoad(
  unit: { capacity_cool_kw: number; capacity_heat_kw: number },
  loadKw: number,
  basis: SizingBasis
): boolean {
  return sizingCapacityKw(unit, basis) >= loadKw;
}

/* ──────────────── orientation detection (north arrow) ────────────────
   Given a room polygon and the north-arrow bearing (degrees clockwise from
   screen-up), find the compass direction the room's primary exposed wall faces
   — the longest exterior edge, breaking ties toward the more sun-exposed face.
   Harvested from DUCTR (primaryWallBearing / bearingToCompass). */

/** Bearing (degrees CW from north) → 8-point compass. */
export function bearingToCompass(deg: number): Orientation {
  const d = ((deg % 360) + 360) % 360;
  return ORIENTATIONS[Math.round(d / 45) % 8];
}

const SOLAR_RANK: Record<Orientation, number> = { W: 6, NW: 5, N: 4, NE: 3, E: 2, SE: 1, S: 0, SW: 1 };

/** Outward bearing (deg from true north) of the polygon's primary exposed wall,
    or null for a degenerate polygon. `northBearingDeg` = the north arrow's
    bearing; 0 means north points straight up. */
export function primaryWallBearing(points: Point[], northBearingDeg = 0): number | null {
  if (!points || points.length < 3) return null;
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length; cy /= points.length;

  let maxLen = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > maxLen) maxLen = len;
  }

  let bestNormal: Point | null = null;
  let bestScore = -1;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < maxLen * 0.85) continue; // only edges near the longest
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const n1 = { x: -dy, y: dx }, n2 = { x: dy, y: -dx };
    const tx = mx - cx, ty = my - cy;
    const outward = n1.x * tx + n1.y * ty > 0 ? n1 : n2;
    const planAngle = (Math.atan2(outward.x, -outward.y) * 180) / Math.PI;
    const bearing = (((planAngle - northBearingDeg) % 360) + 360) % 360;
    const compass = bearingToCompass(bearing);
    const score = len + (SOLAR_RANK[compass] ?? 0) * 0.01; // length primary, solar tiebreak
    if (score > bestScore) { bestScore = score; bestNormal = outward; }
  }

  if (!bestNormal) return null;
  const planAngle = (Math.atan2(bestNormal.x, -bestNormal.y) * 180) / Math.PI;
  return (((planAngle - northBearingDeg) % 360) + 360) % 360;
}

/** The compass orientation of a room polygon's primary exposed wall. */
export function detectOrientation(points: Point[], northBearingDeg = 0): Orientation | null {
  const b = primaryWallBearing(points, northBearingDeg);
  return b === null ? null : bearingToCompass(b);
}

/** Orientation from EXPLICITLY marked external walls (edge indices) + north.
    Mirrors DUCTR calcOrientationFromWalls: the most sun-exposed marked wall,
    length-weighted with a solar-rank tiebreak. Returns null when no walls are
    marked (an internal / party room — no solar effect). This is the wall-first
    counterpart to detectOrientation's longest-edge auto-guess. */
export function orientationFromWalls(
  points: Point[],
  externalWalls: number[],
  northBearingDeg = 0
): Orientation | null {
  if (!points || points.length < 3 || !externalWalls || externalWalls.length === 0)
    return null;
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length; cy /= points.length;

  let bestCompass: Orientation | null = null;
  let bestScore = -1;
  for (const i of externalWalls) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const n1 = { x: -dy, y: dx }, n2 = { x: dy, y: -dx };
    const tx = mx - cx, ty = my - cy;
    const outward = n1.x * tx + n1.y * ty > 0 ? n1 : n2;
    const planAngle = (Math.atan2(outward.x, -outward.y) * 180) / Math.PI;
    const bearing = (((planAngle - northBearingDeg) % 360) + 360) % 360;
    const compass = bearingToCompass(bearing);
    const score = len + (SOLAR_RANK[compass] ?? 0) * 0.01;
    if (score > bestScore) { bestScore = score; bestCompass = compass; }
  }
  return bestCompass;
}

/* ─────────── ventilation airflow requirements (schema for Stage 9) ───────────
   Ventilation mode swaps the kW block for an airflow requirement in L/s
   (design-studio-plan.md — Layer 2). This declares the SHAPE + a starter set of
   Australian rule-of-thumb rates. NOTE: these presets are PROVISIONAL — verify
   against AS 1668.2 / NCC F6 before the vent module (Stage 9) ships; they are
   not harvested from a manufacturer book. Structure is stable; numbers may move. */

export type VentMode = "exhaust" | "supply" | "balanced";
export type AirflowBasis = "per-room" | "per-person" | "per-m2";

export interface AirflowPreset {
  spaceType: string;
  mode: VentMode;
  basis: AirflowBasis;
  /** L/s — per room, per person, or per m² depending on `basis` */
  ls: number;
  note?: string;
}

/** Provisional AU rule-of-thumb ventilation rates. Verify vs AS 1668.2 / NCC. */
export const AIRFLOW_PRESETS: Record<string, AirflowPreset> = {
  bathroom: { spaceType: "Bathroom", mode: "exhaust", basis: "per-room", ls: 25 },
  toilet: { spaceType: "Toilet", mode: "exhaust", basis: "per-room", ls: 25 },
  laundry: { spaceType: "Laundry", mode: "exhaust", basis: "per-room", ls: 25 },
  "kitchen-domestic": { spaceType: "Kitchen (domestic)", mode: "exhaust", basis: "per-room", ls: 40 },
  "office-fresh-air": { spaceType: "Office (fresh air)", mode: "supply", basis: "per-person", ls: 10 },
};

/** Required airflow (L/s) for a space, given a preset key and the sizing
    quantity (room count is implicit=1; supply `people`; per-m² `areaM2`). */
export function requiredAirflowLs(
  presetKey: string,
  qty: { people?: number; areaM2?: number } = {}
): number {
  const p = AIRFLOW_PRESETS[presetKey];
  if (!p) return 0;
  switch (p.basis) {
    case "per-room":
      return p.ls;
    case "per-person":
      return p.ls * (qty.people ?? 1);
    case "per-m2":
      return p.ls * (qty.areaM2 ?? 0);
  }
}
