/* A ROOM'S LABEL IS A TAB ON ITS WALL (Isaac, 2026-10-07: "attach to the edge
   of the rooms like how the tool helper does, it can move freely around the
   perimeter dynamically adjusting its shape" — mocked, then "dashed colour,
   build it").

   The name and area sit in a tab INSIDE the room, flush against one wall, the
   way the tool hint hangs off the canvas: square where it meets a wall, the
   wall flaring into it, rounded on the corners that face the room. In the
   middle of a run it hugs one wall; slid into a corner it tucks in, square on
   both; at an inside corner (an L turning in) it stops a flare short rather
   than run across open floor. Its edge is dashed in the room's colour — a
   solid one read as part of the wall and made the room look a different
   shape. The middle of every room is left to the plan's own words.

   Pure geometry, no DOM, so the canvas, the printed figure and the tests lay
   a tab out through these same functions. Sizes are in px and `px` is how
   many world units a px is at the scale being drawn (plan-labels.ts). */

import type { Point } from "./document";

export interface TabSides {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/** A tab placed on a room: its box (world units, axis-aligned), the sides of
    it that lie on a wall, and where on the room's perimeter it sits. */
export interface RoomTab {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  att: TabSides;
  /** distance round the perimeter, clockwise from the polygon's first point,
      of the tab's middle — snapped, so a tab tucked into a corner reads as
      sitting there */
  s: number;
  /** the perimeter's length */
  P: number;
}

/* the tab, in px */
export const TAB_PAD_X = 12;
export const TAB_PAD_T = 8;
export const TAB_PAD_B = 8;
/** its corners that face the room */
export const TAB_RADIUS = 9;
/** the flare where a wall runs into it */
export const TAB_FLARE = 7;
/** how close to a corner, along the wall, before it tucks in */
export const TAB_SNAP = 22;

/* ── the words' width ──
   Plus Jakarta Sans at 700, measured glyph by glyph in the browser (em):
   paper is drawn without a DOM to measure it in, and a tab a fifth too wide
   reads as a box somebody forgot to fit. 600 runs about 2% narrower. */
const EM_700: Record<string, number> = {
  " ": 0.18, "!": 0.37, '"': 0.5, "#": 0.91, $: 0.65, "%": 1.05, "&": 0.79, "'": 0.31, "(": 0.38, ")": 0.38,
  "*": 0.54, "+": 0.66, ",": 0.36, "-": 0.6, ".": 0.38, "/": 0.51, ":": 0.38, ";": 0.4, "<": 0.66, "=": 0.66,
  ">": 0.66, "?": 0.58, "@": 0.93, "[": 0.42, "\\": 0.51, "]": 0.42, "^": 0.66, _: 0.66, "`": 0.38, "{": 0.4,
  "|": 0.39, "}": 0.4, "~": 0.66, "²": 0.41, "×": 0.66, "–": 0.66, "⤢": 0.56,
  0: 0.71, 1: 0.4, 2: 0.6, 3: 0.61, 4: 0.65, 5: 0.61, 6: 0.6, 7: 0.56, 8: 0.63, 9: 0.6,
  A: 0.71, B: 0.69, C: 0.77, D: 0.74, E: 0.59, F: 0.59, G: 0.81, H: 0.73, I: 0.28, J: 0.39, K: 0.68, L: 0.54,
  M: 0.89, N: 0.74, O: 0.88, P: 0.65, Q: 0.88, R: 0.66, S: 0.65, T: 0.54, U: 0.72, V: 0.7, W: 1.02, X: 0.66,
  Y: 0.66, Z: 0.57,
  a: 0.58, b: 0.67, c: 0.61, d: 0.67, e: 0.61, f: 0.41, g: 0.65, h: 0.59, i: 0.25, j: 0.25, k: 0.58, l: 0.25,
  m: 0.92, n: 0.59, o: 0.65, p: 0.67, q: 0.67, r: 0.37, s: 0.51, t: 0.41, u: 0.59, v: 0.57, w: 0.88, x: 0.56,
  y: 0.59, z: 0.48,
};
const EM_UNKNOWN = 0.62;

/** a line's width in px, in the face the plan is set in */
export function wordsWidthPx(text: string, size: number, weight: 600 | 700 = 700): number {
  let em = 0;
  for (const ch of text) em += EM_700[ch] ?? EM_UNKNOWN;
  return em * size * (weight === 600 ? 0.976 : 1);
}

export interface TabLine {
  text: string;
  size: number;
  weight?: 600 | 700;
}

/** The tab's size in px for its lines (first line's baseline, then `lineGap`
    to each next), with `extraW` px beside the words for anything else it
    carries (a zone's system dots). */
export function tabSizePx(
  lines: TabLine[],
  lineGap: number,
  extraW = 0
): { w: number; h: number; firstBaseline: number } {
  const first = lines[0]?.size ?? 13;
  const last = lines[lines.length - 1]?.size ?? first;
  const words = Math.max(0, ...lines.map((l) => wordsWidthPx(l.text, l.size, l.weight ?? 700)));
  const firstBaseline = TAB_PAD_T + first * 0.92;
  return {
    w: Math.ceil(words + extraW + TAB_PAD_X * 2),
    h: Math.ceil(firstBaseline + (lines.length - 1) * lineGap + last * 0.3 + TAB_PAD_B),
    firstBaseline,
  };
}

/* ── the walls ── */

interface Wall {
  a: Point;
  b: Point;
  L: number;
  dir: Point;
  /** into the room */
  n: Point;
  s0: number;
  /** level or plumb — the only walls a tab sits on: its words run level */
  axis: boolean;
  /** the corner it starts / ends at is a square outside one a tab can tuck into */
  startSquare: boolean;
  endSquare: boolean;
}

export interface Walls {
  walls: Wall[];
  P: number;
}

/** within a degree of level or plumb counts as level or plumb */
const AXIS_TOL = 0.0175;

/** A room's walls, walked CLOCKWISE on screen from its first point — the way
    round a tab's position is measured, whichever way the room was drawn. */
export function wallsOf(polygon: readonly Point[]): Walls {
  const pts: Point[] = [];
  for (const p of polygon) {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) pts.push(p);
  }
  if (pts.length > 1) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) <= 1e-6) pts.pop();
  }
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  // positive in y-down screen space is clockwise; keep the first point first
  const cw = area2 >= 0 ? pts : [pts[0], ...pts.slice(1).reverse()];
  const walls: Wall[] = [];
  let s = 0;
  for (let i = 0; i < cw.length; i++) {
    const a = cw[i];
    const b = cw[(i + 1) % cw.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-9) continue;
    const dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    walls.push({
      a,
      b,
      L,
      dir,
      n: { x: -dir.y, y: dir.x },
      s0: s,
      axis: Math.abs(dir.x) < AXIS_TOL || Math.abs(dir.y) < AXIS_TOL,
      startSquare: false,
      endSquare: false,
    });
    s += L;
  }
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const next = walls[(i + 1) % walls.length];
    const turn = w.dir.x * next.dir.y - w.dir.y * next.dir.x;
    const square = w.axis && next.axis && turn > 0.99;
    w.endSquare = square;
    next.startSquare = square;
  }
  return { walls, P: s };
}

const wrap = (s: number, P: number) => ((s % P) + P) % P;

/** the wall a perimeter distance falls on */
function wallAt(g: Walls, s: number): number {
  const i = g.walls.findIndex((w) => s >= w.s0 && s < w.s0 + w.L);
  return i < 0 ? g.walls.length - 1 : i;
}

/** a tab's length along a wall and its reach into the room */
const along = (w: Wall, size: { w: number; h: number }) => (Math.abs(w.dir.y) < AXIS_TOL ? size.w : size.h);
const reach = (w: Wall, size: { w: number; h: number }) => (Math.abs(w.dir.y) < AXIS_TOL ? size.h : size.w);

/** can this wall carry the tab at all? */
const carries = (w: Wall, size: { w: number; h: number }) => w.axis && w.L >= along(w, size);

/**
 * The tab at perimeter distance `s` (world units), `size` in world units.
 * Null when no level or plumb wall of the room is long enough to carry it —
 * the caller then labels the room the old way, in its middle.
 */
export function placeTab(g: Walls, s: number, size: { w: number; h: number }, px: number): RoomTab | null {
  if (!g.walls.length || g.P <= 0) return null;
  const usable = g.walls.map((w) => carries(w, size));
  if (!usable.some(Boolean)) return null;
  s = wrap(s, g.P);
  let i = wallAt(g, s);
  /* off a wall it can't sit on (sloped, or too short): the nearest one that
     can, by the way round */
  if (!usable[i]) {
    let best = -1;
    let bestD = Infinity;
    g.walls.forEach((w, j) => {
      if (!usable[j]) return;
      const mid = w.s0 + w.L / 2;
      const d = Math.min(Math.abs(mid - s), g.P - Math.abs(mid - s)) - w.L / 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    i = best;
    const w = g.walls[i];
    s = Math.min(Math.max(s, w.s0), w.s0 + w.L);
  }
  const w = g.walls[i];
  const n = g.walls.length;
  const prev = g.walls[(i - 1 + n) % n];
  const next = g.walls[(i + 1) % n];
  const len = along(w, size);
  const depth = reach(w, size);
  const u = s - w.s0;
  const snap = TAB_SNAP * px;
  const flare = TAB_FLARE * px;
  /* tucked into a corner when it comes within a snap of one — and only a
     square outside corner whose other wall can take the tab's reach */
  let corner: "start" | "end" | null = null;
  if (u - len / 2 < snap && w.startSquare && prev.L >= depth) corner = "start";
  else if (u + len / 2 > w.L - snap && w.endSquare && next.L >= depth) corner = "end";
  let lo: number;
  if (corner === "start") lo = 0;
  else if (corner === "end") lo = w.L - len;
  else {
    /* any other corner stops it a flare short, so the flare stays on the wall */
    const minLo = w.startSquare ? 0 : flare;
    const maxLo = Math.max(w.endSquare ? w.L - len : w.L - len - flare, minLo);
    lo = Math.min(Math.max(u - len / 2, minLo), maxLo);
  }
  const at = (t: number, k: number) => ({ x: w.a.x + w.dir.x * t + w.n.x * k, y: w.a.y + w.dir.y * t + w.n.y * k });
  const c1 = at(lo, 0);
  const c2 = at(lo + len, depth);
  const box = {
    x0: Math.min(c1.x, c2.x),
    x1: Math.max(c1.x, c2.x),
    y0: Math.min(c1.y, c2.y),
    y1: Math.max(c1.y, c2.y),
  };
  const att: TabSides = { top: false, right: false, bottom: false, left: false };
  const lies = (wall: Wall) => {
    /* a wall within a degree of level is not quite at one height along its
       run, so it is matched within what that degree can drift over it */
    const tol = Math.max(px * 0.5, wall.L * AXIS_TOL, 1e-6);
    if (Math.abs(wall.dir.y) < AXIS_TOL) {
      const y = (wall.a.y + wall.b.y) / 2;
      if (Math.abs(box.y0 - y) < tol) att.top = true;
      if (Math.abs(box.y1 - y) < tol) att.bottom = true;
    } else {
      const x = (wall.a.x + wall.b.x) / 2;
      if (Math.abs(box.x0 - x) < tol) att.left = true;
      if (Math.abs(box.x1 - x) < tol) att.right = true;
    }
  };
  lies(w);
  if (corner === "start") lies(prev);
  if (corner === "end") lies(next);
  return { ...box, att, s: w.s0 + lo + len / 2, P: g.P };
}

/**
 * The tab's outline: walked clockwise, a corner between two walls is square,
 * a wall meeting a free side flares into it, and two free sides round off.
 * `edge` gives the stroke instead — the same walk with the runs along a wall
 * lifted, so the dashes trace only the tab's own sides and its flares.
 */
export function tabPath(t: RoomTab, px: number, edge = false): string {
  const R = TAB_RADIUS * px;
  const F = TAB_FLARE * px;
  const C: Point[] = [
    { x: t.x0, y: t.y0 },
    { x: t.x1, y: t.y0 },
    { x: t.x1, y: t.y1 },
    { x: t.x0, y: t.y1 },
  ];
  const sides = [t.att.top, t.att.right, t.att.bottom, t.att.left]; // side k runs C[k] → C[k+1]
  const dirs: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const pt = (p: Point) => `${r2(p.x)} ${r2(p.y)}`;
  const off = (k: number, d: number, m: number): Point => ({ x: C[k].x + dirs[d].x * m, y: C[k].y + dirs[d].y * m });
  const out: string[] = [];
  /** a straight run: drawn, or (for the edge, along a wall) only moved through */
  const run = (p: Point, onWall: boolean) => out.push(`${edge && onWall ? "M" : "L"} ${pt(p)}`);
  const arc = (r: number, sweep: 0 | 1, p: Point) => out.push(`A ${r2(r)} ${r2(r)} 0 0 ${sweep} ${pt(p)}`);
  const exit = (k: number): Point => {
    const aIn = sides[(k + 3) % 4];
    const aOut = sides[k];
    if (aIn && aOut) return C[k];
    if (aIn) return off(k, k, F);
    if (aOut) return off(k, k, -F);
    return off(k, k, R);
  };
  out.push(`M ${pt(exit(0))}`);
  for (const k of [1, 2, 3, 0]) {
    const inSide = (k + 3) % 4;
    const aIn = sides[inSide];
    const aOut = sides[k];
    if (aIn && aOut) run(C[k], true);
    else if (aIn) {
      // along the wall past the corner, then the flare back into the free side
      run(off(k, inSide, F), true);
      arc(F, 0, off(k, k, F));
    } else if (aOut) {
      // down the free side to the flare, which runs out onto the wall
      run(off(k, inSide, -F), false);
      arc(F, 0, off(k, k, -F));
    } else {
      run(off(k, inSide, -R), false);
      arc(R, 1, off(k, k, R));
    }
  }
  if (!edge) out.push("Z");
  return out.join(" ");
}

/** the point on a wall the tab could sit on nearest `p`, as a perimeter distance */
export function nearestTabS(g: Walls, p: Point, size: { w: number; h: number }): number | null {
  let best: { d: number; s: number } | null = null;
  for (const w of g.walls) {
    if (!carries(w, size)) continue;
    const t = Math.min(Math.max((p.x - w.a.x) * w.dir.x + (p.y - w.a.y) * w.dir.y, 0), w.L);
    const q = { x: w.a.x + w.dir.x * t, y: w.a.y + w.dir.y * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d) best = { d, s: w.s0 + t };
  }
  return best ? best.s : null;
}

/**
 * Where a tab goes when nobody has put it anywhere: each square corner the
 * room has, top-left first, then the middle of each wall, top first — the
 * first that sits clear of everything `crowding` scores, else the least
 * crowded. A corner first because a tab tucked into one covers the least of
 * the room.
 */
export function autoTabS(
  g: Walls,
  size: { w: number; h: number },
  px: number,
  crowding: (t: RoomTab) => number
): number | null {
  const corners: { s: number; at: Point }[] = [];
  const mids: { s: number; at: Point }[] = [];
  for (const w of g.walls) {
    if (!carries(w, size)) continue;
    if (w.startSquare) corners.push({ s: w.s0, at: w.a });
    mids.push({ s: w.s0 + w.L / 2, at: { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 } });
  }
  const byTopLeft = (a: { at: Point }, b: { at: Point }) => a.at.y - b.at.y || a.at.x - b.at.x;
  const candidates = [...corners.sort(byTopLeft), ...mids.sort(byTopLeft)];
  let best: { s: number; n: number } | null = null;
  for (const c of candidates) {
    const t = placeTab(g, c.s, size, px);
    if (!t) continue;
    const n = crowding(t);
    if (n === 0) return t.s;
    if (!best || n < best.n) best = { s: t.s, n };
  }
  return best ? best.s : null;
}

/* ── kept on the room ──
   As a share of the way round (`props.labelEdge`, 0–1), not a distance: a
   room that is reshaped keeps its tab on about the same stretch of wall. */
export function storedTabS(props: Record<string, unknown>, g: Walls): number | null {
  const v = props.labelEdge;
  return typeof v === "number" && Number.isFinite(v) ? wrap(v, 1) * g.P : null;
}

export const tabShare = (s: number, P: number): number => (P > 0 ? Math.round((wrap(s, P) / P) * 1e6) / 1e6 : 0);
