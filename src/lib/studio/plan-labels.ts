/* WHERE THE PLAN'S WORDS GO (Isaac, 2026-09-30: "clashing titles … is it
   smart enough to know where it's been placed and if something's on top of
   it?"). It wasn't: a room's name sat on its centre and a pipe's length and
   size on the middle of its middle leg, whatever was already there, so a
   pipe running down through a room wrote over the room's name, and on a
   vertical pipe the words sat across the copper itself.

   Now every label is placed knowing what is under it. Rooms go first, each
   at its centre if that is clear, else the nearest clear spot inside the
   room; then each pipe's words, beside the pipe (above a level leg, to the
   side of an upright one) at the first place along it that is clear of the
   pipes, the units, the fittings and every word already down. Where nothing
   is clear, the least-crowded spot wins, so a label is never lost.

   One door for the screen and the paper (canvas.tsx, plan-figure.tsx): both
   hand in the same shapes and read back the same spots. Sizes are in px and
   `px` is how many world units a px is at the scale being drawn, so the
   words keep their size on screen at any zoom. Pure: no DOM, so the widths
   are estimated from the characters (a little generous, so a guess errs
   toward a gap rather than an overlap). */

import type { Point } from "./document";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** where a label's text goes: its anchor point (the first line's baseline)
    and which way it runs from there */
export interface LabelSpot {
  x: number;
  y: number;
  anchor: "middle" | "start" | "end";
}

export interface RoomLabelIn {
  id: string;
  polygon: Point[];
  /** where somebody put it by hand (the name's baseline, centred): it stays
      there, and everything else works round it */
  fixed?: Point;
  /** the name, then the area line, each with its font size in px */
  lines: { text: string; size: number }[];
  /** px between the first line's baseline and the second's */
  lineGap: number;
}

export interface RunLabelIn {
  id: string;
  points: Point[];
  text: string;
  size: number;
}

export interface PlanLabelsIn {
  rooms: RoomLabelIn[];
  runs: RunLabelIn[];
  /** things on the plan words must not sit on: units, fittings, boxes */
  solids: Box[];
  /** world units per px at this scale */
  px: number;
}

/** a placed label: its spot, and the box it covers (for a backing, a grab
    and a hit test) */
export interface PlacedLabel extends LabelSpot {
  box: Box;
}

export interface PlanLabels {
  rooms: Map<string, PlacedLabel>;
  runs: Map<string, PlacedLabel>;
}

/* a bold sans character, as a share of its size: wide enough for digits and
   capitals, so a guess leaves air rather than touching */
const CHAR_EM = 0.6;
const ASCENT = 0.78;
const DESCENT = 0.24;
/* the gap between a pipe and its words, px */
const PIPE_GAP = 6;
/* how far a pipe's copper counts as taken, px each side of its centre line */
const PIPE_HALF = 2.5;
/* air kept round every word, px */
const PAD = 2;

export const textWidthPx = (text: string, size: number): number => text.length * size * CHAR_EM;

/** the box a line of text covers, anchored at `at` (its baseline) */
function textBox(at: LabelSpot, w: number, size: number, px: number, lines = 1, lineGap = 0): Box {
  const width = w * px;
  const x0 = at.anchor === "middle" ? at.x - width / 2 : at.anchor === "start" ? at.x : at.x - width;
  return {
    x0: x0 - PAD * px,
    x1: x0 + width + PAD * px,
    y0: at.y - (ASCENT * size + PAD) * px,
    y1: at.y + ((lines - 1) * lineGap + DESCENT * size + PAD) * px,
  };
}

const overlapArea = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** does a segment, thickened by `half`, pass through a box? */
function segmentHits(a: Point, b: Point, box: Box, half: number): boolean {
  const bx = { x0: box.x0 - half, y0: box.y0 - half, x1: box.x1 + half, y1: box.y1 + half };
  /* Liang–Barsky: clip the segment to the box */
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: [number, number][] = [
    [-dx, a.x - bx.x0],
    [dx, bx.x1 - a.x],
    [-dy, a.y - bx.y0],
    [dy, bx.y1 - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

function inPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function centroidOf(poly: readonly Point[]): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    a += f;
    cx += (poly[j].x + poly[i].x) * f;
    cy += (poly[j].y + poly[i].y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

type Segment = [Point, Point];

export function layoutPlanLabels(input: PlanLabelsIn): PlanLabels {
  const { px } = input;
  const segments: Segment[] = input.runs.flatMap((r) =>
    r.points.slice(1).map((p, i) => [r.points[i], p] as Segment)
  );
  const placed: Box[] = [];
  /* how crowded a spot is: pipes and solids under it count heavily, other
     words by the area they share */
  const crowding = (box: Box): number => {
    let n = 0;
    for (const [a, b] of segments) if (segmentHits(a, b, box, PIPE_HALF * px)) n += 1e6;
    for (const s of input.solids) n += overlapArea(box, s) > 0 ? 1e6 : 0;
    for (const p of placed) n += overlapArea(box, p);
    return n;
  };
  const pick = <T>(candidates: { spot: T; box: Box }[]): { spot: T; box: Box } | null => {
    let best: { spot: T; box: Box; n: number } | null = null;
    for (const c of candidates) {
      const n = crowding(c.box);
      if (n === 0) return c;
      if (!best || n < best.n) best = { ...c, n };
    }
    return best;
  };

  const rooms = new Map<string, PlacedLabel>();
  const roomBlock = (r: RoomLabelIn, spot: LabelSpot): Box =>
    textBox(
      spot,
      Math.max(...r.lines.map((l) => textWidthPx(l.text, l.size))),
      r.lines[0].size,
      px,
      r.lines.length,
      r.lineGap
    );
  /* ── rooms placed by hand: where they were put, and the rest go round ── */
  for (const r of input.rooms) {
    if (!r.fixed || !r.lines.length) continue;
    const spot: LabelSpot = { x: r.fixed.x, y: r.fixed.y, anchor: "middle" };
    const box = roomBlock(r, spot);
    rooms.set(r.id, { ...spot, box });
    placed.push(box);
  }

  /* ── rooms: the centre, else the nearest clear spot inside ── */
  for (const r of input.rooms) {
    if (r.fixed || r.polygon.length < 3 || !r.lines.length) continue;
    const c = centroidOf(r.polygon);
    const size = r.lines[0].size;
    const w = Math.max(...r.lines.map((l) => textWidthPx(l.text, l.size)));
    const lines = r.lines.length;
    const blockH = (ASCENT * size + (lines - 1) * r.lineGap + DESCENT * size) * px;
    const stepX = (w / 2 + PAD * 4) * px;
    const stepY = blockH + PAD * 2 * px;
    const candidates: { spot: LabelSpot; box: Box; d: number }[] = [];
    for (let i = -4; i <= 4; i++)
      for (let j = -3; j <= 3; j++) {
        const spot: LabelSpot = { x: c.x + i * stepX, y: c.y + j * stepY, anchor: "middle" };
        const box = textBox(spot, w, size, px, lines, r.lineGap);
        /* the whole block stays inside the room */
        const corners = [
          { x: box.x0, y: box.y0 },
          { x: box.x1, y: box.y0 },
          { x: box.x0, y: box.y1 },
          { x: box.x1, y: box.y1 },
        ];
        if ((i || j) && !corners.every((p) => inPolygon(p, r.polygon))) continue;
        candidates.push({ spot, box, d: Math.hypot(i * stepX, j * stepY * 1.4) });
      }
    candidates.sort((a, b) => a.d - b.d);
    const got = pick(candidates)!;
    rooms.set(r.id, { ...got.spot, box: got.box });
    placed.push(got.box);
  }

  /* ── pipes: beside the copper, sliding along it to a clear spot ── */
  const runs = new Map<string, PlacedLabel>();
  for (const r of input.runs) {
    const pts = r.points;
    if (pts.length < 2 || !r.text) continue;
    const w = textWidthPx(r.text, r.size);
    const midI = Math.floor((pts.length - 1) / 2);
    /* the middle leg first (where it always went), then the rest, longest first */
    const legs = pts
      .slice(1)
      .map((p, i) => ({ i, a: pts[i], b: p, len: Math.hypot(p.x - pts[i].x, p.y - pts[i].y) }))
      .filter((l) => l.len > 0)
      .sort((x, y) => (x.i === midI ? -1 : y.i === midI ? 1 : y.len - x.len));
    const candidates: { spot: LabelSpot; box: Box }[] = [];
    for (const leg of legs) {
      const level = Math.abs(leg.b.x - leg.a.x) >= Math.abs(leg.b.y - leg.a.y);
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8, 0.08, 0.92]) {
        const p = { x: leg.a.x + (leg.b.x - leg.a.x) * t, y: leg.a.y + (leg.b.y - leg.a.y) * t };
        const sides: LabelSpot[] = level
          ? [
              { x: p.x, y: p.y - PIPE_GAP * px - DESCENT * r.size * px, anchor: "middle" },
              { x: p.x, y: p.y + PIPE_GAP * px + ASCENT * r.size * px, anchor: "middle" },
            ]
          : [
              { x: p.x + PIPE_GAP * px, y: p.y + 0.35 * r.size * px, anchor: "start" },
              { x: p.x - PIPE_GAP * px, y: p.y + 0.35 * r.size * px, anchor: "end" },
            ];
        for (const spot of sides) candidates.push({ spot, box: textBox(spot, w, r.size, px) });
      }
    }
    const got = pick(candidates);
    if (!got) continue;
    runs.set(r.id, { ...got.spot, box: got.box });
    placed.push(got.box);
  }
  return { rooms, runs };
}

/* a unit's symbol reaches a little past its footprint: a ducted head's
   flanges and spigots stand off its supply and return faces (canvas.tsx
   unitGlyph), so a name kept off the footprint alone sat on the flange
   (Walk A, Level 1: "Zone 6" on its PEFY) */
const SYMBOL_REACH = 0.12;

/** the box a unit's symbol covers, turned by `rotDeg` about its centre:
    its footprint, grown by what the symbol draws past it */
export function footprintBox(at: Point, w: number, h: number, rotDeg = 0): Box {
  const rad = (rotDeg * Math.PI) / 180;
  const reach = SYMBOL_REACH * Math.max(w, h);
  const hw = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2 + reach;
  const hh = (Math.abs(Math.sin(rad)) * w + Math.abs(Math.cos(rad)) * h) / 2 + reach;
  return { x0: at.x - hw, y0: at.y - hh, x1: at.x + hw, y1: at.y + hh };
}

/* A ROOM'S LABEL PLACED BY HAND is kept on the room as an offset from its
   centre (props.labelAt), so moving or reshaping the room carries the label
   with it, and the screen and the paper read it the same way. */
export function roomLabelFixed(props: Record<string, unknown>, polygon: readonly Point[]): Point | undefined {
  const v = props.labelAt as { dx?: unknown; dy?: unknown } | undefined;
  if (!v || typeof v.dx !== "number" || typeof v.dy !== "number" || polygon.length < 3) return undefined;
  const c = centroidOf(polygon);
  return { x: c.x + v.dx, y: c.y + v.dy };
}

/** the offset to store for a label put at `at` */
export function roomLabelOffset(at: Point, polygon: readonly Point[]): { dx: number; dy: number } {
  const c = centroidOf(polygon);
  return { dx: at.x - c.x, dy: at.y - c.y };
}
