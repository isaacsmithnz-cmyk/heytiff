/* Design Studio — Summary derivations. Pure functions, zero deps, same
   discipline as loads.ts/materials.ts: the Summary screen renders, never
   computes, so everything it shows is derived here where jest can reach it.

   Grows with the summary redesign: Stage 1 ships the design-basis line (the
   climate/building/sizing settings, read-only — they're EDITED in the studio
   menu, because they re-load every room in the engine); later stages add the
   design snapshot and the per-floor rooms & loads tables. */

import type { DesignDocument, DesignSettings } from "./document";
import type { DataPack } from "./packs/schema";
import {
  CLIMATE_ZONES,
  DEFAULT_CLIMATE_ZONE,
  type BuildingType,
  type SizingBasis,
} from "./loads";
import { roomAreaM2, roomLoadKw, type RoomObj } from "./loads-room";
import { roomCoverage } from "./coverage";

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

const isRoom = (o: DesignDocument["objects"][number]): o is RoomObj =>
  o.type === "room" && o.geometry.kind === "polygon";

/* ── Design snapshot — the stat strip. Areas/loads sum what's measurable
      (uncalibrated floors have no scale → no area); the unmeasured count is
      surfaced so a partial total never reads as the whole job. ── */
export interface DesignSnapshot {
  floorCount: number;
  roomCount: number;
  /** summed area of the measurable rooms; null when none are measurable */
  areaM2: number | null;
  /** summed design load of the measurable rooms; null when none */
  totalLoadKw: number | null;
  /** rooms on uncalibrated floors — excluded from the totals above */
  unmeasuredRoomCount: number;
  uncalibratedFloorCount: number;
  systemCount: number;
  iduCount: number;
  oduCount: number;
}

export function buildDesignSnapshot(doc: DesignDocument): DesignSnapshot {
  let roomCount = 0;
  let unmeasured = 0;
  let area: number | null = null;
  let load: number | null = null;
  for (const o of doc.objects) {
    if (!isRoom(o)) continue;
    roomCount++;
    const a = roomAreaM2(doc, o);
    const l = roomLoadKw(doc, o);
    if (a == null || l == null) {
      unmeasured++;
      continue;
    }
    area = (area ?? 0) + a;
    load = (load ?? 0) + l;
  }
  let idu = 0;
  let odu = 0;
  for (const o of doc.objects) {
    if (o.type !== "unit") continue;
    if (o.props.role === "idu") idu++;
    else if (o.props.role === "odu") odu++;
  }
  return {
    floorCount: doc.floors.length,
    roomCount,
    areaM2: area == null ? null : Math.round(area * 10) / 10,
    totalLoadKw: load == null ? null : Math.round(load * 10) / 10,
    unmeasuredRoomCount: unmeasured,
    uncalibratedFloorCount: doc.floors.filter((f) => f.scaleMmPerUnit == null)
      .length,
    systemCount: doc.systems.length,
    iduCount: idu,
    oduCount: odu,
  };
}

/* ── Rooms & loads — one table row per room, grouped by floor, with the
      units serving it (coverage contributors, so multi/VRF attribute their
      per-room IDUs and splits their pair). ── */
export interface RoomRow {
  roomId: string;
  name: string;
  areaM2: number | null;
  loadKw: number | null;
  serving: { model: string; systemName: string; colour: string }[];
}

export interface FloorRooms {
  floorId: string;
  name: string;
  level: number;
  calibrated: boolean;
  rooms: RoomRow[];
}

export function roomsByFloor(
  doc: DesignDocument,
  pack: DataPack | null
): FloorRooms[] {
  const out: FloorRooms[] = [];
  for (const floor of doc.floors) {
    const rooms: RoomRow[] = [];
    for (const o of doc.objects) {
      if (o.floorId !== floor.id || !isRoom(o)) continue;
      const cov = roomCoverage(doc, pack, o, doc.settings.sizingBasis);
      rooms.push({
        roomId: o.id,
        name: String(o.props.name ?? "Room"),
        areaM2: roomAreaM2(doc, o),
        loadKw: roomLoadKw(doc, o),
        serving: cov.contributors.map((c) => ({
          model: c.model,
          systemName: c.systemName,
          colour: c.colour,
        })),
      });
    }
    out.push({
      floorId: floor.id,
      name: floor.name,
      level: floor.level,
      calibrated: floor.scaleMmPerUnit != null,
      rooms,
    });
  }
  return out;
}
