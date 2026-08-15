/* Design Studio — Summary derivations. Pure functions, zero deps, same
   discipline as loads.ts/materials.ts: the Summary screen renders, never
   computes, so everything it shows is derived here where jest can reach it.

   Grows with the summary redesign: Stage 1 ships the design-basis line (the
   climate/building/sizing settings, read-only — they're EDITED in the studio
   menu, because they re-load every room in the engine); later stages add the
   design snapshot and the per-floor rooms & loads tables. */

import type { DesignDocument, DesignSettings, DesignSystem } from "./document";
import type { DataPack } from "./packs/schema";
import {
  CLIMATE_ZONES,
  DEFAULT_CLIMATE_ZONE,
  type BuildingType,
  type SizingBasis,
} from "./loads";
import { roomAreaM2, roomLoadKw, type RoomObj } from "./loads-room";
import { roomCoverage, type CoverageStatus } from "./coverage";
import { buildSystemGraph, totalPipeLengthM } from "./graph";
import { systemComponents } from "./components";

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

/* ── Per-system summary — the shape the redesigned sheet renders ──
      The room is the unit of the sheet, because that is how the document
      stores it: an indoor unit carries `props.roomId`, while the outdoor
      unit, the pipe run and the components belong to the system. So each
      system reports the rooms it serves (each with its own capacity and
      coverage) plus the things those rooms SHARE.

      Same discipline as everything above: the view renders, never computes. */

export interface SummaryRoomRow {
  roomId: string;
  name: string;
  /** floor display name, e.g. "Ground" */
  level: string;
  areaM2: number | null;
  loadKw: number | null;
  /** placed capacity attributed to this room; null when nothing serves it */
  capacityKw: number | null;
  /** covered/load percent, null when either is unknown */
  pct: number | null;
  status: CoverageStatus;
  /** the indoor unit in THIS room (multi/VRF give one per room) */
  indoorModel: string | null;
}

export interface SummarySystem {
  systemId: string;
  name: string;
  colour: string;
  type: DesignSystem["type"];
  /** the brand's display name from the pack, never the slug */
  brandLabel: string;
  /** indoor form factor, e.g. "cassette-4way" → "Cassette (4 way)" */
  styleLabel: string | null;
  outdoorModel: string | null;
  /** true when more than one room shares the outdoor — multi and VRF */
  sharedOutdoor: boolean;
  pipeLiquidMm: number | null;
  pipeGasMm: number | null;
  refrigerant: string | null;
  prechargedKg: number | null;
  totalPipeM: number | null;
  rooms: SummaryRoomRow[];
  /** summed load of the rooms it serves */
  loadKw: number | null;
  /** summed placed capacity */
  capacityKw: number | null;
  pct: number | null;
  status: CoverageStatus;
  components: { role: string; name: string; sub: string; value: string }[];
}

export interface SummaryModel {
  systems: SummarySystem[];
  /** rooms no system serves — the gap in the design, stated plainly */
  unserved: SummaryRoomRow[];
}

const FORM_LABELS: Record<string, string> = {
  "cassette-4way": "Cassette (4 way)",
  "cassette-1way": "Cassette (1 way)",
  ducted: "Ducted",
  "under-ceiling": "Under ceiling",
  wall: "Wall mounted",
  "floor-console": "Floor console",
  "floor-concealed": "Floor concealed",
};

/** "Cassette (4 way)" for a known form factor; the raw value otherwise, so a
    new one in a future pack shows up rather than vanishing. */
export function formFactorLabel(form: string | null | undefined): string | null {
  if (!form) return null;
  return FORM_LABELS[form] ?? form;
}

export function buildSummaryModel(
  doc: DesignDocument,
  pack: DataPack | null
): SummaryModel {
  const floorName = new Map(
    doc.floors.map((f) => [f.id, f.name || `Level ${f.level}`])
  );
  const basis = doc.settings.sizingBasis;

  /* one pass over the rooms: who serves them, and how well */
  const rows = new Map<string, SummaryRoomRow & { systemIds: string[] }>();
  for (const o of doc.objects) {
    if (!isRoom(o)) continue;
    const cov = roomCoverage(doc, pack, o, basis);
    const first = cov.contributors[0] ?? null;
    rows.set(o.id, {
      roomId: o.id,
      name: String(o.props.name ?? "Room"),
      level: floorName.get(o.floorId) ?? "",
      areaM2: roomAreaM2(doc, o),
      loadKw: cov.loadKw,
      capacityKw: cov.contributors.length ? cov.coveredKw : null,
      pct: cov.pct,
      status: cov.status,
      indoorModel: first ? first.model : null,
      systemIds: [...new Set(cov.contributors.map((c) => c.systemId))],
    });
  }

  const strip = ({
    systemIds: _ignored,
    ...row
  }: SummaryRoomRow & { systemIds: string[] }): SummaryRoomRow => row;

  const systems: SummarySystem[] = doc.systems.map((sys) => {
    const mine = [...rows.values()].filter((r) => r.systemIds.includes(sys.id));
    const odu = doc.objects.find(
      (o) =>
        o.systemId === sys.id && o.type === "unit" && o.props.role === "odu"
    );
    const outdoorModel = odu ? String(odu.props.model ?? "") || null : null;
    const oduRow = outdoorModel
      ? pack?.outdoor_units.find((u) => u.model === outdoorModel) ?? null
      : null;
    const iduModel = mine.find((r) => r.indoorModel)?.indoorModel ?? null;
    const iduRow = iduModel
      ? pack?.indoor_units.find((u) => u.model === iduModel) ?? null
      : null;

    const load = mine.reduce<number | null>(
      (a, r) => (r.loadKw == null ? a : (a ?? 0) + r.loadKw),
      null
    );
    const cap = mine.reduce<number | null>(
      (a, r) => (r.capacityKw == null ? a : (a ?? 0) + r.capacityKw),
      null
    );
    const pct =
      load != null && load > 0 && cap != null
        ? Math.round((cap / load) * 100)
        : null;

    return {
      systemId: sys.id,
      name: sys.name,
      colour: sys.colour,
      type: sys.type,
      brandLabel:
        pack?.brands.find((b) => b.id === sys.brand)?.name ?? sys.brand,
      styleLabel: formFactorLabel(iduRow?.form_factor),
      outdoorModel,
      /* the outdoor is SHARED when more than one room hangs off it — that is
         what makes a multi read as three heads rather than one unit doing
         three rooms */
      sharedOutdoor: mine.length > 1,
      pipeLiquidMm: oduRow?.conn_liquid_mm ?? null,
      pipeGasMm: oduRow?.conn_gas_mm ?? null,
      refrigerant: oduRow?.refrigerant ?? null,
      prechargedKg: oduRow?.precharged_kg ?? null,
      totalPipeM: totalPipeLengthM(
        buildSystemGraph(doc.objects, doc.floors, sys.id)
      ),
      rooms: mine.map(strip),
      loadKw: load == null ? null : Math.round(load * 10) / 10,
      capacityKw: cap == null ? null : Math.round(cap * 10) / 10,
      pct,
      status: load == null ? "unknown" : pct != null && pct >= 100 ? "covered" : "under",
      components: systemComponents(doc, pack, sys, basis)
        .filter((c) => c.kind === "choice")
        .map((c) => ({
          role: c.role,
          name: c.name,
          sub: c.sub ?? "",
          value: c.value ?? "",
        })),
    };
  });

  return {
    systems,
    unserved: [...rows.values()]
      .filter((r) => r.systemIds.length === 0)
      .map(strip),
  };
}
