/* Design Studio — Summary derivations. Pure functions, zero deps, same
   discipline as loads.ts/materials.ts: the Summary screen renders, never
   computes, so everything it shows is derived here where jest can reach it.

   Grows with the summary redesign: Stage 1 ships the design-basis line (the
   climate/building/sizing settings, read-only — they're EDITED in the studio
   menu, because they re-load every room in the engine); later stages add the
   design snapshot and the per-floor rooms & loads tables. */

import type { DesignDocument, DesignSettings } from "./document";
import {
  CLIMATE_ZONES,
  DEFAULT_CLIMATE_ZONE,
  type BuildingType,
  type SizingBasis,
} from "./loads";

/** The zone number the engine actually uses — settings store a stringified
    zone ("5") or null; anything unparsable falls back like loads-room.ts.
    Settings-scoped (not doc) so the studio menu's selects share it. */
export function effectiveClimateZone(settings: DesignSettings): number {
  const z = parseInt(settings.climateZone ?? "", 10);
  return Number.isFinite(z) && CLIMATE_ZONES[z] ? z : DEFAULT_CLIMATE_ZONE;
}

export function effectiveBuildingType(settings: DesignSettings): BuildingType {
  const t = settings.buildingType;
  return t === "light_commercial" || t === "commercial" ? t : "residential";
}

const BUILDING_LABELS: Record<BuildingType, string> = {
  residential: "Residential",
  light_commercial: "Light commercial",
  commercial: "Commercial",
};

const BASIS_LABELS: Record<SizingBasis, string> = {
  cooling: "Sized on cooling",
  heating: "Sized on heating",
  "worst-of-both": "Sized on worst of both",
};

/* ── Design basis — what the loads were computed FROM, for the summary chips
      and the printed pack header. One object so screen and print agree. ── */
export interface DesignBasis {
  zone: number;
  /** full table label, e.g. "Zone 5 — Warm temperate" */
  zoneLabel: string;
  /** first listed city, e.g. "Sydney" — enough to anchor the zone */
  zoneCity: string;
  buildingType: BuildingType;
  buildingLabel: string;
  basis: SizingBasis;
  basisLabel: string;
}

export function designBasis(doc: DesignDocument): DesignBasis {
  const zone = effectiveClimateZone(doc.settings);
  const info = CLIMATE_ZONES[zone];
  const buildingType = effectiveBuildingType(doc.settings);
  return {
    zone,
    zoneLabel: info.label,
    zoneCity: info.cities.split(",")[0].trim(),
    buildingType,
    buildingLabel: BUILDING_LABELS[buildingType],
    basis: doc.settings.sizingBasis,
    basisLabel: BASIS_LABELS[doc.settings.sizingBasis],
  };
}
