import type { ReadPoint, ReadSpace } from "../reading";
import type { Fill, Line } from "./fills";

/* THE PICTURE READ'S ROOMS PUT ON THE DRAWING'S OWN LINES. Where the walls
   can't be closed off from the file (drawn in lines, a stair or a bench in
   the way, a renovation's walls half filled), the read by picture still finds
   nearly every room, its sides 90 to 120 mm out (3570's baseline, 21 November
   2026). Each side square to the page is moved onto the nearest line the
   file draws along it, within a wall's thickness and a little: a wall's face,
   a fill's edge. A side with no such line stays where it was read. Pure. */

type Run = { at: number; from: number; to: number };
/** A wall found as two faces: its lines' places across it (near, far), and how far it runs. */
type Band = { a: number; b: number; from: number; to: number };
export type Faces = { h: Band[]; v: Band[] };

const lightness = (c: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(c);
  if (!m) return 0;
  return (parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16)) / (3 * 255);
};

/** The walls a room's side can stand on, in page points: two dark lines (a
    stroke, a fill's edge) running the same way a wall's thickness apart
    (`lo` to `hi` points), along each other for at least `shortest`. A lone
    line (a bench, a dimension, a rug) is no wall. */
export function facesOf(lines: readonly Line[], fills: readonly Fill[], shortest: number, lo: number, hi: number): Faces {
  const h: Run[] = [];
  const v: Run[] = [];
  const add = (a: [number, number], b: [number, number]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < shortest) return;
    if (Math.abs(b[1] - a[1]) <= len * 0.02) h.push({ at: (a[1] + b[1]) / 2, from: Math.min(a[0], b[0]), to: Math.max(a[0], b[0]) });
    else if (Math.abs(b[0] - a[0]) <= len * 0.02) v.push({ at: (a[0] + b[0]) / 2, from: Math.min(a[1], b[1]), to: Math.max(a[1], b[1]) });
  };
  for (const l of lines) if (lightness(l.colour) <= 0.6) add(l.a, l.b);
  for (const f of fills) if (lightness(f.colour) <= 0.6) for (const r of f.rings) for (let i = 0; i < r.length; i++) add(r[i], r[(i + 1) % r.length]);
  const bands = (runs: Run[]): Band[] => {
    const sorted = [...runs].sort((a, b) => a.at - b.at);
    const out: Band[] = [];
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) {
        const d = sorted[j].at - sorted[i].at;
        if (d < lo) continue;
        if (d > hi) break;
        const from = Math.max(sorted[i].from, sorted[j].from);
        const to = Math.min(sorted[i].to, sorted[j].to);
        if (to - from >= shortest) out.push({ a: sorted[i].at, b: sorted[j].at, from, to });
      }
    return out.sort((x, y) => x.a - y.a);
  };
  return { h: bands(h), v: bands(v) };
}

/* the face a side stands on: of the walls along most of it within `tol`
   (a wall's pieces either side of its doors and windows counted together),
   the nearest; of that wall's two faces, the one on the room's side */
function nearest(bands: readonly Band[], at: number, from: number, to: number, tol: number, centre: number): number | null {
  const along = new Map<string, { a: number; b: number; len: number }>();
  for (const w of bands) {
    if (w.a > at + tol) break;
    if (w.b < at - tol) continue;
    const len = Math.min(w.to, to) - Math.max(w.from, from);
    if (len <= 0) continue;
    const k = `${Math.round(w.a * 4)}:${Math.round(w.b * 4)}`;
    const g = along.get(k) ?? { a: w.a, b: w.b, len: 0 };
    g.len += len;
    along.set(k, g);
  }
  let best: { d: number; face: number } | null = null;
  for (const w of along.values()) {
    if (w.len < (to - from) * 0.5) continue;
    const d = at >= w.a && at <= w.b ? 0 : Math.min(Math.abs(at - w.a), Math.abs(at - w.b));
    if (d > tol) continue;
    const face = Math.abs(centre - w.a) < Math.abs(centre - w.b) ? w.a : w.b;
    if (!best || d < best.d || (d === best.d && Math.abs(face - at) < Math.abs(best.face - at))) best = { d, face };
  }
  return best ? best.face : null;
}

/** Each room's square sides moved onto the drawing's nearest line along them.
    `pxPerPt`: the room's pixels a page point; `tol`: how far a side may move, in points. */
export function snapped(spaces: readonly ReadSpace[], faces: Faces, pxPerPt: number, tol: number): { spaces: ReadSpace[]; moved: number; sides: number } {
  let moved = 0;
  let sides = 0;
  const out = spaces.map((s) => {
    const pts = s.outline ?? [];
    const n = pts.length;
    if (n < 3) return s;
    const P = pts.map((p) => ({ x: p.x / pxPerPt, y: p.y / pxPerPt }));
    const cx = P.reduce((t, p) => t + p.x, 0) / n;
    const cy = P.reduce((t, p) => t + p.y, 0) / n;
    /* each side's new line: x for a side running up and down, y for one running across */
    const side = P.map((a, i) => {
      const b = P[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len <= 0) return null;
      if (Math.abs(b.y - a.y) <= len * 0.03) {
        sides++;
        const y = nearest(faces.h, (a.y + b.y) / 2, Math.min(a.x, b.x), Math.max(a.x, b.x), tol, cy);
        if (y !== null) moved++;
        return y === null ? null : { y };
      }
      if (Math.abs(b.x - a.x) <= len * 0.03) {
        sides++;
        const x = nearest(faces.v, (a.x + b.x) / 2, Math.min(a.y, b.y), Math.max(a.y, b.y), tol, cx);
        if (x !== null) moved++;
        return x === null ? null : { x };
      }
      return null;
    });
    /* a corner takes its x from the side running up and down beside it, its y from the one running across */
    const outline: ReadPoint[] = P.map((p, i) => {
      const before = side[(i - 1 + n) % n];
      const after = side[i];
      const x = (before && "x" in before ? before.x : null) ?? (after && "x" in after ? after.x : null) ?? p.x;
      const y = (before && "y" in before ? before.y : null) ?? (after && "y" in after ? after.y : null) ?? p.y;
      return { x: Math.round(x * pxPerPt), y: Math.round(y * pxPerPt) };
    });
    return { ...s, outline };
  });
  return { spaces: out, moved, sides };
}
