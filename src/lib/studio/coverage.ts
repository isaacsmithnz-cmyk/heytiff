import type { DesignDocument, DesignObject, DesignSystem } from "./document";
import type { DataPack } from "./packs/schema";
import { roomLoadKw, type RoomObj } from "./loads-room";
import { sizingCapacityKw, type SizingBasis } from "./loads";
import { pointInPolygon } from "./geometry";
import { moduleFor } from "./modules";
import { allocationsOf, hasAllocations } from "./allocations";
import { zoneIdsOf } from "./zones";

/* Room coverage (plan step: units → spaces) — pure derivations only.
   Attribution model:
   - a placed IDU carries `props.roomId` (stamped geometrically on drop/move,
     manual override sets `props.roomLock`); the stamp is the source of truth.
   - a system SERVES the rooms it drew plus any it adopted into
     `settings.roomIds` (adoption happens via the picker or automatically when
     its unit is dropped inside another system's room).
   Coverage of a room = Σ sizing capacity of every PLACED IDU stamped to it,
   across ALL systems (the user's call: placed-only counts; a chosen-but-
   unplaced pair shows as pending).
   A system built in the system builder is different: its ALLOCATIONS are the
   units it has, placed or not (allocations.ts). The builder decides the room,
   so an allocated unit covers its room before it is on the plan, and a placed
   one is never counted twice.
   What a placed IDU is WORTH depends on the owning module's unit flow:
   pair/ducted systems rate the IDU via their pair table (systemPairKw);
   per-room systems (multi / VRF) rate each IDU at its own catalogue
   capacity — there is no 1:1 pair row to read.

   ONE CAP, and only one. A multi connected past its outdoor is normal: heads
   are sized to their rooms and the rooms rarely all run at full load together,
   so rooms are never capped against EACH OTHER. What can't work is one room
   whose own heads, which always run together, need more than the outdoor can
   supply — two 7.1 kW heads for a 14 kW living room on an 8.0 kW MXZ-4F80.
   So per system, the heads in a room are capped at that system's outdoor;
   then the systems are summed (a room on two outdoors gets both). */

export interface CoverageContributor {
  systemId: string;
  systemName: string;
  colour: string;
  unitId: string;
  model: string;
  kw: number;
}

export type CoverageStatus = "covered" | "under" | "unknown";

/** a system whose heads in this room need more than its outdoor supplies */
export interface CoverageCap {
  systemId: string;
  /** Σ the system's head ratings attributed to this room */
  headsKw: number;
  /** what the system's outdoor supplies — the room gets this much from it */
  oduKw: number;
}

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
  /** contributors carry their RATINGS; coveredKw is the capped sum */
  contributors: CoverageContributor[];
  /** systems whose heads here outrun their outdoor (empty almost always) */
  capped: CoverageCap[];
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

/** A split's ranking lens and fallback attribution: the room its pair was
    chosen for, else the first room it serves. A drop INSIDE a room always
    wins by containment; a drop outside every room (the hallway-bulkhead
    case) attributes here instead of nowhere. Null for other module types —
    their lens rules arrive with their modules. */
export function lensRoom(doc: DesignDocument, systemId: string | null): RoomObj | null {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys || sys.type !== "split") return null;
  const rooms = roomsServedBy(doc, systemId);
  return rooms.find((r) => r.id === String(sys.settings.roomId ?? "")) ?? rooms[0] ?? null;
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

/** what one placed IDU is worth: its own catalogue capacity on per-room
    modules (multi / VRF), its system's pair rating everywhere else */
/** the part of a whole-system unit this zone gets: its load over the loads
    of every zone the system claims, or an even split while loads are
    unknown; null when the zone is not the system's */
function wholeSystemShare(doc: DesignDocument, sys: DesignSystem, roomId: string): number | null {
  const ids = zoneIdsOf(sys);
  if (!ids.includes(roomId)) return null;
  const zones = ids
    .map((id) => doc.objects.find((o) => o.id === id))
    .filter((o): o is RoomObj => o != null && o.type === "room" && o.geometry.kind === "polygon");
  if (!zones.length) return null;
  const loads = zones.map((z) => roomLoadKw(doc, z));
  const total = loads.reduce<number>((a, l) => a + (l ?? 0), 0);
  const mine = loads[zones.findIndex((z) => z.id === roomId)] ?? null;
  if (total > 0 && mine != null) return mine / total;
  return 1 / zones.length;
}

function placedIduKw(
  doc: DesignDocument,
  pack: DataPack,
  sys: DesignSystem,
  iduModel: string,
  basis: SizingBasis
): number | null {
  if (moduleFor(sys.type).unitFlow === "per-room") {
    const idu = pack.indoor_units.find((u) => u.model === iduModel);
    return idu ? sizingCapacityKw(idu, basis) : null;
  }
  return systemPairKw(doc, pack, sys.id, basis);
}

/** what a per-room system's outdoor supplies — the placed outdoor wins, else
    the chosen one; null for pair systems (their rating IS the pairing) and
    while no outdoor is chosen (ratings stand until there is one) */
export function systemOutdoorKw(
  doc: DesignDocument,
  pack: DataPack,
  sys: DesignSystem,
  basis: SizingBasis
): number | null {
  if (moduleFor(sys.type).unitFlow !== "per-room") return null;
  const placed = doc.objects.find(
    (o) => o.systemId === sys.id && o.type === "unit" && o.props.role === "odu"
  );
  const model = String(placed?.props.model ?? sys.settings.pairOdu ?? "");
  if (!model) return null;
  const odu = pack.outdoor_units.find((u) => u.model === model);
  return odu ? sizingCapacityKw(odu, basis) : null;
}

/** `settings.multiIdus` (roomId → indoor model) — same key multi.ts owns;
    read inline here so coverage never imports the multi engine (multi.ts
    imports roomsServedBy from this module) */
function multiIduFor(sys: DesignSystem, roomId: string): string {
  const v = sys.settings.multiIdus;
  if (!v || typeof v !== "object" || Array.isArray(v)) return "";
  const m = (v as Record<string, unknown>)[roomId];
  return typeof m === "string" ? m : "";
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
    for (const sys of doc.systems) {
      if (!hasAllocations(sys)) continue;
      for (const a of allocationsOf(sys)) {
        if (a.role !== "idu" || !a.model) continue;
        if (a.serves === "system") {
          /* a unit serving the whole system (a ducted unit on the band)
             gives each of its zones the share of its rating that the zone's
             load is of all its zones' loads — proportional dampers — so every
             zone reads the same percentage; with no loads, an even share */
          const share = wholeSystemShare(doc, sys, room.id);
          if (share == null) continue;
          const kw = (placedIduKw(doc, pack, sys, a.model, basis) ?? 0) * share;
          contributors.push({
            systemId: sys.id,
            systemName: sys.name,
            colour: sys.colour,
            unitId: a.id,
            model: a.model,
            kw,
          });
          continue;
        }
        if (a.roomId !== room.id) continue;
        const kw = placedIduKw(doc, pack, sys, a.model, basis) ?? 0;
        contributors.push({
          systemId: sys.id,
          systemName: sys.name,
          colour: sys.colour,
          unitId: a.id,
          model: a.model,
          kw,
        });
      }
    }
    for (const o of doc.objects) {
      if (o.type !== "unit" || o.props.role !== "idu") continue;
      if (o.props.roomId !== room.id) continue;
      const sys = doc.systems.find((s) => s.id === o.systemId);
      if (!sys || hasAllocations(sys)) continue;
      const kw = placedIduKw(doc, pack, sys, String(o.props.model ?? ""), basis) ?? 0;
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
  /* per system: its heads here, capped at its outdoor; then summed */
  const bySystem = new Map<string, number>();
  for (const c of contributors) bySystem.set(c.systemId, (bySystem.get(c.systemId) ?? 0) + c.kw);
  const capped: CoverageCap[] = [];
  let coveredKw = 0;
  const oduKwOf = new Map<string, number | null>();
  const outdoorOf = (sys: DesignSystem): number | null => {
    if (!pack) return null;
    if (!oduKwOf.has(sys.id)) oduKwOf.set(sys.id, systemOutdoorKw(doc, pack, sys, basis));
    return oduKwOf.get(sys.id) ?? null;
  };
  for (const [systemId, headsKw] of bySystem) {
    const sys = doc.systems.find((s) => s.id === systemId);
    const oduKw = sys ? outdoorOf(sys) : null;
    if (oduKw != null && headsKw > oduKw + 1e-9) {
      capped.push({ systemId, headsKw, oduKw });
      coveredKw += oduKw;
    } else {
      coveredKw += headsKw;
    }
  }

  /* pending: a chosen-but-unplaced unit sized against this room — drawn on
     the bar as a hollow segment. Split keys off settings.roomId + pairIdu;
     per-room modules key off their settings.multiIdus entry for THIS room. */
  let pendingKw = 0;
  if (pack) {
    for (const sys of doc.systems) {
      if (hasAllocations(sys)) continue; // allocated units already cover
      if (moduleFor(sys.type).unitFlow === "per-room") {
        const model = multiIduFor(sys, room.id);
        if (!model) continue;
        const placedHere = doc.objects.some(
          (o) =>
            o.systemId === sys.id &&
            o.type === "unit" &&
            o.props.role === "idu" &&
            o.props.roomId === room.id
        );
        if (placedHere) continue;
        const idu = pack.indoor_units.find((u) => u.model === model);
        if (!idu) continue;
        const oduKw = outdoorOf(sys);
        const kw = sizingCapacityKw(idu, basis);
        pendingKw += oduKw != null ? Math.min(kw, oduKw) : kw;
        continue;
      }
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

  return {
    roomId: room.id,
    loadKw,
    coveredKw,
    pendingKw,
    pct,
    status,
    oversized,
    contributors,
    capped,
  };
}

/* ── one system over the rooms it covers ──
   The figure the panel's ring and the design sheet both read, so the two can
   never disagree. A room that two systems cover (two splits doing one big
   living room) is carried by both: each gets the part of the room's load in
   proportion to what it gives the room, so the room's load is counted once
   across the job and each system reads as the room does. */

export interface SystemRoomShare {
  room: RoomObj;
  /** the part of the room's load this system carries: all of it when it covers
      the room alone; null when the room has no load */
  loadKw: number | null;
  /** what this system gives the room: its heads' ratings, capped at its outdoor */
  coverKw: number;
  /** this system's units in the room */
  contributors: CoverageContributor[];
}

export interface SystemCover {
  /** the rooms this system has a unit in */
  rooms: SystemRoomShare[];
  /** Σ the rooms' shares; null while none of them has a load */
  loadKw: number | null;
  coverKw: number;
  /** cover against load; null when the load is unknown */
  pct: number | null;
}

export function systemCover(
  doc: DesignDocument,
  pack: DataPack | null,
  sys: DesignSystem,
  basis: SizingBasis
): SystemCover {
  const rooms: SystemRoomShare[] = [];
  for (const o of doc.objects) {
    if (!isRoom(o)) continue;
    const cov = roomCoverage(doc, pack, o, basis);
    const mine = cov.contributors.filter((c) => c.systemId === sys.id);
    if (mine.length === 0) continue;
    const cap = cov.capped.find((c) => c.systemId === sys.id);
    const coverKw = cap ? cap.oduKw : mine.reduce((a, c) => a + c.kw, 0);
    const systemsHere = new Set(cov.contributors.map((c) => c.systemId)).size;
    const loadKw =
      cov.loadKw == null
        ? null
        : cov.coveredKw > 0
          ? cov.loadKw * (coverKw / cov.coveredKw)
          : cov.loadKw / systemsHere;
    rooms.push({ room: o, loadKw, coverKw, contributors: mine });
  }
  const loads = rooms.filter((r) => r.loadKw != null);
  const loadKw = loads.length ? loads.reduce((a, r) => a + (r.loadKw ?? 0), 0) : null;
  const coverKw = rooms.reduce((a, r) => a + r.coverKw, 0);
  const pct = loadKw != null && loadKw > 0 ? Math.round((coverKw / loadKw) * 100) : null;
  return { rooms, loadKw, coverKw, pct };
}
