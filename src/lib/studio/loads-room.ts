import type { DesignDocument, DesignObject } from "./document";
import { areaUnitsToM2, polygonArea } from "./geometry";
import {
  roomHeatLoadKw,
  type BuildingType,
  type GlazingLevel,
  type Orientation,
  type RoomCondition,
} from "./loads";

/* Document-aware room-load derivation — pure, shared by the panel UI and the
   coverage engine. (Extracted from split-panel so lib code never imports a
   React component module.) */

export type RoomObj = DesignObject & {
  geometry: { kind: "polygon"; points: { x: number; y: number }[] };
};

export function roomAreaM2(doc: DesignDocument, room: RoomObj): number | null {
  const floor = doc.floors.find((f) => f.id === room.floorId);
  if (!floor?.scaleMmPerUnit) return null;
  return areaUnitsToM2(polygonArea(room.geometry.points), floor.scaleMmPerUnit);
}

/** A room's load is DERIVED from its stored inputs + the job's climate zone —
    never frozen — so changing the zone/building-type re-loads every room. */
export function roomLoadKw(doc: DesignDocument, room: RoomObj): number | null {
  const areaM2 = roomAreaM2(doc, room);
  if (areaM2 == null) return null;
  const zone = parseInt(doc.settings.climateZone ?? "", 10);
  return roomHeatLoadKw({
    areaM2,
    climateZone: Number.isFinite(zone) ? zone : 5,
    buildingType: (doc.settings.buildingType as BuildingType) ?? "residential",
    glazing: room.props.glazing as GlazingLevel | undefined,
    condition: room.props.condition as RoomCondition | undefined,
    ceilingHeightM:
      typeof room.props.ceilingHeightM === "number" ? room.props.ceilingHeightM : undefined,
    orientation: room.props.orientation as Orientation | undefined,
    partyWall: Boolean(room.props.partyWall),
    hasExternalWalls: room.props.hasExternalWalls === false ? false : true,
  });
}
