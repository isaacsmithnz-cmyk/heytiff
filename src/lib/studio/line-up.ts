import type { ReadSpace } from "./reading";

/* A DESIGN'S FLOORS STACK AS THE HOUSE DOES (Isaac, 26 November 2026,
   "review 3d build", then "Both" to lining them up). An architect draws
   each floor wherever it fits on its own sheet, so a page's picture puts
   the house somewhere different on every floor. Job 3608's lower ground
   sat 407 px (about 7 m) east of its ground floor, the subfloor and garage
   running off the side of the house in 3D, because every floor's sheet was
   placed at its page's corner. Here each floor is moved onto the one it
   stands on or under, by the shape Tiff read off each: the footprint that
   overlaps best. A floor already in line stays where it is, and a floor
   that fits inside the other many ways (an upper floor smaller than the
   ground) stays unless a shift is plainly better. Pure. */

type P = { x: number; y: number };
export type Shift = { dx: number; dy: number };

/** What a floor stands on: every space but a garden, a patio or a notch. */
const RAISED = /\b(balcony|deck|verandah|veranda|porch)\b/i;
export const footprintSpaces = (spaces: readonly ReadSpace[]): ReadSpace[] =>
  spaces.filter((s) => s.outline.length >= 3 && s.kind !== "notch" && (s.kind !== "outdoor" || RAISED.test(s.name)));

function inside(p: P, poly: readonly P[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/* a cell's key: its column and row as one number */
const K = 100_000;
const key = (x: number, y: number) => x * K + y;

/** The footprint as the cells of a grid `cell` across that it covers. */
export function cellsOf(polys: readonly (readonly P[])[], cell: number): Set<number> {
  const out = new Set<number>();
  for (const poly of polys) {
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    for (let gx = Math.floor(Math.min(...xs) / cell); gx <= Math.floor(Math.max(...xs) / cell); gx++)
      for (let gy = Math.floor(Math.min(...ys) / cell); gy <= Math.floor(Math.max(...ys) / cell); gy++)
        if (inside({ x: (gx + 0.5) * cell, y: (gy + 0.5) * cell }, poly)) out.add(key(gx, gy));
  }
  return out;
}

/** How well two footprints agree once `b` is moved by (sx, sy) cells: the
    overlap over the union. */
function agree(a: ReadonlySet<number>, b: ReadonlySet<number>, sx: number, sy: number): number {
  let both = 0;
  const by = key(sx, sy);
  for (const k of b) if (a.has(k + by)) both++;
  const union = a.size + b.size - both;
  return union === 0 ? 0 : both / union;
}

/** The best shift (in cells) of `b` onto `a`, searched within `reach` cells
    each way; ties go to the smallest shift, so a floor in line stays. */
function bestShift(a: ReadonlySet<number>, b: ReadonlySet<number>, reach: number, around: Shift = { dx: 0, dy: 0 }): Shift & { score: number } {
  let best = { dx: around.dx, dy: around.dy, score: agree(a, b, around.dx, around.dy) };
  for (let sx = around.dx - reach; sx <= around.dx + reach; sx++)
    for (let sy = around.dy - reach; sy <= around.dy + reach; sy++) {
      const score = agree(a, b, sx, sy);
      const nearer = Math.abs(sx) + Math.abs(sy) < Math.abs(best.dx) + Math.abs(best.dy);
      if (score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && nearer)) best = { dx: sx, dy: sy, score };
    }
  return best;
}

/** How far to move a floor (its page's units) so its footprint sits on the
    other floor's: null when it already does, or no shift is plainly better.
    `reach` is how far to look, in the page's units. */
export function lineUpShift(onto: readonly ReadSpace[], floor: readonly ReadSpace[], reach = 1400): Shift | null {
  const a = footprintSpaces(onto).map((s) => s.outline);
  const b = footprintSpaces(floor).map((s) => s.outline);
  if (a.length === 0 || b.length === 0) return null;
  /* coarse, then fine around the best coarse shift */
  const coarse = 32;
  const ca = cellsOf(a, coarse);
  const cb = cellsOf(b, coarse);
  const rough = bestShift(ca, cb, Math.ceil(reach / coarse));
  const fine = 8;
  const fa = cellsOf(a, fine);
  const fb = cellsOf(b, fine);
  const ratio = coarse / fine;
  const near = bestShift(fa, fb, ratio, { dx: rough.dx * ratio, dy: rough.dy * ratio });
  const stay = agree(fa, fb, 0, 0);
  /* moved only when it plainly fits better, and fits well */
  if (near.score < 0.5 || near.score < stay + 0.15) return null;
  const dx = near.dx * fine;
  const dy = near.dy * fine;
  return dx === 0 && dy === 0 ? null : { dx, dy };
}
