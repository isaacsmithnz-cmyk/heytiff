import { boxOf, type Fill, type Ring } from "./fills";

/* WHICH FILLS ARE THE WALLS. A plan fills its walls in one shade (3570 grey
   #808080, Frogmore black with its new walls yellow, Cutler's new walls
   #7f7f7f) and fills other things too: paving, hatching, a legend's boxes,
   the title block. A wall is a long thin shape: as thick as a wall is (70 to
   650 mm of building) and far longer than it is thick. The darkest colour
   whose shapes are mostly that is the walls; another colour joins it when its
   wall-like shapes meet those walls (new walls beside existing). Pure. */

export type Walls = {
  colours: string[];
  /** each a filled shape, its outlines even-odd, in page points */
  shapes: Ring[][];
  /** a typical wall's thickness, in page points */
  thickness: number;
};

const ringArea = (r: Ring) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i];
    const [x1, y1] = r[(i + 1) % r.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
};
const ringLength = (r: Ring) => {
  let p = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i];
    const [x1, y1] = r[(i + 1) % r.length];
    p += Math.hypot(x1 - x0, y1 - y0);
  }
  return p;
};

/** How thick a ring is (2·area/perimeter: a bar's thickness) and how long for
    its area (perimeter²/16·area: a square is 1, a bar ten times as long as
    thick is about 3). */
export function shapeOf(r: Ring): { thick: number; long: number; length: number } {
  const a = ringArea(r);
  const p = ringLength(r);
  if (a <= 0 || p <= 0) return { thick: 0, long: 0, length: 0 };
  return { thick: (2 * a) / p, long: (p * p) / (16 * a), length: p / 2 };
}

const lightness = (c: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(c);
  if (!m) return 1;
  return (parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16)) / (3 * 255);
};

/* a bar at least two and a half times as long as it is thick: the piece of wall beside a door is often no longer */
const LONG = 1.25;

/* a colour, not a grey: plans mark new walls in colour */
const coloured = (c: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(c);
  if (!m) return false;
  const v = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return Math.max(...v) - Math.min(...v) > 40;
};

const near = (a: [number, number, number, number], b: [number, number, number, number], d: number) =>
  a[0] <= b[2] + d && b[0] <= a[2] + d && a[1] <= b[3] + d && b[1] <= a[3] + d;

/** The walls among a page's fills, or null when no colour's shapes look like
    walls (a plan drawn in lines, a scanned sheet pasted in). `mmPerPt`: the
    building's millimetres a page point, when the scale is known. */
export function wallsOf(fills: readonly Fill[], mmPerPt: number | null): Walls | null {
  /* a wall's thickness in points: 70 to 650 mm, or at an unknown scale
     anything from 1:50 to 1:200 */
  const [lo, hi] = mmPerPt ? [70 / mmPerPt, 650 / mmPerPt] : [35 / 35.28, 1300 / 35.28];
  type Piece = { ring: Ring; box: [number, number, number, number]; thick: number; length: number; wall: boolean };
  const by = new Map<string, { fills: Fill[]; pieces: Piece[] }>();
  for (const f of fills) {
    if (lightness(f.colour) > 0.9) continue;
    const g = by.get(f.colour) ?? { fills: [], pieces: [] };
    g.fills.push(f);
    for (const ring of f.rings) {
      const s = shapeOf(ring);
      g.pieces.push({ ring, box: boxOf([ring]), thick: s.thick, length: s.length, wall: s.thick >= lo && s.thick <= hi && s.long >= LONG });
    }
    by.set(f.colour, g);
  }
  const candidates = [...by.entries()]
    .map(([colour, g]) => {
      const walls = g.pieces.filter((p) => p.wall);
      return { colour, g, walls, length: walls.reduce((n, p) => n + p.length, 0), share: g.pieces.length ? walls.length / g.pieces.length : 0 };
    })
    .filter((c) => c.walls.length >= 10 && c.share >= 0.3);
  if (!candidates.length) return null;
  const most = Math.max(...candidates.map((c) => c.length));
  /* the darkest with a real share of the walling: paving and hatching are paler than walls */
  const first = candidates.filter((c) => c.length >= most * 0.25).sort((a, b) => lightness(a.colour) - lightness(b.colour))[0];
  const thick = [...first.walls.map((p) => p.thick)].sort((a, b) => a - b)[Math.floor(first.walls.length / 2)];
  /* another colour whose shapes are mostly walls joins it, where it meets
     those walls or carries a real share of the walling itself (Frogmore's
     new walls in yellow beside its existing ones in black). A grey that
     doesn't meet them is paving or a roof's hatching (3570's level 1) */
  const chosen = [first];
  for (const c of candidates) {
    if (c === first) continue;
    const meets = c.walls.filter((p) => first.walls.some((q) => near(p.box, q.box, thick * 1.5))).length;
    if (meets >= c.walls.length * 0.25 || (coloured(c.colour) && c.length >= first.length * 0.15)) chosen.push(c);
  }
  /* every piece of the chosen colours stays, but one on its own that isn't
     wall-like: a legend's box, a section arrow, a title block's swatch */
  const pieces = chosen.flatMap((c) => c.g.pieces);
  const shapes: Ring[][] = [];
  for (const c of chosen)
    for (const f of c.g.fills) {
      const keep = f.rings.filter((ring) => {
        const p = pieces.find((q) => q.ring === ring);
        if (!p || p.wall) return true;
        return pieces.some((q) => q !== p && near(p.box, q.box, thick * 0.5));
      });
      if (keep.length) shapes.push(keep);
    }
  return { colours: chosen.map((c) => c.colour), shapes, thickness: thick };
}
