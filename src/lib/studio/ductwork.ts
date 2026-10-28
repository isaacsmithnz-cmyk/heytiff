/* Design Studio — the ductwork the Studio lays out for a ducted unit (Isaac,
   2026-10-28, A on the mock: "the Studio draws them for you once the outlets
   are in their rooms … and you drag to change"; then, on the redraw: option
   1's square routes at true width, and "anything that is a BTO or a Y … can
   just be a circle and ducts attached to that circle … the difference
   between a Y and a BTO is so small that it can be decided on the day").

   From the air each room gets (airflow.ts) and where the unit sits on the
   plan:

   - OUTLETS: each room's, spread along its longer side through its middle,
     unless the person has dragged one (`settings.ductAt`, by key);
   - THE PLENUM: a box on the supply face. A run leaves it through a collar
     on the face it heads for: the front for what is in front of the unit,
     an end for what is beside or behind it;
   - RUNS: square bends only. Two outlets share one run when their air
     together fits the largest trunk and they lie the same way from the
     unit; the run goes to the farther one and the nearer leaves it at a
     JUNCTION, a circle named by the ducts on it, biggest first ("Fitting
     12-10-8"), a Y or a BTO only once the person picks one
     (`settings.ductFitting`, by key);
   - THE RETURN: its grille straight under the unit's return face, on its
     box; dragged away, its runs go back to the face;
   - LENGTHS: every run measured along what is drawn, in metres.

   Nothing here is stored but the dragged positions and the picked fittings:
   move the unit, an outlet or the return and the runs follow. Pure — no
   React. */

import type { DesignDocument, DesignObject, DesignSystem, Point } from "./document";
import type { DataPack } from "./packs/schema";
import { systemAir, ductCapacityLs, sizeForLs, SUPPLY_MS, type UnitAir } from "./airflow";
import type { RoomObj } from "./loads-room";
import { outletPicks, outletSpec, setOutletPick, snapLength, type OutletSpec } from "./outlets";
import { zoningOf, zonesOf, type Zone } from "./zoning";

/** the largest supply trunk two outlets may share, mm */
export const TRUNK_MAX_MM = 300;
/** how far apart, by direction from the unit, two outlets may be and still
    share a trunk, degrees */
export const TRUNK_SPREAD_DEG = 50;
/** a supply plenum's depth off the unit's face, mm (ducted.ts 200–300) */
const PLENUM_MM = 250;
/** the straight a run leaves its collar on before it turns, mm */
const LEG_MM = 500;
/** how far apart two runs turning the same way turn, mm */
const STEP_MM = 450;
/** a junction keeps this far from a bend or a run's end, mm */
const CLEAR_MM = 300;
/** a zone damper sits this far down its run from where the run starts */
const DAMPER_IN_MM = 600;
/** a zone sensor sits this far in from its room's wall */
const SENSOR_IN_MM = 350;
/** the controller sits this far past the return grille */
const CONTROLLER_OUT_MM = 900;
/** a junction keeps this far from the outlet the run ends at, so the circle
    stands clear of the diffuser, mm */
const CLEAR_END_MM = 700;
/** how far to one side a run goes to meet two outlets in a line, mm */
const ASIDE_MM = 700;
/** the return grille's gap from the unit's return face, mm */
const RETURN_GAP_MM = 100;

export type DuctStream = "supply" | "return";
/** what a junction is made as, once the person says */
export type FittingKind = "y" | "bto";

export interface DuctOutlet extends OutletSpec {
  /** `${unitId}/${roomId}/${i}`: what a drag is stored under */
  key: string;
  roomId: string;
  /** its middle: where the run meets it */
  at: Point;
  ls: number;
}

export interface DuctRun {
  key: string;
  stream: DuctStream;
  diaMm: number;
  ls: number;
  /** square bends: every leg runs along or across the unit */
  points: Point[];
  lengthM: number;
}

/** where two runs part: a circle, whatever it is made as */
export interface DuctFitting {
  /** `fit:${outletKey}+${outletKey}`: what a pick is stored under */
  key: string;
  at: Point;
  /** the person's pick, or null: decided on the day */
  kind: FittingKind | null;
  /** the trade's name, in inches, biggest first: "Fitting 12-10-8",
      "BTO 12-10-8" */
  name: string;
  /** every duct on it, biggest first */
  ductsMm: number[];
}

export interface DuctCollar {
  /** on the plenum's face */
  at: Point;
  /** the way the run leaves it */
  out: Point;
  diaMm: number;
}

/** a motorised damper on a run that feeds one zone */
export interface ZoneDamper {
  key: string;
  zone: Zone;
  at: Point;
  /** the way its run goes there */
  dir: Point;
  diaMm: number;
}

/** what zoning puts on the plan: a damper on each zone's runs, a sensor a
    zone under temperature control, and the controller */
export interface ZonePlan {
  zones: Zone[];
  dampers: ZoneDamper[];
  sensors: { key: string; zone: Zone; at: Point }[];
  controller: { key: string; at: Point } | null;
}

export interface DuctLayout {
  unitId: string;
  model: string;
  floorId: string;
  outlets: DuctOutlet[];
  ret: { key: string; at: Point; wMm: number; hMm: number; filter: boolean; diaMm: number; runs: number; moved: boolean };
  /** the supply plenum: a box on the unit's supply face */
  plenum: Point[];
  collars: DuctCollar[];
  supply: DuctRun[];
  /** none while the grille sits under the unit on its box */
  returns: DuctRun[];
  fittings: DuctFitting[];
  /** null while zoning is off */
  zoning: ZonePlan | null;
  /** rooms the unit serves that are on another floor: counted, not drawn */
  offFloor: string[];
}

/* ── geometry ── */
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** a polyline's length in metres, at this floor's scale */
export function polylineM(points: readonly Point[], mmPerUnit: number): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += dist(points[i - 1], points[i]);
  return (n * mmPerUnit) / 1000;
}

/** a size the way the trade says it on a fitting: 300 mm is 12 inches */
export const inches = (mm: number): number => Math.round(mm / 25);

/** a junction's name from the ducts on it, biggest first: "Fitting
    14-10-10", or "Y …" / "BTO …" once picked */
export function fittingName(ductsMm: readonly number[], kind: FittingKind | null): string {
  const word = kind === "y" ? "Y" : kind === "bto" ? "BTO" : "Fitting";
  return `${word} ${[...ductsMm].sort((a, b) => b - a).map(inches).join("-")}`;
}

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

/** the way a room runs: along its longer side */
export function roomAlong(room: RoomObj): Point {
  if (room.geometry.kind !== "polygon") return { x: 1, y: 0 };
  const xs = room.geometry.points.map((p) => p.x);
  const ys = room.geometry.points.map((p) => p.y);
  return Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? { x: 1, y: 0 } : { x: 0, y: 1 };
}

/** a linear grille's two ends */
export function linearEnds(o: Pick<DuctOutlet, "at" | "along" | "lengthMm">, mmPerUnit: number): [Point, Point] | null {
  if (!o.along || o.lengthMm == null) return null;
  const half = o.lengthMm / 2 / mmPerUnit;
  return [add(o.at, mul(o.along, -half)), add(o.at, mul(o.along, half))];
}

/** the system with one end of a linear grille drawn to a new spot: the
    other end stays, the grille runs along or across the plan, and its
    length snaps to a stock length */
export function drawLinearEnd(
  doc: DesignDocument,
  systemId: string,
  o: Pick<DuctOutlet, "key" | "at" | "along" | "lengthMm">,
  end: 0 | 1,
  to: Point,
  mmPerUnit: number
): DesignDocument {
  const ends = linearEnds(o, mmPerUnit);
  if (!ends) return doc;
  const fixed = ends[1 - end];
  const v = sub(to, fixed);
  if (Math.hypot(v.x, v.y) < 1e-9) return doc;
  const along = Math.abs(v.x) >= Math.abs(v.y) ? { x: Math.sign(v.x), y: 0 } : { x: 0, y: Math.sign(v.y) };
  const lengthMm = snapLength(Math.hypot(v.x, v.y) * mmPerUnit);
  const centre = add(fixed, mul(along, lengthMm / 2 / mmPerUnit));
  /* `along` keeps pointing from end 0 to end 1 */
  const way = end === 1 ? along : mul(along, -1);
  return setOutletPick(dragDuctEnd(doc, systemId, o.key, centre), systemId, o.key, { along: way, lengthMm });
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

/** the Ys and BTOs the person picked, by junction key */
export function fittingKinds(sys: DesignSystem): Record<string, FittingKind> {
  const v = sys.settings.ductFitting;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, FittingKind> = {};
  for (const [k, kind] of Object.entries(v as Record<string, unknown>)) if (kind === "y" || kind === "bto") out[k] = kind;
  return out;
}

/** the system with one junction made as a Y or a BTO, or back to the day
    with null */
export function setFittingKind(doc: DesignDocument, systemId: string, key: string, kind: FittingKind | null): DesignDocument {
  return {
    ...doc,
    systems: doc.systems.map((s) => {
      if (s.id !== systemId) return s;
      const next = { ...fittingKinds(s) };
      if (kind) next[key] = kind;
      else delete next[key];
      return { ...s, settings: { ...s.settings, ductFitting: next } };
    }),
  };
}

/** the angle of a point seen from the unit's supply face, against the way
    out of it, degrees */
function bearing(face: { mid: Point; out: Point }, p: Point): number {
  const v = sub(p, face.mid);
  const a = Math.atan2(v.y, v.x) - Math.atan2(face.out.y, face.out.x);
  return ((((a * 180) / Math.PI + 540) % 360) - 180);
}

/* ── routing, in the plenum's own frame: `a` along the unit, `b` out of
   its front, so every leg is along one or the other ── */
interface L {
  a: number;
  b: number;
}
type Face = "front" | "left" | "right";
const same = (p: L, q: L) => Math.abs(p.a - q.a) < 1e-6 && Math.abs(p.b - q.b) < 1e-6;
const tidy = (pts: L[]): L[] => pts.filter((p, i) => i === 0 || !same(p, pts[i - 1]));

/** a square route from a collar to a point, leaving the collar's face
    straight; `turn` is how far out a front run turns */
function route(c: L, face: Face, t: L, turn: number, leg: number): L[] {
  if (face === "front") {
    if (Math.abs(t.a - c.a) < 1e-6) return tidy([c, t]);
    if (t.b - turn < leg / 2) return tidy([c, { a: c.a, b: t.b }, t]);
    return tidy([c, { a: c.a, b: turn }, { a: t.a, b: turn }, t]);
  }
  const s = face === "left" ? -1 : 1;
  if (s * (t.a - c.a) > leg) return tidy([c, { a: t.a, b: c.b }, t]);
  const x = c.a + s * leg;
  return tidy([c, { a: x, b: c.b }, { a: x, b: t.b }, t]);
}

/** where a nearer outlet best leaves a run: the point on one of its legs
    nearest it, clear of the bends, and further clear of the outlet at its
    end */
function junctionOn(path: L[], p: L, clear: number, clearEnd: number): { at: L; leg: number; off: number } | null {
  let best: { at: L; leg: number; off: number } | null = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const along = Math.abs(b.a - a.a) > Math.abs(b.b - a.b);
    const last = i === path.length - 2;
    const from = along ? a.a : a.b;
    const to = along ? b.a : b.b;
    const dir = Math.sign(to - from);
    const start = from + dir * clear;
    const end = to - dir * (last ? clearEnd : clear);
    if (dir * (end - start) < 0) continue;
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const v = Math.min(hi, Math.max(lo, along ? p.a : p.b));
    const at = along ? { a: v, b: a.b } : { a: a.a, b: v };
    const off = Math.hypot(p.a - at.a, p.b - at.b);
    if (!best || off < best.off) best = { at, leg: i, off };
  }
  return best;
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
  const picked = fittingKinds(sys);
  const made = outletPicks(sys);
  const mm = (v: number) => v / s;

  /* the plenum's frame */
  const front = add(supplyFace.mid, mul(supplyFace.out, mm(PLENUM_MM)));
  const toL = (p: Point): L => {
    const v = sub(p, front);
    return { a: v.x * supplyFace.ax.x + v.y * supplyFace.ax.y, b: v.x * supplyFace.out.x + v.y * supplyFace.out.y };
  };
  const toW = (l: L): Point => add(front, add(mul(supplyFace.ax, l.a), mul(supplyFace.out, l.b)));
  const halfW = supplyFace.halfW;
  const depth = mm(PLENUM_MM);
  const plenum = [
    add(supplyFace.mid, mul(supplyFace.ax, -halfW)),
    add(supplyFace.mid, mul(supplyFace.ax, halfW)),
    add(front, mul(supplyFace.ax, halfW)),
    add(front, mul(supplyFace.ax, -halfW)),
  ];

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
      const spec = outletSpec(made[key], r.outlets.lsEach, r.outlets.neckMm, roomAlong(room));
      outlets.push({ ...spec, key, roomId: r.roomId, at: moved[key] ?? p, ls: r.outlets.lsEach });
    });
  }
  const local = new Map(outlets.map((o) => [o.key, toL(o.at)]));
  const faceOf = (o: DuctOutlet): Face => {
    const p = local.get(o.key)!;
    return p.b > 0 ? "front" : p.a < 0 ? "left" : "right";
  };

  /* who shares a run: two outlets in one room first, then neighbours by
     direction from the unit, each pair only while their air fits and they
     leave the plenum by the same face */
  const trunkCap = ductCapacityLs(TRUNK_MAX_MM, SUPPLY_MS);
  const angle = new Map(outlets.map((o) => [o.key, bearing(supplyFace, o.at)]));
  const taken = new Set<string>();
  const groups: DuctOutlet[][] = [];
  const pairs = (sameRoom: boolean) => {
    const free = outlets.filter((o) => !taken.has(o.key)).sort((a, b) => angle.get(a.key)! - angle.get(b.key)!);
    for (let i = 0; i < free.length - 1; i++) {
      const a = free[i];
      if (taken.has(a.key)) continue;
      for (let j = i + 1; j < free.length; j++) {
        const b = free[j];
        if (taken.has(b.key)) continue;
        if ((a.roomId === b.roomId) !== sameRoom) continue;
        if (faceOf(a) !== faceOf(b)) continue;
        if (a.ls + b.ls > trunkCap + 1e-9) continue;
        if (Math.abs(angle.get(a.key)! - angle.get(b.key)!) > TRUNK_SPREAD_DEG) continue;
        groups.push([a, b]);
        taken.add(a.key);
        taken.add(b.key);
        break;
      }
    }
  };
  pairs(true);
  pairs(false);
  for (const o of outlets) if (!taken.has(o.key)) groups.push([o]);

  /* each run heads for its farther outlet */
  const reach = (o: DuctOutlet) => {
    const p = local.get(o.key)!;
    return Math.abs(p.a) + Math.abs(p.b);
  };
  const trunks = groups.map((g) => {
    const [far, near] = g.length === 2 && reach(g[1]) > reach(g[0]) ? [g[1], g[0]] : g;
    return { far, near: near as DuctOutlet | undefined, face: faceOf(far), target: local.get(far.key)! };
  });

  /* the collars: across the front in the order their runs go, and down
     each end with the one that reaches furthest at the front corner */
  const collarAt = new Map<(typeof trunks)[number], L>();
  const onFront = trunks.filter((t) => t.face === "front").sort((x, y) => x.target.a - y.target.a);
  onFront.forEach((t, i) => collarAt.set(t, { a: -halfW + ((i + 1) / (onFront.length + 1)) * 2 * halfW, b: 0 }));
  for (const face of ["left", "right"] as const) {
    const on = trunks.filter((t) => t.face === face).sort((x, y) => Math.abs(y.target.a) - Math.abs(x.target.a));
    on.forEach((t, i) => collarAt.set(t, { a: (face === "left" ? -1 : 1) * halfW, b: -((i + 1) / (on.length + 1)) * depth }));
  }
  /* front runs turning the same way turn in steps, the outermost first,
     so none crosses another */
  const turnOf = new Map<(typeof trunks)[number], number>();
  const leftward = onFront.filter((t) => t.target.a < collarAt.get(t)!.a);
  const rightward = onFront.filter((t) => t.target.a >= collarAt.get(t)!.a).reverse();
  for (const side of [leftward, rightward]) side.forEach((t, i) => turnOf.set(t, mm(LEG_MM + i * STEP_MM)));

  const supply: DuctRun[] = [];
  const fittings: DuctFitting[] = [];
  const collars: DuctCollar[] = [];
  /* each run and the outlets it feeds, for the zone dampers */
  const feeds = new Map<string, DuctOutlet[]>();
  const runOf = (key: string, o: { diaMm: number; ls: number }, pts: L[]): DuctRun => {
    const points = pts.map(toW);
    return { key, stream: "supply", diaMm: o.diaMm, ls: o.ls, points, lengthM: polylineM(points, s) };
  };
  const outward: Record<Face, Point> = { front: supplyFace.out, left: mul(supplyFace.ax, -1), right: supplyFace.ax };
  for (const t of trunks) {
    const c = collarAt.get(t)!;
    const turn = turnOf.get(t) ?? mm(LEG_MM);
    const leg = mm(LEG_MM);
    const ls = t.far.ls + (t.near?.ls ?? 0);
    const dia = t.near ? sizeForLs(ls, SUPPLY_MS, TRUNK_MAX_MM) ?? TRUNK_MAX_MM : t.far.neckMm;
    collars.push({ at: toW(c), out: outward[t.face], diaMm: dia });
    if (!t.near) {
      supply.push(runOf(`run:${t.far.key}`, { diaMm: dia, ls }, route(c, t.face, t.target, turn, leg)));
      feeds.set(`run:${t.far.key}`, [t.far]);
      continue;
    }
    /* two outlets: the run to the farther, the nearer off it at a circle;
       when the nearer sits on that run, the run comes in from one side so
       the nearer leaves it square */
    const n = local.get(t.near.key)!;
    let path = route(c, t.face, t.target, turn, leg);
    let j = junctionOn(path, n, mm(CLEAR_MM), mm(CLEAR_END_MM));
    if (!j || j.off < mm(CLEAR_MM)) {
      const side = Math.sign(c.a - t.target.a) || 1;
      const aside = { a: t.target.a + side * mm(ASIDE_MM), b: t.target.b };
      path = tidy([...route(c, t.face, aside, turn, leg), t.target]);
      j = junctionOn(path, n, mm(CLEAR_MM), mm(CLEAR_END_MM)) ?? { at: path[path.length - 2], leg: path.length - 2, off: 0 };
    }
    const at = j.at;
    const trunk = tidy([...path.slice(0, j.leg + 1), at]);
    const carry = tidy([at, ...path.slice(j.leg + 1)]);
    const legAlong = Math.abs(path[j.leg + 1].a - path[j.leg].a) > Math.abs(path[j.leg + 1].b - path[j.leg].b);
    const branch = tidy([at, legAlong ? { a: at.a, b: n.b } : { a: n.a, b: at.b }, n]);
    const key = `fit:${[t.far.key, t.near.key].sort().join("+")}`;
    supply.push(runOf(`trunk:${key}`, { diaMm: dia, ls }, trunk));
    supply.push(runOf(`run:${t.far.key}`, { diaMm: t.far.neckMm, ls: t.far.ls }, carry));
    supply.push(runOf(`run:${t.near.key}`, { diaMm: t.near.neckMm, ls: t.near.ls }, branch));
    feeds.set(`trunk:${key}`, [t.far, t.near]);
    feeds.set(`run:${t.far.key}`, [t.far]);
    feeds.set(`run:${t.near.key}`, [t.near]);
    const ductsMm = [dia, t.far.neckMm, t.near.neckMm].sort((x, y) => y - x);
    const kind = picked[key] ?? null;
    fittings.push({ key, at: toW(at), kind, ductsMm, name: fittingName(ductsMm, kind) });
  }

  /* the return: its grille straight under the return face on its box,
     unless dragged away, when its runs go back to the face */
  const retKey = `${air.unit.id}/return`;
  const under = add(returnFace.mid, mul(returnFace.out, mm(air.ret.grille.hMm / 2 + RETURN_GAP_MM)));
  const grilleAt = moved[retKey] ?? under;
  const returns: DuctRun[] = [];
  if (moved[retKey]) {
    for (let i = 0; i < air.ret.runs; i++) {
      const offset = ((i + 1) / (air.ret.runs + 1) - 0.5) * 2 * returnFace.halfW;
      const spigot = add(returnFace.mid, mul(returnFace.ax, offset));
      const v = sub(grilleAt, spigot);
      const out = v.x * returnFace.out.x + v.y * returnFace.out.y;
      const leg = add(spigot, mul(returnFace.out, Math.max(mm(LEG_MM), out)));
      const points = [spigot, leg, grilleAt].filter((p, k, all) => k === 0 || dist(p, all[k - 1]) > 1e-6);
      returns.push({
        key: `return:${air.unit.id}/${i}`,
        stream: "return",
        diaMm: air.ret.diaMm,
        ls: air.ls / air.ret.runs,
        points,
        lengthM: polylineM(points, s),
      });
    }
  }

  /* zoning: a damper on the first run down from the plenum that feeds one
     zone only, a sensor a zone, and the controller past the return */
  let zoning: ZonePlan | null = null;
  const z = zoningOf(sys, air.unit.id);
  const zones = zonesOf(air, z);
  if (zones.length) {
    const zoneOf = (roomId: string) => zones.find((x) => x.roomIds.includes(roomId))!;
    const dampers: ZoneDamper[] = [];
    const runAt = (r: DuctRun): { at: Point; dir: Point } => {
      let left = Math.min(mm(DAMPER_IN_MM), polylineM(r.points, s) * 1000 * 0.4 / s);
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1];
        const b = r.points[i];
        const l = dist(a, b);
        const dir = l > 0 ? mul(sub(b, a), 1 / l) : { x: 1, y: 0 };
        if (left <= l || i === r.points.length - 1) return { at: add(a, mul(dir, Math.min(left, l))), dir };
        left -= l;
      }
      return { at: r.points[0], dir: { x: 1, y: 0 } };
    };
    for (const r of supply) {
      const fed = feeds.get(r.key);
      if (!fed) continue;
      const zs = new Set(fed.map((o) => zoneOf(o.roomId).key));
      if (zs.size !== 1) continue;
      /* a trunk to one zone carries the damper; its two runs on then don't */
      if (r.key.startsWith("run:")) {
        const trunk = supply.find((t) => t.key.startsWith("trunk:") && feeds.get(t.key)?.some((o) => `run:${o.key}` === r.key));
        if (trunk && new Set(feeds.get(trunk.key)!.map((o) => zoneOf(o.roomId).key)).size === 1) continue;
      }
      const { at, dir } = runAt(r);
      dampers.push({ key: `damper:${r.key}`, zone: zoneOf(fed[0].roomId), at, dir, diaMm: r.diaMm });
    }
    const sensors: ZonePlan["sensors"] = [];
    if (z.control === "temperature") {
      for (const zone of zones) {
        const key = `${air.unit.id}/sensor/${zone.key}`;
        const room = doc.objects.find((o) => o.id === zone.roomIds[0]) as RoomObj | undefined;
        if (!room || room.geometry.kind !== "polygon" || room.floorId !== unitObj.floorId) continue;
        const xs = room.geometry.points.map((p) => p.x);
        const ys = room.geometry.points.map((p) => p.y);
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const unitAt = unitObj.geometry.at;
        /* on the side wall further from the unit, halfway along */
        const west = Math.abs(Math.min(...xs) - unitAt.x) > Math.abs(Math.max(...xs) - unitAt.x);
        const x = west ? Math.min(...xs) + mm(SENSOR_IN_MM) : Math.max(...xs) - mm(SENSOR_IN_MM);
        sensors.push({ key, zone, at: moved[key] ?? { x, y: cy } });
      }
    }
    const ctlKey = `${air.unit.id}/controller`;
    const past = add(returnFace.mid, mul(returnFace.out, mm(air.ret.grille.hMm + CONTROLLER_OUT_MM)));
    zoning = { zones, dampers, sensors, controller: { key: ctlKey, at: moved[ctlKey] ?? past } };
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
      moved: !!moved[retKey],
    },
    plenum,
    collars,
    supply,
    returns,
    fittings,
    zoning,
    offFloor,
  };
}

/** the ductwork for every ducted unit on a system that is on the plan */
export function systemDuctwork(doc: DesignDocument, pack: DataPack, sys: DesignSystem): DuctLayout[] {
  return systemAir(doc, pack, sys)
    .map((air) => unitDuctLayout(doc, sys, air))
    .filter((l): l is DuctLayout => l != null);
}
