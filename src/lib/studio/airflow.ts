/* Design Studio — the air a ducted unit sends, room by room (Isaac,
   2026-10-28: "start working at the duct runs, BTOs, grilles, filters").

   A ducted or bulkhead unit serves rooms in one of two ways: on the band,
   every zone of its system; or given a group of the system's rooms
   (allocations.ts alsoServes). Either way each room gets its load's share of
   the unit's airflow — proportional dampers, the same share coverage.ts gives
   it of the unit's capacity — and from that share:

   - its outlets: as many as the largest neck carries the share in, each the
     smallest neck that carries its part at the supply velocity;
   - the unit's return: its whole airflow at the return velocity, no run over
     the largest return size, so a big unit takes two; the grille the
     smallest whose face takes it at the face velocity, with a filter.

   Sizes are by the round duct's own area. The packs hold no grille or flex
   tables (schema §8/§9 are empty), so every figure here is the velocity
   rule, the same for every business. Pure — no React. */

import type { DesignDocument, DesignSystem } from "./document";
import type { DataPack, IndoorUnit } from "./packs/schema";
import { allocationsOf, hasAllocations, roomsServed, type Allocation } from "./allocations";
import { loadShare } from "./coverage";
import { roomLoadKw, type RoomObj } from "./loads-room";
import { zoneIdsOf } from "./zones";
import { DUCT_AIRWAY_FORMS } from "./form-factors";

/** air speed at a supply outlet's neck and in a supply run, m/s */
export const SUPPLY_MS = 3.0;
/** air speed in a return run, m/s */
export const RETURN_MS = 2.5;
/** air speed across a return grille's face, m/s */
export const RETURN_FACE_MS = 2.0;

/** the round sizes flexible duct comes in, mm */
export const DUCT_SIZES_MM = [150, 200, 250, 300, 350, 400, 450, 500] as const;
/** the largest neck an outlet is given; more air takes another outlet */
export const OUTLET_MAX_MM = 250;
/** the largest return run; more air takes another run */
export const RETURN_MAX_MM = 400;
/** return grille faces, W × H mm, smallest first */
export const RETURN_GRILLES_MM: readonly (readonly [number, number])[] = [
  [300, 300],
  [400, 400],
  [600, 400],
  [750, 400],
  [900, 400],
  [750, 550],
  [900, 600],
  [1200, 600],
];

/** what a round duct of this size carries at this speed, L/s */
export function ductCapacityLs(diaMm: number, ms: number): number {
  const r = diaMm / 2000;
  return Math.PI * r * r * ms * 1000;
}

/** the smallest size that carries this airflow at this speed, or null when
    none up to `maxMm` does */
export function sizeForLs(ls: number, ms: number, maxMm: number = DUCT_SIZES_MM[DUCT_SIZES_MM.length - 1]): number | null {
  for (const d of DUCT_SIZES_MM) {
    if (d > maxMm) break;
    if (ductCapacityLs(d, ms) >= ls - 1e-9) return d;
  }
  return null;
}

/** n runs of one size that carry this airflow, none over `maxMm` */
export function splitForLs(ls: number, ms: number, maxMm: number): { count: number; diaMm: number; lsEach: number } {
  if (ls <= 0) return { count: 0, diaMm: DUCT_SIZES_MM[0], lsEach: 0 };
  const count = Math.max(1, Math.ceil(ls / ductCapacityLs(maxMm, ms) - 1e-9));
  const lsEach = ls / count;
  return { count, diaMm: sizeForLs(lsEach, ms, maxMm) ?? maxMm, lsEach };
}

export interface RoomAir {
  roomId: string;
  name: string;
  loadKw: number | null;
  /** its share of the unit's airflow, L/s */
  ls: number;
  outlets: { count: number; neckMm: number; lsEach: number };
}

export interface UnitAir {
  unit: Allocation;
  model: string;
  /** the unit's airflow, L/s, from its data pack */
  ls: number;
  rooms: RoomAir[];
  ret: {
    runs: number;
    diaMm: number;
    grille: { wMm: number; hMm: number };
    /** a filter in the return grille: on unless the person says the unit's
        own filter does it */
    filter: boolean;
  };
}

const iduRow = (pack: DataPack, model: string): IndoorUnit | undefined =>
  pack.indoor_units.find((u) => u.model === model);

/** does this unit send air down ducts? a ducted or bulkhead form */
export function isAirUnit(pack: DataPack, a: Allocation): boolean {
  if (a.role !== "idu" || !a.model) return false;
  const row = iduRow(pack, a.model);
  return row != null && DUCT_AIRWAY_FORMS.includes(row.form_factor);
}

/** whether the Studio draws this unit's ductwork. The person says, by unit
    (`settings.ducts`); until they do, no unit has any, ducted or bulkhead: a
    unit dropped on the plan is the unit alone (Isaac, 28 October 2026: "just
    the unit, no duct or grilles, nothing … i add them in if i neeed to"). A
    unit with none sends no air down ducts: no outlets, runs, return or duct
    materials. */
export function ductsDrawn(sys: DesignSystem, unitId: string): boolean {
  const set = sys.settings.ducts;
  const said = set && typeof set === "object" && !Array.isArray(set) ? (set as Record<string, unknown>)[unitId] : undefined;
  return said === true;
}

/** the person's say on a unit's ductwork: drawn, or none */
export function setDuctsDrawn(doc: DesignDocument, systemId: string, unitId: string, on: boolean): DesignDocument {
  return {
    ...doc,
    systems: doc.systems.map((s) => {
      if (s.id !== systemId) return s;
      const cur = s.settings.ducts;
      const prev = cur && typeof cur === "object" && !Array.isArray(cur) ? (cur as Record<string, boolean>) : {};
      return { ...s, settings: { ...s.settings, ducts: { ...prev, [unitId]: on } } };
    }),
  };
}

/** the return grille that takes this airflow across its face */
export function returnGrilleFor(ls: number): { wMm: number; hMm: number } {
  const need = ls / 1000 / RETURN_FACE_MS;
  const fit = RETURN_GRILLES_MM.find(([w, h]) => (w / 1000) * (h / 1000) >= need - 1e-9);
  const [wMm, hMm] = fit ?? RETURN_GRILLES_MM[RETURN_GRILLES_MM.length - 1];
  return { wMm, hMm };
}

/** the air one unit sends, room by room, and its return; null for a unit
    that sends none (a wall head, a cassette) or whose pack gives no airflow */
export function unitAir(doc: DesignDocument, pack: DataPack, sys: DesignSystem, unit: Allocation): UnitAir | null {
  if (!isAirUnit(pack, unit)) return null;
  const row = iduRow(pack, unit.model)!;
  if (!ductsDrawn(sys, unit.id)) return null;
  const ls = row.airflow_ls;
  if (ls == null || ls <= 0) return null;
  const ids = unit.serves === "system" ? zoneIdsOf(sys) : roomsServed(unit);
  const rooms: RoomAir[] = [];
  for (const id of ids) {
    const room = doc.objects.find((o) => o.id === id && o.type === "room");
    if (!room) continue;
    const share = loadShare(doc, ids, id) ?? 0;
    const roomLs = ls * share;
    const out = splitForLs(roomLs, SUPPLY_MS, OUTLET_MAX_MM);
    rooms.push({
      roomId: id,
      name: String(room.props.name ?? "Zone"),
      loadKw: roomLoadOf(doc, id),
      ls: roomLs,
      outlets: { count: out.count, neckMm: out.diaMm, lsEach: out.lsEach },
    });
  }
  const back = splitForLs(ls, RETURN_MS, RETURN_MAX_MM);
  const settings = sys.settings.returnFilter;
  const filterOff =
    settings && typeof settings === "object" && !Array.isArray(settings) && (settings as Record<string, unknown>)[unit.id] === false;
  return {
    unit,
    model: unit.model,
    ls,
    rooms,
    ret: { runs: back.count, diaMm: back.diaMm, grille: returnGrilleFor(ls), filter: !filterOff },
  };
}

/** every unit on a system that sends air, with its rooms */
export function systemAir(doc: DesignDocument, pack: DataPack, sys: DesignSystem): UnitAir[] {
  if (!hasAllocations(sys)) return [];
  return allocationsOf(sys)
    .map((a) => unitAir(doc, pack, sys, a))
    .filter((x): x is UnitAir => x != null);
}

/** the air a room gets, from whichever unit on its system sends it */
export function roomAir(doc: DesignDocument, pack: DataPack, sys: DesignSystem, roomId: string): RoomAir | null {
  for (const u of systemAir(doc, pack, sys)) {
    const r = u.rooms.find((x) => x.roomId === roomId);
    if (r) return r;
  }
  return null;
}

/** "2 outlets, Ø250": a room's outlets the way the rail says them */
export function outletsText(r: RoomAir): string {
  return `${r.outlets.count} ${r.outlets.count === 1 ? "outlet" : "outlets"}, Ø${r.outlets.neckMm}`;
}

function roomLoadOf(doc: DesignDocument, id: string): number | null {
  const room = doc.objects.find((o) => o.id === id);
  if (!room || room.type !== "room" || room.geometry.kind !== "polygon") return null;
  return roomLoadKw(doc, room as RoomObj);
}
