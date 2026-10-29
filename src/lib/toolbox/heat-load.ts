/* Heat Load's own arithmetic, shared by the web's Toolbox calculator
   (components/toolbox/heat-load) and the phone's (api/mobile/toolbox): one
   room, the Design Studio's engine (lib/studio/loads), and the unit class
   that covers it. Moved out of the component on 29 October 2026 so the phone
   answers with the same numbers. Pure. */

import {
  DEFAULT_CLIMATE_ZONE,
  roomHeatLoadKw,
  type BuildingType,
  type GlazingLevel,
  type Orientation,
  type RoomCondition,
} from "@/lib/studio/loads";


export interface HlState {
  areaMode: "dims" | "area";
  lengthM: string;
  widthM: string;
  areaM2: string;
  climateZone: number;
  buildingType: BuildingType;
  wm2Override: string;
  glazing: GlazingLevel;
  condition: RoomCondition;
  ceilingHeightM: string;
  orientation: Orientation;
  internal: boolean;
}

export const HL_DEFAULTS: HlState = {
  areaMode: "dims",
  lengthM: "",
  widthM: "",
  areaM2: "",
  climateZone: DEFAULT_CLIMATE_ZONE,
  buildingType: "residential",
  wm2Override: "",
  glazing: "moderate",
  condition: "standard",
  ceilingHeightM: "2.4",
  orientation: "N",
  internal: false,
};

/** Lenient numeric input parse — null unless a finite positive number. */
export function parseNum(s: string): number | null {
  const n = Number(String(s).trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Floor area in m², from L×W or the direct area field. */
export function hlArea(s: Pick<HlState, "areaMode" | "lengthM" | "widthM" | "areaM2">): number | null {
  if (s.areaMode === "area") return parseNum(s.areaM2);
  const l = parseNum(s.lengthM);
  const w = parseNum(s.widthM);
  return l && w ? Math.round(l * w * 100) / 100 : null;
}

/** Design load in kW via the studio engine, or null while size is incomplete. */
export function hlLoadKw(s: HlState): number | null {
  const areaM2 = hlArea(s);
  if (!areaM2) return null;
  return roomHeatLoadKw({
    areaM2,
    climateZone: s.climateZone,
    buildingType: s.buildingType,
    baseWm2Override: parseNum(s.wm2Override),
    glazing: s.glazing,
    condition: s.condition,
    ceilingHeightM: parseNum(s.ceilingHeightM) ?? 2.4,
    orientation: s.orientation,
    hasExternalWalls: !s.internal,
  });
}

/** Typical high-wall split capacity classes (generic industry steps, not a
    manufacturer table). Null → beyond single-split territory. */
export const UNIT_CLASSES = [2.0, 2.5, 3.5, 5.0, 6.0, 7.1, 8.0] as const;

export function suggestClassKw(loadKw: number): number | null {
  for (const c of UNIT_CLASSES) if (c >= loadKw - 1e-9) return c;
  return null;
}

