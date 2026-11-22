import type { ReadSpace } from "../../reading";
import type { Fill, Line, Ring } from "../fills";

/* A MADE-UP PLAN OF `n` BY `n` ROOMS, as big as a test wants: its walls
   drawn twice over, filled (walls.ts) and as their two faces in lines
   (lines.ts, snap.ts), each wall broken for a door and drawn in pieces, some
   a hair apart across; and what else a sheet draws round them: stair
   treads, furniture's edges, dimension lines, pale hatching and paving, new
   walls in colour, a legend's box, small dark shapes against the walls.
   With each room as a read by picture gives it, a few points out. Seeded,
   so the same every run. In page points at 1:100; the rooms in pixels two
   a point. */

const rand = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const box = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

export function generatedPlan(n: number, seed = 1): { fills: Fill[]; lines: Line[]; rooms: ReadSpace[]; width: number; height: number } {
  const r = rand(seed);
  const between = (a: number, b: number) => a + (b - a) * r();
  const T = 4;
  const xs = [40];
  const ys = [40];
  for (let i = 0; i < n; i++) {
    xs.push(xs[i] + T + between(60, 120));
    ys.push(ys[i] + T + between(60, 120));
  }
  const fills: Fill[] = [];
  const lines: Line[] = [];
  const dark = (a: [number, number], b: [number, number], colour = "#000000") => lines.push({ colour, width: 0.5, a, b });
  /* one wall from `from` to `to` along, its near face at `at` across; `h` when it runs across the page */
  const wall = (h: boolean, at: number, from: number, to: number) => {
    const P = (u: number, v: number): [number, number] => (h ? [u, v] : [v, u]);
    /* a door in it, half the time */
    const pieces: [number, number][] = [];
    if (to - from > 60 && r() < 0.5) {
      const d = between(from + 10, to - 40);
      pieces.push([from, d], [d + between(20, 30), to]);
    } else pieces.push([from, to]);
    const colour = r() < 0.05 ? "#ffd700" : "#808080";
    for (const [a, b] of pieces) {
      fills.push({ colour, rings: [h ? box(a, at, b, at + T) : box(at, a, at + T, b)] });
      /* each face in one to three pieces, now and then a billionth of a point off */
      for (const face of [at, at + T]) {
        const cuts = [a, ...Array.from({ length: Math.floor(r() * 3) }, () => between(a, b)).sort((p, q) => p - q), b];
        for (let k = 0; k + 1 < cuts.length; k++) {
          const off = r() < 0.3 ? 1e-9 : 0;
          dark(P(cuts[k], face + off), P(cuts[k + 1], face + off));
        }
      }
    }
  };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j < n; j++) {
      wall(true, ys[i], xs[j], xs[j + 1] + T);
      wall(false, xs[i], ys[j], ys[j + 1] + T);
    }
  }
  const rooms: ReadSpace[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const [x0, y0, x1, y1] = [xs[i] + T, ys[j] + T, xs[i + 1], ys[j + 1]];
      const roll = r();
      /* a stair's treads */
      if (roll < 0.05) for (let k = 0; k < 12; k++) dark([x0 + 5, y0 + 5 + k * 7], [x0 + 35, y0 + 5 + k * 7]);
      /* a bench, a bed: a box drawn in lines */
      else if (roll < 0.5) {
        const [bx, by] = [between(x0 + 5, x1 - 45), between(y0 + 5, y1 - 45)];
        const [bw, bh] = [between(10, 40), between(10, 40)];
        dark([bx, by], [bx + bw, by]);
        dark([bx + bw, by], [bx + bw, by + bh]);
        dark([bx + bw, by + bh], [bx, by + bh]);
        dark([bx, by + bh], [bx, by]);
      }
      /* hatching, too pale to be a wall */
      if (r() < 0.2) for (let k = 0; k < 8; k++) dark([x0 + k * 6, y0], [x0 + k * 6, y1], "#c8c8c8");
      /* a small dark shape against a wall, and one on its own */
      if (r() < 0.2) fills.push({ colour: "#808080", rings: [box(x0, y0, x0 + 3, y0 + 3)] });
      if (r() < 0.1) fills.push({ colour: "#808080", rings: [box(x0 + 20, y0 + 20, x0 + 23, y0 + 23)] });
      /* as the read by picture gives it, a few points out, two pixels a point */
      const j4 = () => between(-3, 3);
      const out = [
        [x0 + j4(), y0 + j4()],
        [x1 + j4(), y0 + j4()],
        [x1 + j4(), y1 + j4()],
        [x0 + j4(), y1 + j4()],
      ];
      rooms.push({ name: `Room ${i}.${j}`, named: true, kind: "room", written: "", existing: false, openTo: "", stair: "", outline: out.map(([x, y]) => ({ x: Math.round(x * 2), y: Math.round(y * 2) })) });
    }
  const [W, H] = [xs[n] + T + 40, ys[n] + T + 40];
  /* dimension lines round the building, with their ticks */
  for (let i = 0; i <= n; i++) {
    dark([xs[i], 20], [xs[i], 30]);
    dark([10, ys[i]], [20, ys[i]]);
  }
  dark([xs[0], 25], [xs[n], 25]);
  dark([15, ys[0]], [15, ys[n]]);
  /* paving outside, pale, and a legend's box */
  for (let i = 0; i < n; i++) fills.push({ colour: "#c0c0c0", rings: [box(xs[i], H - 30, xs[i] + 30, H - 10)] });
  fills.push({ colour: "#000000", rings: [box(W - 20, H - 20, W - 10, H - 10)] });
  return { fills, lines, rooms, width: W, height: H };
}
