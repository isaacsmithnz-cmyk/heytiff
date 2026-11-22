import type { Line, Ring } from "./fills";
import type { Walls } from "./walls";

/* WALLS DRAWN IN LINES. Many plans don't fill their walls: a wall is its two
   faces, two dark lines a wall's thickness apart (Folklore, 3570's lower
   ground, Ipsum's existing walls, hatched between). Two such lines that run
   the same way, face each other across 70 to 650 mm and overlap for longer
   than the wall is thick are one wall. Stair treads, a bench's edges, a
   dimension line and its neighbour pair up too; they are kept out by
   thickness (a plan has two or three wall thicknesses, and the walls are
   most of its paired length) and by meeting other walls. Square to the page
   only, for now. Pure. */

type Run = { at: number; from: number; to: number };

const lightness = (c: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(c);
  if (!m) return 0;
  return (parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16)) / (3 * 255);
};

/* one line's pieces along one coordinate made one run where they touch. The
   pieces lying within 0.15 of each other across are taken together first,
   then joined in turn along: a file draws one face as pieces a hair apart
   (100, then 100.000000001, then 100 again), and sorted by where they lie
   across, a piece came after a run that had started past it and was lost
   in it, leaving a hole in the wall where the drawing has none */
function runs(lines: { at: number; from: number; to: number }[], join: number): Run[] {
  const sorted = [...lines].sort((a, b) => a.at - b.at);
  const out: Run[] = [];
  for (let i = 0, j = 0; i < sorted.length; i = j) {
    while (j < sorted.length && sorted[j].at - sorted[i].at <= 0.15) j++;
    let last: Run | null = null;
    for (const l of sorted.slice(i, j).sort((a, b) => a.from - b.from)) {
      if (last && l.from <= last.to + join) last.to = Math.max(last.to, l.to);
      else out.push((last = { at: sorted[i].at, from: l.from, to: l.to }));
    }
  }
  return out;
}

type Band = { box: [number, number, number, number]; thick: number; length: number };

/* faces facing each other: for each run, the nearest run past it a wall's thickness away that overlaps it */
function pairs(rs: Run[], lo: number, hi: number, across: (r: Run, s: Run, from: number, to: number) => [number, number, number, number]): Band[] {
  const sorted = [...rs].sort((a, b) => a.at - b.at);
  const out: Band[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const d = b.at - a.at;
      if (d < lo) continue;
      if (d > hi) break;
      const from = Math.max(a.from, b.from);
      const to = Math.min(a.to, b.to);
      if (to - from < Math.max(d * 1.5, lo * 2)) continue;
      /* a stair's treads: the same line again the same step on, a ladder of them */
      const like = (at: number) => sorted.some((c) => Math.abs(c.at - at) <= d * 0.12 && Math.abs(c.from - a.from) <= d && Math.abs(c.to - a.to) <= d);
      if (!(like(b.at + d) || like(a.at - d))) out.push({ box: across(a, b, from, to), thick: d, length: to - from });
      break;
    }
  }
  return out;
}

const touch = (a: Band["box"], b: Band["box"], d: number) => a[0] <= b[2] + d && b[0] <= a[2] + d && a[1] <= b[3] + d && b[1] <= a[3] + d;

/** The walls a plan draws as pairs of lines, or null when it draws none. */
export function lineWalls(lines: readonly Line[], mmPerPt: number | null): Walls | null {
  const [lo, hi] = mmPerPt ? [70 / mmPerPt, 650 / mmPerPt] : [35 / 35.28, 1300 / 35.28];
  const h: Run[] = [];
  const v: Run[] = [];
  for (const l of lines) {
    if (lightness(l.colour) > 0.55) continue;
    const [x0, y0] = l.a;
    const [x1, y1] = l.b;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < lo) continue;
    if (Math.abs(y1 - y0) <= len * 0.025) h.push({ at: (y0 + y1) / 2, from: Math.min(x0, x1), to: Math.max(x0, x1) });
    else if (Math.abs(x1 - x0) <= len * 0.025) v.push({ at: (x0 + x1) / 2, from: Math.min(y0, y1), to: Math.max(y0, y1) });
  }
  const bands = [
    ...pairs(runs(h, lo * 0.5), lo, hi, (a, b, from, to) => [from, a.at, to, b.at]),
    ...pairs(runs(v, lo * 0.5), lo, hi, (a, b, from, to) => [a.at, from, b.at, to]),
  ];
  if (bands.length < 10) return null;

  /* the plan's wall thicknesses: the thicknesses most of the paired length has */
  const bin = lo / 4;
  const weight = new Map<number, number>();
  for (const b of bands) weight.set(Math.round(b.thick / bin), (weight.get(Math.round(b.thick / bin)) ?? 0) + b.length);
  const total = [...weight.values()].reduce((n, w) => n + w, 0);
  /* a thickness counts with its neighbours: one wall drawn a hair either side of its size */
  const near = (k: number) => (weight.get(k - 1) ?? 0) + (weight.get(k) ?? 0) + (weight.get(k + 1) ?? 0);
  const peaks = [...weight.keys()].filter((k) => near(k) >= total * 0.12 && near(k) >= near(k - 1) && near(k) >= near(k + 1));
  let walls = bands.filter((b) => peaks.some((k) => Math.abs(b.thick - k * bin) <= Math.max(bin * 1.5, k * bin * 0.15)));
  /* a wall meets another wall; a bench, a tread or a dimension on its own is none */
  const thick = [...walls.map((b) => b.thick)].sort((a, b) => a - b)[Math.floor(walls.length / 2)] ?? 0;
  walls = walls.filter((b) => walls.some((c) => c !== b && touch(b.box, c.box, thick * 0.6)));
  if (walls.length < 10) return null;
  const ring = ([x0, y0, x1, y1]: Band["box"]): Ring => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  /* each wall run on past its ends by its own thickness: two walls' lines stop
     at the inside of a corner, and the corner's square would be left open */
  const run = (b: Band): Band["box"] => {
    const [x0, y0, x1, y1] = b.box;
    const t = b.thick;
    return x1 - x0 >= y1 - y0 ? [x0 - t, y0, x1 + t, y1] : [x0, y0 - t, x1, y1 + t];
  };
  return { colours: ["lines"], shapes: walls.map((b) => [ring(run(b))]), thickness: thick };
}
