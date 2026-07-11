import type { DesignDocument, DesignObject } from "./document";
import type { DataPack } from "./packs/schema";
import { roomLoadKw, type RoomObj } from "./loads-room";
import { sizingCapacityKw, type SizingBasis } from "./loads";
import { pointInPolygon } from "./geometry";

/* Room coverage (plan step: units → spaces) — pure derivations only.
   Attribution model:
   - a placed IDU carries `props.roomId` (stamped geometrically on drop/move,
     manual override sets `props.roomLock`); the stamp is the source of truth.
   - a system SERVES the rooms it drew plus any it adopted into
     `settings.roomIds` (adoption happens via the picker or automatically when
     its unit is dropped inside another system's room).
   Coverage of a room = Σ sizing capacity of every PLACED IDU stamped to it,
   across ALL systems (the user's call: placed-only counts; a chosen-but-
   unplaced pair shows as pending). */

export interface CoverageContributor {
  systemId: string;
  systemName: string;
  colour: string;
  unitId: string;
  model: string;
  kw: number;
}

export type CoverageStatus = "covered" | "under" | "unknown";

export interface RoomCoverage {
  roomId: string;
  /** null when the floor is uncalibrated (no area → no load) */
  loadKw: number | null;
  /** placed, attributed capacity */
  coveredKw: number;
  /** chosen-but-unplaced pair capacity of systems sized against this room */
  pendingKw: number;
  /** covered/load in percent, null when load is unknown */
  pct: number | null;
  status: CoverageStatus;
  /** covered beyond the browser's 150% oversize cap */
  oversized: boolean;
  contributors: CoverageContributor[];
}

const isRoom = (o: DesignObject): o is RoomObj =>
  o.type === "room" && o.geometry.kind === "polygon";

/** the room (any system) on a floor containing a point — used to stamp a
    dropped/moved unit's `props.roomId`; topmost (last-drawn) wins */
export function roomAtPoint(
  objects: DesignObject[],
  floorId: string,
  at: { x: number; y: number }
): RoomObj | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (!isRoom(o) || o.floorId !== floorId) continue;
    if (pointInPolygon(at, o.geometry.points)) return o;
  }
  return null;
}

/** rooms a system serves: drawn under it ∪ adopted via settings.roomIds */
export function roomsServedBy(doc: DesignDocument, systemId: string | null): RoomObj[] {
  if (!systemId) return [];
  const sys = doc.systems.find((s) => s.id === systemId);
  const adopted = new Set(
    Array.isArray(sys?.settings.roomIds) ? (sys!.settings.roomIds as string[]) : []
  );
  return doc.objects.filter(
    (o): o is RoomObj => isRoom(o) && (o.systemId === systemId || adopted.has(o.id))
  );
}

/** the sizing capacity of a system's pairing, from its placed units or its
    chosen pair; null when the pack has no row for it */
export function systemPairKw(
  doc: DesignDocument,
  pack: DataPack,
  systemId: string,
  basis: SizingBasis
): number | null {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return null;
  const mine = doc.objects.filter((o) => o.systemId === systemId && o.type === "unit");
  const idu = String(
    mine.find((o) => o.props.role === "idu")?.props.model ?? sys.settings.pairIdu ?? ""
  );
  const odu = String(
    mine.find((o) => o.props.role === "odu")?.props.model ?? sys.settings.pairOdu ?? ""
  );
  if (!idu || !odu) return null;
  const row = pack.pair_tables.find((p) => p.idu_model === idu && p.odu_model === odu);
  if (!row) return null;
  return sizingCapacityKw(
    { capacity_cool_kw: row.rated_cool_kw ?? 0, capacity_heat_kw: row.rated_heat_kw ?? 0 },
    basis
  );
}

/** full coverage picture for one room (see module header for the model) */
export function roomCoverage(
  doc: DesignDocument,
  pack: DataPack | null,
  room: RoomObj,
  basis: SizingBasis
): RoomCoverage {
  const loadKw = roomLoadKw(doc, room);

  const contributors: CoverageContributor[] = [];
  if (pack) {
    for (const o of doc.objects) {
      if (o.type !== "unit" || o.props.role !== "idu") continue;
      if (o.props.roomId !== room.id) continue;
      const sys = doc.systems.find((s) => s.id === o.systemId);
      if (!sys) continue;
      const kw = systemPairKw(doc, pack, sys.id, basis) ?? 0;
      contributors.push({
        systemId: sys.id,
        systemName: sys.name,
        colour: sys.colour,
        unitId: o.id,
        model: String(o.props.model ?? ""),
        kw,
      });
    }
  }
  const coveredKw = contributors.reduce((a, c) => a + c.kw, 0);

  /* pending: systems sized against this room (settings.roomId) with a chosen
     pair but no placed IDU yet — drawn on the bar as a hollow segment */
  let pendingKw = 0;
  if (pack) {
    for (const sys of doc.systems) {
      if (sys.settings.roomId !== room.id || !sys.settings.pairIdu) continue;
      const hasPlacedIdu = doc.objects.some(
        (o) => o.systemId === sys.id && o.type === "unit" && o.props.role === "idu"
      );
      if (hasPlacedIdu) continue;
      pendingKw += systemPairKw(doc, pack, sys.id, basis) ?? 0;
    }
  }

  const pct = loadKw != null && loadKw > 0 ? Math.round((coveredKw / loadKw) * 100) : null;
  const status: CoverageStatus =
    loadKw == null ? "unknown" : pct != null && pct >= 100 ? "covered" : "under";
  const oversized = pct != null && pct > 150;

  return { roomId: room.id, loadKw, coveredKw, pendingKw, pct, status, oversized, contributors };
}
