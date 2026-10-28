/* Design Studio — the ductwork the Studio lays out for a ducted unit (Isaac,
   2026-10-28, A on the mock: "the Studio draws them for you once the outlets
   are in their rooms, joining neighbours with a BTO, and you drag to
   change").

   From the air each room gets (airflow.ts) and where the unit sits on the
   plan:

   - OUTLETS: each room's, spread along its longer side through its middle,
     unless the person has dragged one (`settings.ductAt`, by key);
   - TRUNKS: two outlets share one run off the plenum when their air together
     fits the largest trunk and they lie the same way from the unit: two in
     one room on a Y, two rooms on a BTO, the rest on runs of their own;
   - SPIGOTS: one a trunk, spread across the supply face in the order their
     trunks leave it, so no two cross at the plenum;
   - THE RETURN: its grille out from the return face, unless dragged, and
     its runs back to the face;
   - LENGTHS: every run measured along what is drawn, in metres.

   Nothing here is stored but the dragged positions: move the unit, an
   outlet or the return and the runs follow. Pure — no React. */

import type { DesignDocument, DesignObject, DesignSystem, Point } from "./document";
import type { DataPack } from "./packs/schema";
import { systemAir, ductCapacityLs, sizeForLs, SUPPLY_MS, type UnitAir } from "./airflow";
import type { RoomObj } from "./loads-room";

/** the largest supply trunk two outlets may share, mm */
export const TRUNK_MAX_MM = 300;
/** how far apart, by direction from the unit, two outlets may be and still
    share a trunk, degrees */
export const TRUNK_SPREAD_DEG = 50;
/** a supply plenum's depth off the unit's face, mm (ducted.ts 200–300) */
const PLENUM_MM = 250;
/** the straight leg a run leaves its spigot on before it turns, mm */
const LEG_MM = 500;
/** where the return grille goes, out from the return face, unless dragged */
const RETURN_OUT_MM = 1500;

export type DuctStream = "supply" | "return";

export interface DuctOutlet {
  /** `${unitId}/${roomId}/${i}`: what a drag is stored under */
  key: string;
  roomId: string;
  at: Point;
  neckMm: number;
  ls: number;
}

export interface DuctRun {
  key: string;
  stream: DuctStream;
  diaMm: number;
  ls: number;
  points: Point[];
  lengthM: number;
}

export interface DuctFitting {
  key: string;
  kind: "y" | "bto";
  at: Point;
  /** the trade's name, in inches: "BTO 12-10-8", "Y 12-10-10" */
  name: string;
  inMm: number;
  outMm: [number, number];
}

export interface DuctLayout {
  unitId: string;
  model: string;
  floorId: string;
  outlets: DuctOutlet[];
  ret: { key: string; at: Point; wMm: number; hMm: number; filter: boolean; diaMm: number; runs: number };
  spigots: { at: Point; diaMm: number }[];
  /** the supply plenum's outline: the unit's face, widening to its front */
  plenum: Point[];
  supply: DuctRun[];
  returns: DuctRun[];
  fittings: DuctFitting[];
  /** rooms the unit serves that are on another floor: counted, not drawn */
  offFloor: string[];
}

/* ── geometry ── */
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: Point, b: Point, t: number): Point => add(a, mul(sub(b, a), t));

/** a polyline's length in metres, at this floor's scale */
export function polylineM(points: readonly Point[], mmPerUnit: number): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += dist(points[i - 1], points[i]);
  return (n * mmPerUnit) / 1000;
}

/** a size the way the trade says it on a fitting: 300 mm is 12 inches */
export const inches = (mm: number): number => Math.round(mm / 25);

/** a unit's air face in world units: its middle, the way out of it, the way
    along it and half its width. Air goes through the depth (ducted spec
    §1a): supply on the +y face, the other way when `airFlip`, both turned by
    the unit's rotation — as the canvas's endFace has it */
export function unitFace(
  u: DesignObject,
  end: DuctStream,
  mmPerUnit: number
): { mid: Point; out: Point; ax: Point; halfW: number } | null {
  if (u.geometry.kind !== "point") return null;
  const at = u.geometry.at;
  const w = Number(u.props.widthMm ?? 800) / mmPerUnit;
  const h = Number(u.props.depthMm ?? 300) / mmPerUnit;
  const dir = (end === "supply" ? 1 : -1) * (u.props.airFlip === true ? -1 : 1);
  const deg = (u.geometry as { rotation?: number }).rotation ?? 0;
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const out = { x: -dir * s, y: dir * c };
  return { mid: add(at, mul(out, h / 2)), out, ax: { x: c, y: s }, halfW: w / 2 };
}

/** where a room's outlets go by default: spread along its longer side,
    through its middle */
export function outletSpots(room: RoomObj, count: number): Point[] {
  if (room.geometry.kind !== "polygon" || count <= 0) return [];
  const pts = room.geometry.points;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const wide = maxX - minX >= maxY - minY;
  return Array.from({ length: count }, (_, i) => {
    const t = (i + 1) / (count + 1);
    return wide ? { x: minX + (maxX - minX) * t, y: cy } : { x: cx, y: minY + (maxY - minY) * t };
  });
}

/** the positions the person dragged, by key */
export function draggedAt(sys: DesignSystem): Record<string, Point> {
  const v = sys.settings.ductAt;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, Point> = {};
  for (const [k, p] of Object.entries(v as Record<string, unknown>)) {
    if (p && typeof p === "object" && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y)) {
      out[k] = { x: (p as Point).x, y: (p as Point).y };
    }
  }
  return out;
}

/** the system with one outlet or return grille dragged to a new spot */
export function dragDuctEnd(doc: DesignDocument, systemId: string, key: string, at: Point): DesignDocument {
  return {
    ...doc,
    systems: doc.systems.map((s) =>
      s.id === systemId ? { ...s, settings: { ...s.settings, ductAt: { ...draggedAt(s), [key]: at } } } : s
    ),
  };
}

/** the angle of a point seen from the unit's supply face, against the way
    out of it, degrees */
function bearing(face: { mid: Point; out: Point }, p: Point): number {
  const v = sub(p, face.mid);
  const a = Math.atan2(v.y, v.x) - Math.atan2(face.out.y, face.out.x);
  return ((((a * 180) / Math.PI + 540) % 360) - 180);
}

/** the ductwork for one ducted unit on its floor; null until the unit is on
    a calibrated plan */
export function unitDuctLayout(doc: DesignDocument, sys: DesignSystem, air: UnitAir): DuctLayout | null {
  const unitObj = doc.objects.find((o) => o.id === air.unit.id);
  if (!unitObj || unitObj.geometry.kind !== "point") return null;
  const floor = doc.floors.find((f) => f.id === unitObj.floorId);
  const s = floor?.scaleMmPerUnit;
  if (!floor || !s) return null;
  const supplyFace = unitFace(unitObj, "supply", s);
  const returnFace = unitFace(unitObj, "return", s);
  if (!supplyFace || !returnFace) return null;
  const moved = draggedAt(sys);
  const mm = (v: number) => v / s;

  /* the outlets, room by room */
  const outlets: DuctOutlet[] = [];
  const offFloor: string[] = [];
  for (const r of air.rooms) {
    const room = doc.objects.find((o) => o.id === r.roomId) as RoomObj | undefined;
    if (!room || room.floorId !== unitObj.floorId) {
      offFloor.push(r.roomId);
      continue;
    }
    const spots = outletSpots(room, r.outlets.count);
    spots.forEach((p, i) => {
      const key = `${air.unit.id}/${r.roomId}/${i}`;
      outlets.push({ key, roomId: r.roomId, at: moved[key] ?? p, neckMm: r.outlets.neckMm, ls: r.outlets.lsEach });
    });
  }

  /* the trunks: two outlets in one room first (a Y), then neighbours by
     direction from the unit (a BTO), each pair only while their air fits */
  const trunkCap = ductCapacityLs(TRUNK_MAX_MM, SUPPLY_MS);
  const angle = new Map(outlets.map((o) => [o.key, bearing(supplyFace, o.at)]));
  const taken = new Set<string>();
  const trunks: DuctOutlet[][] = [];
  const pairs = (sameRoom: boolean) => {
    const free = outlets.filter((o) => !taken.has(o.key)).sort((a, b) => angle.get(a.key)! - angle.get(b.key)!);
    for (let i = 0; i < free.length - 1; i++) {
      const a = free[i];
      if (taken.has(a.key)) continue;
      for (let j = i + 1; j < free.length; j++) {
        const b = free[j];
        if (taken.has(b.key)) continue;
        if ((a.roomId === b.roomId) !== sameRoom) continue;
        if (a.ls + b.ls > trunkCap + 1e-9) continue;
        if (Math.abs(angle.get(a.key)! - angle.get(b.key)!) > TRUNK_SPREAD_DEG) continue;
        trunks.push([a, b]);
        taken.add(a.key);
        taken.add(b.key);
        break;
      }
    }
  };
  pairs(true);
  pairs(false);
  for (const o of outlets) if (!taken.has(o.key)) trunks.push([o]);

  /* the spigots, across the supply face in the order the trunks leave it */
  const along = (t: DuctOutlet[]) => {
    const target = t.length === 1 ? t[0].at : lerp(t[0].at, t[1].at, 0.5);
    const v = sub(target, supplyFace.mid);
    return v.x * supplyFace.ax.x + v.y * supplyFace.ax.y;
  };
  trunks.sort((a, b) => along(a) - along(b));
  const plenumFront = add(supplyFace.mid, mul(supplyFace.out, mm(PLENUM_MM)));
  const flare = supplyFace.halfW + mm(PLENUM_MM) * 0.3;
  const plenum = [
    add(supplyFace.mid, mul(supplyFace.ax, -supplyFace.halfW)),
    add(supplyFace.mid, mul(supplyFace.ax, supplyFace.halfW)),
    add(plenumFront, mul(supplyFace.ax, flare)),
    add(plenumFront, mul(supplyFace.ax, -flare)),
  ];
  const supply: DuctRun[] = [];
  const fittings: DuctFitting[] = [];
  const spigots: { at: Point; diaMm: number }[] = [];
  trunks.forEach((t, i) => {
    const offset = ((i + 1) / (trunks.length + 1) - 0.5) * 2 * supplyFace.halfW;
    const spigot = add(plenumFront, mul(supplyFace.ax, offset));
    const leg = add(spigot, mul(supplyFace.out, mm(LEG_MM)));
    const ls = t.reduce((n, o) => n + o.ls, 0);
    if (t.length === 1) {
      const o = t[0];
      const points = [spigot, leg, o.at];
      spigots.push({ at: spigot, diaMm: o.neckMm });
      supply.push({ key: `run:${o.key}`, stream: "supply", diaMm: o.neckMm, ls: o.ls, points, lengthM: polylineM(points, s) });
      return;
    }
    const dia = sizeForLs(ls, SUPPLY_MS, TRUNK_MAX_MM) ?? TRUNK_MAX_MM;
    spigots.push({ at: spigot, diaMm: dia });
    const meet = lerp(t[0].at, t[1].at, 0.5);
    const at = lerp(leg, meet, 0.6);
    const trunkPts = [spigot, leg, at];
    const key = `fit:${t[0].key}+${t[1].key}`;
    supply.push({ key: `trunk:${key}`, stream: "supply", diaMm: dia, ls, points: trunkPts, lengthM: polylineM(trunkPts, s) });
    for (const o of t) {
      const pts = [at, o.at];
      supply.push({ key: `run:${o.key}`, stream: "supply", diaMm: o.neckMm, ls: o.ls, points: pts, lengthM: polylineM(pts, s) });
    }
    const outs = [t[0].neckMm, t[1].neckMm].sort((a, b) => b - a) as [number, number];
    const kind = t[0].roomId === t[1].roomId ? "y" : "bto";
    fittings.push({
      key,
      kind,
      at,
      inMm: dia,
      outMm: outs,
      name: `${kind === "y" ? "Y" : "BTO"} ${inches(dia)}-${inches(outs[0])}-${inches(outs[1])}`,
    });
  });

  /* the return: its grille out from the return face, its runs back to it */
  const retKey = `${air.unit.id}/return`;
  const grilleAt = moved[retKey] ?? add(returnFace.mid, mul(returnFace.out, mm(RETURN_OUT_MM)));
  const returns: DuctRun[] = [];
  for (let i = 0; i < air.ret.runs; i++) {
    const offset = ((i + 1) / (air.ret.runs + 1) - 0.5) * 2 * returnFace.halfW;
    const spigot = add(add(returnFace.mid, mul(returnFace.out, mm(150))), mul(returnFace.ax, offset));
    const leg = add(spigot, mul(returnFace.out, mm(LEG_MM)));
    const end = add(grilleAt, mul(returnFace.ax, ((i + 1) / (air.ret.runs + 1) - 0.5) * mm(air.ret.grille.wMm)));
    const points = [spigot, leg, end];
    returns.push({
      key: `return:${air.unit.id}/${i}`,
      stream: "return",
      diaMm: air.ret.diaMm,
      ls: air.ls / air.ret.runs,
      points,
      lengthM: polylineM(points, s),
    });
  }

  return {
    unitId: air.unit.id,
    model: air.model,
    floorId: unitObj.floorId,
    outlets,
    ret: {
      key: retKey,
      at: grilleAt,
      wMm: air.ret.grille.wMm,
      hMm: air.ret.grille.hMm,
      filter: air.ret.filter,
      diaMm: air.ret.diaMm,
      runs: air.ret.runs,
    },
    spigots,
    plenum,
    supply,
    returns,
    fittings,
    offFloor,
  };
}

/** the ductwork for every ducted unit on a system that is on the plan */
export function systemDuctwork(doc: DesignDocument, pack: DataPack, sys: DesignSystem): DuctLayout[] {
  return systemAir(doc, pack, sys)
    .map((air) => unitDuctLayout(doc, sys, air))
    .filter((l): l is DuctLayout => l != null);
}
