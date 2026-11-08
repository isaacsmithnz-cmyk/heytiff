/* WHAT THE 3D CHECKS FOR THE INSTALL (Isaac, 8 November 2026: "Build all,
   1-10"): how much room the roof space has over each room, and where a duct
   or pipe as drawn runs through the roof's timber. Pure: scene in, answers out.

   The framing is the standard one the 3D draws (rafters 140 deep at 600,
   ceiling joists 120 deep at 450), since a set seldom has a framing plan, so
   a clash is "through the standard framing", not the builder's. */

import { roofHeightAt } from "./roof3d";
import type { Scene3D, XZ } from "./scene3d";

type P3 = [number, number, number];

const RAFTER_DEPTH = 0.14;
const JOIST_DEPTH = 0.12;
const CELL = 0.5;

/** One patch of roof space over a room: where it is, the top of the joists, and the clear height above them, metres. */
export type SpaceCell = { floorId: string; x0: number; z0: number; x1: number; z1: number; y: number; clear: number };

/** How a clear height reads: under 300 mm nothing ducted fits; under 500 mm a slim one may; above, a ducted unit fits. */
export const roomFor = (clear: number): "none" | "slim" | "fits" => (clear < 0.3 ? "none" : clear < 0.5 ? "slim" : "fits");

function inPoly(p: XZ, poly: XZ[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** The roof space over every flat-ceilinged room with a roof above it, in half-metre patches. */
export function roofSpaceOf(scene: Scene3D): SpaceCell[] {
  const out: SpaceCell[] = [];
  for (const c of scene.ceilings) {
    const over = scene.roofRects.filter((r) => r.floorId === c.floorId && !r.part.existing);
    if (!over.length) continue;
    for (const room of c.flat) {
      const xs = room.pts.map((p) => p[0]);
      const zs = room.pts.map((p) => p[1]);
      const top = room.y + JOIST_DEPTH;
      for (let x = Math.min(...xs); x < Math.max(...xs) - 0.05; x += CELL)
        for (let z = Math.min(...zs); z < Math.max(...zs) - 0.05; z += CELL) {
          const x1 = Math.min(x + CELL, Math.max(...xs));
          const z1 = Math.min(z + CELL, Math.max(...zs));
          const mid: XZ = [(x + x1) / 2, (z + z1) / 2];
          if (!inPoly(mid, room.pts)) continue;
          const roof = Math.max(...over.map((r) => roofHeightAt(r, mid[0], mid[1])));
          if (!Number.isFinite(roof)) continue;
          const r3 = (v: number) => Math.round(v * 1000) / 1000;
          out.push({ floorId: c.floorId, x0: r3(x), z0: r3(z), x1: r3(x1), z1: r3(z1), y: r3(top), clear: r3(Math.max(0, roof - RAFTER_DEPTH - top)) });
        }
    }
  }
  return out;
}

/** The shortest distance between two segments, and the point on the first nearest the second. */
function nearest(p1: P3, q1: P3, p2: P3, q2: P3): { d: number; at: P3 } {
  const d1 = q1.map((v, i) => v - p1[i]) as P3;
  const d2 = q2.map((v, i) => v - p2[i]) as P3;
  const r = p1.map((v, i) => v - p2[i]) as P3;
  const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s = 0;
  let t = 0;
  if (a < 1e-9 && e < 1e-9) {
    s = 0;
    t = 0;
  } else if (a < 1e-9) {
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dot(d1, r);
    if (e < 1e-9) s = Math.min(1, Math.max(0, -c / a));
    else {
      const b = dot(d1, d2);
      const den = a * e - b * b;
      s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1 = p1.map((v, i) => v + d1[i] * s) as P3;
  const c2 = p2.map((v, i) => v + d2[i] * t) as P3;
  return { d: Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]), at: c1 };
}

/** A duct or pipe running through a rafter or joist: where, and what it is. */
export type Clash = { floorId: string; at: P3; what: "duct" | "pipe"; through: "rafter" | "joist" | "ridge" | "hip" };

/** Every place a duct or pipe as drawn passes through the standard framing, one mark per half metre. */
export function clashesOf(scene: Scene3D): Clash[] {
  const out: Clash[] = [];
  const runs = [...scene.ducts.map((d) => ({ floorId: d.floorId, pts: d.pts, r: d.r, what: "duct" as const })), ...scene.pipes.map((p) => ({ floorId: p.floorId, pts: p.pts, r: 0.03, what: "pipe" as const }))];
  for (const run of runs) {
    const members = scene.framing.filter((m) => m.floorId === run.floorId);
    for (let i = 1; i < run.pts.length; i++)
      for (const m of members) {
        const { d, at } = nearest(run.pts[i - 1], run.pts[i], m.a, m.b);
        /* touching a member's face is fine; into it by more than a couple of centimetres isn't */
        if (d < run.r + (m.w + m.h) / 4 - 0.02 && !out.some((c) => c.floorId === run.floorId && Math.hypot(c.at[0] - at[0], c.at[1] - at[1], c.at[2] - at[2]) < 0.5))
          out.push({ floorId: run.floorId, at: at.map((v) => Math.round(v * 1000) / 1000) as P3, what: run.what, through: m.k });
      }
  }
  return out;
}

/** The straight distance between two points, as a builder says it: "2.35 m", or "850 mm" under a metre. */
export function distanceWords(a: P3, b: P3): string {
  const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return d < 1 ? `${Math.round(d * 1000)} mm` : `${d.toFixed(2)} m`;
}
