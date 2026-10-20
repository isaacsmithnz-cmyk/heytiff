import type { ReadRoofPart } from "./reading";

/* THE ROOF AND ITS FRAMING IN 3D (Isaac, 20 October 2026: "Roof and framing
   should always be done"). Pure geometry: a roof part Tiff read (a
   rectangle on the plan, its form, pitch, eave height and overhang) becomes
   the sheets of the roof, the walls that rise to meet it, and the timber
   that holds it up, at standard spacings, because a drawing set seldom has
   a framing plan: rafters at 600, ceiling joists at 450, a ridge board, hip
   rafters on a hip.

   Everything is in metres, in the scene's own x (the plan's x), y (up) and
   z (the plan's y). Each part is worked in its own u (along the ridge) and
   v (across it, the way the roof falls), then turned back to x and z. */

export type V3 = [number, number, number];
export type Mesh = { verts: V3[]; tris: number[] };
export type MemberKind = "rafter" | "ridge" | "hip" | "joist";
export type Member = { k: MemberKind; a: V3; b: V3; w: number; h: number };

/** A part in metres: its rectangle at the wall line and what Tiff read of it. */
export type RoofRect = {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** the top of its walls, metres above the ground floor's level */
  base: number;
  part: Pick<ReadRoofPart, "form" | "ridge" | "fallsTo" | "pitchDeg" | "overhangMm">;
};

export const RAFTERS_AT = 0.6;
export const JOISTS_AT = 0.45;
const RAFTER = { w: 0.045, h: 0.14 };
const JOIST = { w: 0.045, h: 0.12 };
const RIDGE = { w: 0.035, h: 0.24 };
const HIP = { w: 0.045, h: 0.19 };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The part's own frame: u runs along the ridge, v across it. */
function frame(r: RoofRect) {
  /* a skillion's "ridge" names the way its edges run; it slopes across them */
  const along = r.part.ridge === "across" ? "x" : "z";
  const u0 = along === "x" ? r.x0 : r.z0;
  const u1 = along === "x" ? r.x1 : r.z1;
  const v0 = along === "x" ? r.z0 : r.x0;
  const v1 = along === "x" ? r.z1 : r.x1;
  const at = (u: number, y: number, v: number): V3 => (along === "x" ? [r3(u), r3(y), r3(v)] : [r3(v), r3(y), r3(u)]);
  return { along, u0, u1, v0, v1, at };
}

const tanOf = (r: RoofRect) => Math.tan((Math.max(0, r.part.pitchDeg) * Math.PI) / 180);

/** Which way a skillion climbs in v: true when its low side is at v0. */
function lowAtV0(r: RoofRect): boolean {
  const f = r.part.fallsTo;
  return r.part.ridge === "across" ? f !== "down" : f !== "right";
}

/** The underside of the roof sheets over a point, metres; -Infinity off the part. */
export function roofHeightAt(r: RoofRect, x: number, z: number): number {
  const { along, u0, u1, v0, v1 } = frame(r);
  const u = along === "x" ? x : z;
  const v = along === "x" ? z : x;
  if (u < u0 - 1e-6 || u > u1 + 1e-6 || v < v0 - 1e-6 || v > v1 + 1e-6) return -Infinity;
  const t = tanOf(r);
  const half = (v1 - v0) / 2;
  switch (r.part.form) {
    case "flat":
      return r.base;
    case "skillion":
      return r.base + (lowAtV0(r) ? v - v0 : v1 - v) * t;
    case "gable":
      return r.base + (half - Math.abs(v - (v0 + v1) / 2)) * t;
    case "hip": {
      const fromSide = half - Math.abs(v - (v0 + v1) / 2);
      const fromEnd = Math.min(u - u0, u1 - u);
      return r.base + Math.min(fromSide, fromEnd) * t;
    }
  }
}

function quad(m: Mesh, a: V3, b: V3, c: V3, d: V3) {
  const i = m.verts.length;
  m.verts.push(a, b, c, d);
  m.tris.push(i, i + 1, i + 2, i, i + 2, i + 3);
}
function tri(m: Mesh, a: V3, b: V3, c: V3) {
  const i = m.verts.length;
  m.verts.push(a, b, c);
  m.tris.push(i, i + 1, i + 2);
}

/** The roof sheets (`faces`) and the walls that rise to meet them (`fills`). */
export function roofMesh(r: RoofRect): { faces: Mesh; fills: Mesh } {
  const faces: Mesh = { verts: [], tris: [] };
  const fills: Mesh = { verts: [], tris: [] };
  const { u0, u1, v0, v1, at } = frame(r);
  const t = tanOf(r);
  const o = Math.max(0, r.part.overhangMm) / 1000;
  const half = (v1 - v0) / 2;
  const vm = (v0 + v1) / 2;
  const base = r.base;
  const eave = base - o * t;
  switch (r.part.form) {
    case "flat": {
      quad(faces, at(u0 - o, base + 0.15, v0 - o), at(u1 + o, base + 0.15, v0 - o), at(u1 + o, base + 0.15, v1 + o), at(u0 - o, base + 0.15, v1 + o));
      break;
    }
    case "skillion": {
      const width = v1 - v0;
      const lowV = lowAtV0(r) ? v0 : v1;
      const highV = lowAtV0(r) ? v1 : v0;
      const outLow = lowAtV0(r) ? v0 - o : v1 + o;
      const outHigh = lowAtV0(r) ? v1 + o : v0 - o;
      const top = base + width * t;
      quad(faces, at(u0 - o, eave, outLow), at(u1 + o, eave, outLow), at(u1 + o, top + o * t, outHigh), at(u0 - o, top + o * t, outHigh));
      /* the high wall, and the two ends climbing to it */
      quad(fills, at(u0, base, highV), at(u1, base, highV), at(u1, top, highV), at(u0, top, highV));
      tri(fills, at(u0, base, lowV), at(u0, base, highV), at(u0, top, highV));
      tri(fills, at(u1, base, lowV), at(u1, base, highV), at(u1, top, highV));
      break;
    }
    case "gable": {
      const ridge = base + half * t;
      quad(faces, at(u0 - o, eave, v0 - o), at(u1 + o, eave, v0 - o), at(u1 + o, ridge, vm), at(u0 - o, ridge, vm));
      quad(faces, at(u0 - o, ridge, vm), at(u1 + o, ridge, vm), at(u1 + o, eave, v1 + o), at(u0 - o, eave, v1 + o));
      tri(fills, at(u0, base, v0), at(u0, ridge, vm), at(u0, base, v1));
      tri(fills, at(u1, base, v0), at(u1, ridge, vm), at(u1, base, v1));
      break;
    }
    case "hip": {
      const ridge = base + Math.min(half, (u1 - u0) / 2) * t;
      const ra = Math.min(u0 + half, (u0 + u1) / 2);
      const rb = Math.max(u1 - half, (u0 + u1) / 2);
      quad(faces, at(u0 - o, eave, v0 - o), at(u1 + o, eave, v0 - o), at(rb, ridge, vm), at(ra, ridge, vm));
      quad(faces, at(ra, ridge, vm), at(rb, ridge, vm), at(u1 + o, eave, v1 + o), at(u0 - o, eave, v1 + o));
      tri(faces, at(u0 - o, eave, v1 + o), at(u0 - o, eave, v0 - o), at(ra, ridge, vm));
      tri(faces, at(u1 + o, eave, v0 - o), at(u1 + o, eave, v1 + o), at(rb, ridge, vm));
      break;
    }
  }
  return { faces, fills };
}

/** Is this point under a raked ceiling (no joists there)? */
export type Raked = (x: number, z: number) => boolean;

/** The timber under a part, at standard spacings. */
export function framingOf(r: RoofRect, raked: Raked = () => false): Member[] {
  const out: Member[] = [];
  const { u0, u1, v0, v1, at } = frame(r);
  const t = tanOf(r);
  const cos = Math.cos(Math.atan(t));
  const o = Math.max(0, r.part.overhangMm) / 1000;
  const drop = RAFTER.h / 2 / cos + 0.02;
  const half = (v1 - v0) / 2;
  const vm = (v0 + v1) / 2;
  const base = r.base;
  const ys = (h: number) => h - drop;
  const span = (lo: number, hi: number, step: number) => {
    const n = Math.max(1, Math.floor((hi - lo) / step));
    const pad = (hi - lo - n * step) / 2;
    return Array.from({ length: n + 1 }, (_, i) => lo + pad + i * step);
  };
  const put = (k: MemberKind, a: V3, b: V3, size: { w: number; h: number }) => out.push({ k, a, b, w: size.w, h: size.h });

  if (r.part.form !== "flat") {
    for (const u of span(u0 + 0.05, u1 - 0.05, RAFTERS_AT)) {
      if (r.part.form === "skillion") {
        const width = v1 - v0;
        const low = lowAtV0(r);
        put("rafter", at(u, ys(base - o * t), low ? v0 - o : v1 + o), at(u, ys(base + width * t + o * t), low ? v1 + o : v0 - o), RAFTER);
        continue;
      }
      /* how far in from the end it is: a hip's end rafters (jacks) stop short of the ridge */
      const reach = r.part.form === "hip" ? Math.min(half, u - u0, u1 - u) : half;
      if (reach <= 0.05) continue;
      put("rafter", at(u, ys(base - o * t), v0 - o), at(u, ys(base + reach * t), v0 + reach), RAFTER);
      put("rafter", at(u, ys(base + reach * t), v1 - reach), at(u, ys(base - o * t), v1 + o), RAFTER);
    }
    if (r.part.form === "gable") put("ridge", at(u0 - o, base + half * t - 0.12, vm), at(u1 + o, base + half * t - 0.12, vm), RIDGE);
    if (r.part.form === "hip") {
      const ridge = base + Math.min(half, (u1 - u0) / 2) * t;
      const ra = Math.min(u0 + half, (u0 + u1) / 2);
      const rb = Math.max(u1 - half, (u0 + u1) / 2);
      if (rb - ra > 0.05) put("ridge", at(ra, ridge - 0.12, vm), at(rb, ridge - 0.12, vm), RIDGE);
      for (const [cu, cv] of [
        [u0 - o, v0 - o],
        [u0 - o, v1 + o],
        [u1 + o, v0 - o],
        [u1 + o, v1 + o],
      ] as const)
        put("hip", at(cu, ys(base - o * t), cv), at(cu < (u0 + u1) / 2 ? ra : rb, ys(ridge), vm), HIP);
      /* the end jacks, running in from each hip end */
      for (const v of span(v0 + 0.05, v1 - 0.05, RAFTERS_AT)) {
        const reach = Math.min(half - Math.abs(v - vm), (u1 - u0) / 2);
        if (reach <= 0.05) continue;
        put("rafter", at(u0 - o, ys(base - o * t), v), at(u0 + reach, ys(base + reach * t), v), RAFTER);
        put("rafter", at(u1 - reach, ys(base + reach * t), v), at(u1 + o, ys(base - o * t), v), RAFTER);
      }
    }
  }

  /* ceiling joists, spanning the short way, except over a raked ceiling */
  const shortIsV = v1 - v0 <= u1 - u0;
  const y = base + JOIST.h / 2;
  const [a0, a1, b0, b1] = shortIsV ? [u0, u1, v0, v1] : [v0, v1, u0, u1];
  for (const a of span(a0 + 0.05, a1 - 0.05, JOISTS_AT)) {
    /* walk across, keeping the stretches that aren't raked */
    let from: number | null = null;
    const steps = Math.max(2, Math.ceil((b1 - b0) / 0.1));
    for (let i = 0; i <= steps; i++) {
      const b = b0 + ((b1 - b0) * i) / steps;
      const p = shortIsV ? at(a, y, b) : at(b, y, a);
      const open = !raked(p[0], p[2]);
      if (open && from === null) from = b;
      if ((!open || i === steps) && from !== null) {
        const end = open ? b : b - (b1 - b0) / steps;
        if (end - from > 0.3) put("joist", shortIsV ? at(a, y, from) : at(from, y, a), shortIsV ? at(a, y, end) : at(end, y, a), JOIST);
        from = null;
      }
    }
  }
  return out;
}
