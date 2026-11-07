/* A DUCT ON THE UNIT DECIDES THE PLENUM (Isaac, 2026-10-31: "attaching duct to
   the unit decides the plenum spigots"). Nobody places a plenum in the next
   flow, and nothing is stored for one. A unit with no duct on a face has
   nothing on that face; the ducts attached to a face are its spigots, one
   each, at their own size. Take a duct away or change its size and the spigots
   follow.

   Every supply plenum is a V ("all plenums can be a v shaped supply, attaching
   duct decides the design"): base on the unit, closing to a point. Where a duct
   is heading picks its slope, and a lone duct heading straight out takes the
   point. A return plenum is a box with its spigots across the face.

   A face with factory spigots (the pack's HAA return, 2 x Ø400) is not
   fabricated: the ducts land on those spigots, and a face asked to take more
   than it has, or another size, says so on the Summary.

   Only a duct with a spot on the casing counts (`off`, duct-face.ts), which is
   a duct the next flow drew: the shipping flow's placed plenums are untouched.
   A floor with no scale has no true sizes, so it draws no plenum. Pure. */

import type { DesignDocument, DesignObject, Point } from "./document";
import type { IndoorUnit, OpeningSpec } from "./packs/schema";
import { hasFactorySpigots, spigotDiametersMm } from "./packs/schema";
import { reconcileAttachedRuns } from "./attach";
import { distributeSpigots, isPlenumOf, plenumBody, spigotsOf, type PlenumBody, type PlenumSpigot } from "./ducted";
import { attachOf, type Attach } from "./graph";

export type AirEnd = "supply" | "return";

/** the part of a pack row a plenum reads */
export type Openings = Pick<IndoorUnit, "supply_opening" | "return_opening">;
type RowOf = (model: string) => Openings | null | undefined;

export interface FaceDuct {
  run: DesignObject;
  key: "startAttach" | "endAttach";
  attach: Attach;
  diaMm: number;
}

export const openingFor = (row: Openings | null | undefined, end: AirEnd): OpeningSpec | null =>
  (end === "return" ? row?.return_opening : row?.supply_opening) ?? null;

/** the ducts attached to one face of a unit, left to right along it */
export function ductsOnFace(objects: readonly DesignObject[], unitId: string, end: AirEnd): FaceDuct[] {
  const out: FaceDuct[] = [];
  for (const run of objects) {
    if (run.type !== "duct-run") continue;
    if ((run.props.stream === "return" ? "return" : "supply") !== end) continue;
    for (const key of ["startAttach", "endAttach"] as const) {
      const attach = attachOf(run.props[key]);
      if (attach?.kind === "unit" && attach.id === unitId && attach.off) {
        out.push({ run, key, attach, diaMm: Number(run.props.diaMm) || 250 });
      }
    }
  }
  return out.sort((a, b) => (a.attach.off?.x ?? 0) - (b.attach.off?.x ?? 0) || a.run.id.localeCompare(b.run.id));
}

/** what a face's ducts make: a plenum, the unit's own spigots, or nothing */
export type UnitFace =
  | { kind: "plenum"; end: AirEnd; ducts: FaceDuct[]; spigots: PlenumSpigot[]; body: PlenumBody }
  | { kind: "factory"; end: AirEnd; ducts: FaceDuct[]; factoryMm: number[] };

/** which part of the V each duct comes off, from where it is heading. A duct
    already seated keeps its slope, so seating twice changes nothing. */
function vSpigots(ducts: FaceDuct[], mm: number | null | undefined): PlenumSpigot[] {
  if (ducts.length === 1) {
    const d = ducts[0];
    const x = d.attach.off?.x ?? 0;
    if (Math.abs(x) <= (mm ? d.diaMm / 2 / mm : 0)) return [{ id: d.run.id, diaMm: d.diaMm, t: 0, face: "front" }];
  }
  const left: FaceDuct[] = [];
  const right: FaceDuct[] = [];
  const ahead: FaceDuct[] = [];
  for (const d of ducts) {
    const x = d.attach.off?.x ?? 0;
    (x < 0 ? left : x > 0 ? right : ahead).push(d);
  }
  for (const d of ahead) (left.length <= right.length ? left : right).push(d);
  /* t runs from the unit's corner to the point on either slope */
  return [
    ...left.map((d, i) => ({ id: d.run.id, diaMm: d.diaMm, t: i, face: "left" as const })),
    ...right.map((d, i) => ({ id: d.run.id, diaMm: d.diaMm, t: right.length - i, face: "right" as const })),
  ];
}

/** the two faces of a unit, as its ducts have them; a face with no duct is absent */
export function unitFaces(
  objects: readonly DesignObject[],
  unit: DesignObject,
  row: Openings | null | undefined,
  mm?: number | null
): UnitFace[] {
  const out: UnitFace[] = [];
  for (const end of ["supply", "return"] as const) {
    const ducts = ductsOnFace(objects, unit.id, end);
    if (ducts.length === 0) continue;
    const opening = openingFor(row, end);
    if (opening === "built-in") continue;
    if (hasFactorySpigots(opening)) {
      out.push({ kind: "factory", end, ducts, factoryMm: spigotDiametersMm(opening) });
      continue;
    }
    /* a plenum somebody placed in the shipping flow keeps its own spigots */
    if (objects.some((o) => isPlenumOf(o, unit.id) && o.props.end === end)) continue;
    const spigots = distributeSpigots(
      end === "supply"
        ? vSpigots(ducts, mm)
        : ducts.map((d, i) => ({ id: d.run.id, diaMm: d.diaMm, t: i, face: "front" as const }))
    );
    const body = plenumBody({ opening, unitWidthMm: Number(unit.props.widthMm ?? 800), spigots, stream: end });
    out.push({ kind: "plenum", end, ducts, spigots, body });
  }
  return out;
}

/** a face's plenum in the plenum object's own shape, for what draws plenums */
export function plenumsFromDucts(
  objects: readonly DesignObject[],
  unit: DesignObject,
  row: Openings | null | undefined,
  mm: number | null | undefined
): DesignObject[] {
  const out: DesignObject[] = [];
  for (const f of unitFaces(objects, unit, row, mm)) {
    if (f.kind !== "plenum") continue;
    out.push({
      id: `plenum:${unit.id}:${f.end}`,
      type: "plenum",
      systemId: unit.systemId,
      floorId: unit.floorId,
      geometry: unit.geometry,
      plane: unit.plane,
      props: { stream: f.end, unitId: unit.id, end: f.end, spigots: f.spigots, fromDucts: true },
    });
  }
  return out;
}

const SPOT_EPS = 1e-6;

/** the far end of a takeoff, across the face (a) and out of it (o), world units:
    where its duct starts. The same layout plenumShape draws. */
function takeoffEnd(sp: PlenumSpigot | undefined, body: PlenumBody, mm: number): { a: number; o: number } {
  const hBase = body.baseWMm / mm / 2;
  const hSpig = Math.min(hBase, body.spigotFaceWMm / mm / 2);
  const depth = body.depthMm / mm;
  const stub = depth * PLENUM_STUB;
  const t = sp?.t ?? 0.5;
  if (!sp || sp.face === "front") return { a: -hSpig + t * 2 * hSpig, o: depth + stub };
  const sgn = sp.face === "left" ? -1 : 1;
  const ea = sgn * hSpig - sgn * hBase;
  const len = Math.hypot(ea, depth) || 1;
  /* the slope's normal, away from the body */
  let na = depth / len;
  let no = -ea / len;
  if (na * sgn < 0) {
    na = -na;
    no = -no;
  }
  return { a: sgn * hBase + ea * t + na * stub, o: depth * t + no * stub };
}

/** Every duct on a unit sits on its spigot: the far end of the plenum's takeoff,
    or the factory spigot its place along the face gives it. Runs after each
    change to the plan; a plan with nothing to seat comes back by reference. */
export function seatDuctsOnUnits(doc: DesignDocument, rowOf: RowOf): DesignDocument {
  const scaleOf = new Map(doc.floors.map((f) => [f.id, f.scaleMmPerUnit ?? null]));
  const spots = new Map<string, Point>();
  const moved = new Set<string>();
  for (const unit of doc.objects) {
    if (unit.type !== "unit") continue;
    const mm = scaleOf.get(unit.floorId);
    if (!mm) continue;
    const w = Number(unit.props.widthMm ?? 800) / mm;
    const h = Number(unit.props.depthMm ?? 300) / mm;
    const flip = unit.props.airFlip === true;
    for (const face of unitFaces(doc.objects, unit, rowOf(String(unit.props.model ?? "")), mm)) {
      const side = (face.end === "supply" ? 1 : -1) * (flip ? -1 : 1);
      face.ducts.forEach((d, i) => {
        let off: Point;
        if (face.kind === "plenum") {
          const seat = takeoffEnd(face.spigots.find((sp) => sp.id === d.run.id), face.body, mm);
          off = { x: seat.a, y: side * (h / 2 + seat.o) };
        } else {
          const n = face.factoryMm.length || 2;
          off = { x: -w / 2 + ((Math.min(i, n - 1) + 1) / (n + 1)) * w, y: (side * h) / 2 };
        }
        const was = d.attach.off;
        if (was && Math.abs(was.x - off.x) < SPOT_EPS && Math.abs(was.y - off.y) < SPOT_EPS) return;
        spots.set(`${d.run.id}/${d.key}`, off);
        moved.add(unit.id);
      });
    }
  }
  if (moved.size === 0) return doc;
  const objects = doc.objects.map((o) => {
    const start = spots.get(`${o.id}/startAttach`);
    const end = spots.get(`${o.id}/endAttach`);
    if (!start && !end) return o;
    const props = { ...o.props };
    if (start) props.startAttach = { ...(props.startAttach as Attach), off: start };
    if (end) props.endAttach = { ...(props.endAttach as Attach), off: end };
    return { ...o, props };
  });
  return { ...doc, objects: reconcileAttachedRuns(objects, moved) };
}

/** a face that can't take what's on it, in words, for the Summary's checks */
export function faceProblems(doc: DesignDocument, rowOf: RowOf): string[] {
  const out: string[] = [];
  for (const unit of doc.objects) {
    if (unit.type !== "unit") continue;
    const model = String(unit.props.model ?? "");
    const mm = doc.floors.find((fl) => fl.id === unit.floorId)?.scaleMmPerUnit;
    for (const f of unitFaces(doc.objects, unit, rowOf(model), mm)) {
      const word = f.end === "return" ? "return" : "supply";
      if (f.kind === "plenum") {
        if (f.body.overSpigot) out.push(`${model}: ${f.ducts.length} ${word} ducts won't fit its ${Math.round(f.body.baseWMm)} mm plenum`);
        continue;
      }
      const has = f.factoryMm.length;
      if (has && f.ducts.length > has) out.push(`${model}: ${f.ducts.length} ${word} ducts on ${has} factory spigots`);
      f.ducts.slice(0, has).forEach((d, i) => {
        if (d.diaMm !== f.factoryMm[i]) out.push(`${model}: a Ø${d.diaMm} ${word} duct on a Ø${f.factoryMm[i]} factory spigot`);
      });
    }
  }
  return out;
}

/* how far a takeoff stands off the plenum, as a share of its depth */
const PLENUM_STUB = 0.4;

export interface PlenumSpigotRect {
  id: string;
  /** 4 corners of the spigot rectangle (plan view of the takeoff) */
  rect: Point[];
  /** centre (cap-tick anchor + hit target) */
  cx: number;
  cy: number;
  /** outward normal — cap-tick direction */
  nx: number;
  ny: number;
  capped: boolean;
  /** its own diameter (mm) — every takeoff is labelled AT the takeoff */
  diaMm: number;
}
export interface PlenumShape {
  body: Point[];
  spigots: PlenumSpigotRect[];
  labelAt: Point;
}

export function plenumShape(opts: {
  /** face midpoint (on the AHU long face — air flows through the depth) */
  cx: number;
  cy: number;
  /** unit vector pointing OUT of that face (the unit's rotation is in here) */
  out: Point;
  /** unit vector running ALONG the face, so the shape turns with the unit */
  ax: Point;
  /** half the BASE width — on the unit, the widest edge (world units) */
  baseHalf: number;
  /** half the SPIGOT-FACE width — the narrow far edge (world units, ≤ base) */
  spigotHalf: number;
  /** plan protrusion from the unit face (world units) */
  depth: number;
  spigots: (PlenumSpigot & { r: number })[];
}): PlenumShape {
  const { cx, cy, out, ax, baseHalf, depth } = opts;
  /* The whole shape is laid out in the FACE's own frame — `a` runs across the
     face, `o` out of it — and mapped to world through the unit's basis. That
     is what lets a rotated AHU carry its plenum round with it; the frame is
     (1,0)/(0,±1) for an unrotated unit, which is the geometry this drew before
     ducted units could turn. */
  const P = (a: number, o: number): Point => ({
    x: cx + ax.x * a + out.x * o,
    y: cy + ax.y * a + out.y * o,
  });
  const V = (a: number, o: number): Point => ({
    x: ax.x * a + out.x * o,
    y: ax.y * a + out.y * o,
  });
  const hBase = baseHalf;
  /* The far face is exactly as wide as the ducts landing ON it — no artificial
     lip. With every takeoff on the SIDES the face is nothing and the body
     closes to a true V point, which is how these are drawn by hand (field
     sketch 2026-07-23); the old 12% floor left a stub that read as a mistake. */
  const hSpig = Math.min(hBase, opts.spigotHalf);
  const stub = depth * PLENUM_STUB; // how far the spigot rectangles stand off the face

  // trapezoid: WIDE on the unit (±hBase) → NARROW at the spigot face (±hSpig)
  const body: Point[] = [
    P(-hBase, 0),
    P(-hSpig, depth),
    P(hSpig, depth),
    P(hBase, 0),
  ];

  const spigots: PlenumSpigotRect[] = opts.spigots.map((s) => {
    if (s.face === "front") {
      /* front spigots: t ∈ 0..1 left→right along the (narrow) spigot face.
         Rectangle: Ø across the face, stub standing off it */
      const a = -hSpig + s.t * 2 * hSpig;
      return {
        id: s.id,
        rect: [
          P(a - s.r, depth),
          P(a - s.r, depth + stub),
          P(a + s.r, depth + stub),
          P(a + s.r, depth),
        ],
        cx: P(a, depth + stub / 2).x,
        cy: P(a, depth + stub / 2).y,
        nx: out.x,
        ny: out.y,
        capped: s.capped === true,
        diaMm: s.diaMm,
      };
    }
    /* side spigot: it comes off the SLOPED edge, so the takeoff has to be
       square to that edge — Ø along the slope, stub along the slope's outward
       normal. Drawing it axis-aligned (the old ±y × ±x box) left the duct
       hanging off the angled face at a visible angle (field feedback
       2026-07-25). */
    const sgn = s.face === "left" ? -1 : 1;
    // the sloped edge, base corner → spigot-face corner
    const ea = sgn * hSpig - sgn * hBase;
    const eo = depth;
    const len = Math.hypot(ea, eo) || 1;
    const ta = ea / len; // unit tangent along the edge
    const to = eo / len;
    // its normal, flipped to point AWAY from the body (outward across the face)
    let na = to;
    let no = -ta;
    if (na * sgn < 0) {
      na = -na;
      no = -no;
    }
    const pa = sgn * hBase + ea * s.t; // seat of the takeoff on the edge
    const po = eo * s.t;
    return {
      id: s.id,
      rect: [
        P(pa - ta * s.r, po - to * s.r), // edge footprint, Ø wide
        P(pa - ta * s.r + na * stub, po - to * s.r + no * stub),
        P(pa + ta * s.r + na * stub, po + to * s.r + no * stub),
        P(pa + ta * s.r, po + to * s.r),
      ],
      cx: P(pa + (na * stub) / 2, po + (no * stub) / 2).x,
      cy: P(pa + (na * stub) / 2, po + (no * stub) / 2).y,
      nx: V(na, no).x,
      ny: V(na, no).y,
      capped: s.capped === true,
      diaMm: s.diaMm,
    };
  });

  /* the label sits CENTRED ON the plenum body — a label belongs on the thing
     it names, and centring also keeps it clear of the takeoffs, which stand
     off the far face rather than over the body. */
  return { body, spigots, labelAt: P(0, depth / 2) };
}

/** a face of a turned, flipped unit on the plan, for what draws it */
export function faceFrame(at: Point, rotationDeg: number, h: number, flip: boolean, end: AirEnd) {
  const dir = (end === "supply" ? 1 : -1) * (flip ? -1 : 1);
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const sn = Math.sin(rad);
  return {
    mid: { x: at.x - sn * dir * (h / 2), y: at.y + c * dir * (h / 2) },
    out: { x: -dir * sn, y: dir * c },
    ax: { x: c, y: sn },
  };
}

/** a plenum laid out on its unit's face: the one figure the canvas and paper draw */
export function plenumFigure(opts: {
  props: Record<string, unknown>;
  widthMm: number;
  /** world units a mm */
  perMm: number;
  opening: OpeningSpec | null;
  face: { mid: Point; out: Point; ax: Point };
}) {
  const end = opts.props.end === "return" ? ("return" as const) : ("supply" as const);
  /* re-pack on the way out: designs saved before the packing fix still carry
     evenly-spaced values that overlap once the diameters differ */
  const sp = distributeSpigots(spigotsOf(opts.props));
  const body = plenumBody({ opening: opts.opening, unitWidthMm: opts.widthMm, spigots: sp, stream: end });
  if (body.builtIn || body.factorySpigots) return null;
  return {
    ...plenumShape({
      cx: opts.face.mid.x,
      cy: opts.face.mid.y,
      out: opts.face.out,
      ax: opts.face.ax,
      baseHalf: (body.baseWMm * opts.perMm) / 2,
      spigotHalf: (body.spigotFaceWMm * opts.perMm) / 2,
      depth: body.depthMm * opts.perMm,
      spigots: sp.map((s) => ({ ...s, r: (s.diaMm * opts.perMm) / 2 })),
    }),
    label: body.label,
    derived: body.derived,
    overSpigot: body.overSpigot,
    /* a plenum its ducts made is built to take them: his 2 x Ø400 off a 266 mm
       opening is how it's done, so height is no failure on one */
    overHeight: opts.props.fromDucts === true ? false : body.overHeight,
  };
}
