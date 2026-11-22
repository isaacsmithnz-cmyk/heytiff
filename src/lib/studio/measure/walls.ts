/* THE WALLS, MEASURED OFF THE DRAWING ITSELF (Isaac, 21 November 2026, after
   job 3570's set was read by four models and none set every room on its
   walls: "build it robust as fuck", then "include all of that, build it").

   An architect's PDF draws its cut walls as one fill: a grey, or solid
   black. That fill is found here by its look alone (thick, long strokes of
   one shade), each sheet for itself, since two sheets of one set can use
   two greys (3570: its lower ground's walls are lighter than the floors
   above). The strokes become wall pieces, and the long ones line up into a
   grid of numbered lines that a room is then named between (rooms.ts).

   Nothing here asks a model anything: the same drawing gives the same
   walls every time. A drawing whose walls aren't a fill (two thin lines, a
   hatch, a scan) finds none and says so, and the read goes on by picture. */

/** A straight piece of wall: `c` its centre across, `a` to `b` its run, `t` its thickness; all pixels. */
export type WallSeg = {
  dir: "h" | "v";
  c: number;
  a: number;
  b: number;
  t: number;
};

/** The numbered lines the long walls stand on: x for upright walls, y for level ones. */
export type WallGrid = { x: number[]; y: number[] };

export type Walls = {
  /** the grey of the wall fill, 0 black to 255 white */
  shade: number;
  segs: WallSeg[];
  grid: WallGrid;
  /** how much wall was found, in pixels of run: what a caller judges "is this a drawing with walls" by */
  run: number;
};

export type WallSizes = {
  /** the thinnest and thickest stroke taken as a wall */
  thin: number;
  thick: number;
  /** the shortest run taken as a wall piece */
  short: number;
  /** the shortest piece a grid line is drawn through, and how much wall a line needs on it */
  long: number;
  line: number;
  /** pieces whose centres are this close stand on one line */
  near: number;
};

/** A wall's sizes in pixels: from the drawing's scale when it has one
    (walls run 70 to 600 mm thick), else from the raster's own width, taken
    as an A1 sheet at 1:100. */
export function wallSizes(width: number, mmPerPx: number | null): WallSizes {
  if (mmPerPx && mmPerPx > 0) {
    const px = (v: number) => v / mmPerPx;
    /* a stud wall is 90 mm, and its smoothed edges take a pixel off each side */
    return { thin: Math.max(3, px(50)), thick: Math.max(8, px(600)), short: Math.max(10, px(300)), long: Math.max(16, px(880)), line: Math.max(24, px(1400)), near: Math.max(3, px(180)) };
  }
  /* no scale: a sheet is drawn at 1:100 or 1:50 on A1 or A3, which puts a
     pixel between a quarter and a whole one of these; the limits are set
     wide enough for all four */
  const u = width / 1000;
  return { thin: 3, thick: Math.max(12, 16 * u), short: Math.max(10, 6 * u), long: Math.max(16, 11 * u), line: Math.max(24, 17 * u), near: Math.max(3, 3 * u) };
}

const SAT = 14;
const SPREAD = 5;
/* a wall's fill under something faint drawn over it (3570's lower ground,
   with the floor above ghosted across it) is a little off its shade: such
   pixels carry a run on, so long as most of the run is the shade itself */
const SOFT = 18;
const WHITE = 240;
const PALE = 225;

/** The greys a wall fill could be: the commonest unsaturated shades that aren't the paper. */
export function shadesOf(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): number[] {
  const hist = new Float64Array(256);
  const n = width * height;
  /* one pixel in four is plenty to count shades by */
  for (let i = 0; i < n; i += 4) {
    const o = i * 4;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const hi = r > g ? (r > b ? r : b) : g > b ? g : b;
    const lo = r < g ? (r < b ? r : b) : g < b ? g : b;
    if (hi - lo > SAT) continue;
    const v = (r + g + b) / 3;
    /* nothing paler than this is a wall: it is the paper, or a ghosted floor */
    if (v >= PALE) continue;
    hist[Math.round(v)]++;
  }
  const out: number[] = [];
  const taken = new Uint8Array(256);
  for (let k = 0; k < 6; k++) {
    let best = -1;
    let most = 0;
    for (let v = 0; v < 256; v++) {
      if (taken[v]) continue;
      /* a flat fill is one grey, or two neighbours where its edge is smoothed */
      const sum = 2 * hist[v] + (hist[v - 1] ?? 0) + (hist[v + 1] ?? 0);
      if (sum > most) {
        most = sum;
        best = v;
      }
    }
    /* a shade on fewer than one pixel in 2,500 holds no building's walls */
    if (best < 0 || most < n / 4 / 1250) break;
    out.push(best);
    for (let d = -SPREAD - 1; d <= SPREAD + 1; d++)
      if (best + d >= 0 && best + d < 256) taken[best + d] = 1;
  }
  return out;
}

type Run = { row: number; a: number; b: number };

/** One shade's pixels as a mask, row by row: 2 the shade itself, 1 near it. */
function maskOf(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  shade: number,
): Uint8Array {
  const m = new Uint8Array(width * height);
  for (let i = 0, o = 0; i < m.length; i++, o += 4) {
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const hi = r > g ? (r > b ? r : b) : g > b ? g : b;
    const lo = r < g ? (r < b ? r : b) : g < b ? g : b;
    if (hi - lo > SAT) continue;
    const v = (r + g + b) / 3;
    if (v >= shade - SPREAD && v <= shade + SPREAD) m[i] = 2;
    else if (v >= shade - SOFT && v <= shade + SOFT && v < WHITE) m[i] = 1;
  }
  return m;
}

/** The wall pieces lying one way. `at(line, i)` reads the mask along a line
    (a row for level walls, a column for upright ones). A piece is a band of
    long runs stacked on one another: its thickness is how many lines it
    spans, which is what tells a wall from a slab of fill. */
function bands(
  lines: number,
  len: number,
  at: (line: number, i: number) => number,
  z: WallSizes,
): { c: number; a: number; b: number; t: number }[] {
  /* every run of the band, until it is plainly too thick to be a wall */
  type Band = {
    as: number[];
    bs: number[];
    a: number;
    b: number;
    first: number;
    last: number;
    open: boolean;
  };
  const done: Band[] = [];
  let live: Band[] = [];
  const keep = z.thick + 2;
  for (let line = 0; line < lines; line++) {
    const runs: Run[] = [];
    let start = -1;
    let sure = 0;
    for (let i = 0; i <= len; i++) {
      const v = i < len ? at(line, i) : 0;
      if (v) {
        if (start < 0) {
          start = i;
          sure = 0;
        }
        if (v === 2) sure++;
      } else if (start >= 0) {
        if (i - start >= z.short && sure >= 0.5 * (i - start))
          runs.push({ row: line, a: start, b: i - 1 });
        start = -1;
      }
    }
    const next: Band[] = [];
    for (const r of runs) {
      /* the band this run carries on: one over it of much its own length.
         Of the LONGER of the two: where a wall meets another, the rows past
         it hold only the other wall's cross-section, a short run under a
         long one, and that is the wall ending, not carrying on (taking it
         for more of the same made both walls one slab too thick to be a
         wall, once a piece could be as short as a wall is thick) */
      const over = live.find((b) => b.open && b.last === line - 1 && Math.min(b.b, r.b) - Math.max(b.a, r.a) >= 0.6 * Math.max(b.b - b.a, r.b - r.a));
      if (over) {
        over.a = r.a;
        over.b = r.b;
        if (over.as.length < keep) {
          over.as.push(r.a);
          over.bs.push(r.b);
        }
        over.last = line;
        over.open = false;
        next.push(over);
      } else
        next.push({
          as: [r.a],
          bs: [r.b],
          a: r.a,
          b: r.b,
          first: line,
          last: line,
          open: false,
        });
    }
    for (const b of live) if (!next.includes(b)) done.push(b);
    for (const b of next) b.open = true;
    live = next;
  }
  done.push(...live);
  const mid = (v: number[]) => [...v].sort((p, q) => p - q)[v.length >> 1];
  const out: { c: number; a: number; b: number; t: number }[] = [];
  for (const b of done) {
    const t = b.last - b.first + 1;
    if (t < z.thin || t > z.thick) continue;
    /* a wall is a bar: its lines all run the same length, the middle one's.
       A wedge of hatching between two crossing lines (3570's paving, which
       out-ran the walls until this) has no two lines alike and is left out */
    const a = mid(b.as);
    const e = mid(b.bs);
    const slack = Math.max(2, t * 0.5);
    const alike = b.as.filter(
      (v, i) => Math.abs(v - a) <= slack && Math.abs(b.bs[i] - e) <= slack,
    ).length;
    if (alike < 0.6 * b.as.length) continue;
    if (e - a + 1 < z.short || e - a + 1 < 1.5 * t) continue;
    out.push({ c: (b.first + b.last) / 2, a, b: e, t });
  }
  return out;
}

/** Whether a bar has its own shade along both sides, a few pixels off: then
    it is a strip of some wider fill cut by drawn lines (paving, roof
    sheeting, a hatched slab), not a wall. A wall has a room on one side. */
function flanked(
  mask: Uint8Array,
  width: number,
  height: number,
  s: WallSeg,
): boolean {
  const off = Math.ceil(s.t / 2) + 4;
  const side = (c: number): number => {
    if (c < 0 || c >= (s.dir === "h" ? height : width)) return 0;
    let on = 0;
    let all = 0;
    for (let i = Math.round(s.a); i <= s.b; i += 2) {
      all++;
      if (mask[s.dir === "h" ? c * width + i : i * width + c] === 2) on++;
    }
    return all ? on / all : 0;
  };
  return (
    side(Math.round(s.c - off)) >= 0.5 && side(Math.round(s.c + off)) >= 0.5
  );
}

function segsOf(
  mask: Uint8Array,
  width: number,
  height: number,
  z: WallSizes,
): WallSeg[] {
  const h = bands(height, width, (y, x) => mask[y * width + x], z).map(
    (b): WallSeg => ({ dir: "h", ...b }),
  );
  const v = bands(width, height, (x, y) => mask[y * width + x], z).map(
    (b): WallSeg => ({ dir: "v", ...b }),
  );
  return [...h, ...v].filter((s) => !flanked(mask, width, height, s));
}

/** The lines the long pieces stand on: centres close together are one
    line, placed by the weight of wall on it, and a line needs a fair run
    of wall to count (a lone short return isn't one). */
export function gridOf(segs: readonly WallSeg[], z: WallSizes): WallGrid {
  const lines = (dir: "h" | "v"): number[] => {
    const long = segs
      .filter((s) => s.dir === dir && s.b - s.a + 1 >= z.long)
      .sort((p, q) => p.c - q.c);
    const found: { c: number; run: number }[] = [];
    let group: WallSeg[] = [];
    const close = () => {
      const run = group.reduce((n, s) => n + (s.b - s.a + 1), 0);
      if (run >= z.line) found.push({ c: group.reduce((n, s) => n + s.c * (s.b - s.a + 1), 0) / run, run });
      group = [];
    };
    for (const s of long) {
      if (group.length && s.c - group[group.length - 1].c > z.near) close();
      group.push(s);
    }
    if (group.length) close();
    /* two lines closer than a wall is thick can't be told apart on her
       picture (3570's were 7 to 9 of its pixels apart, and she swapped
       between them from one answer to the next): they are one numbered
       line. Each room's side still goes to its own wall's face, which is
       found from the pieces, not the line (rooms.ts) */
    const ts = long.map((s) => s.t).sort((p, q) => p - q);
    const fold = Math.max(z.near, ts.length ? ts[Math.floor(ts.length / 2)] : 0);
    const out: { c: number; run: number }[] = [];
    for (const l of found) {
      const last = out[out.length - 1];
      if (last && l.c - last.c < fold) {
        const run = last.run + l.run;
        out[out.length - 1] = { c: (last.c * last.run + l.c * l.run) / run, run };
      } else out.push({ ...l });
    }
    return out.map((l) => Math.round(l.c * 10) / 10);
  };
  return { x: lines("v"), y: lines("h") };
}

/** The pieces that meet another piece running the other way, at a corner
    or a T: what walls do and hatching doesn't. Boards, roof sheets and
    paving run side by side for metres and never turn a corner (3395's
    first floor, whose roof sheeting out-ran its stud walls until this). */
export function tiedOf(segs: readonly WallSeg[], z: WallSizes): WallSeg[] {
  return segs.filter((s) =>
    segs.some((p) => {
      if (p.dir === s.dir) return false;
      const reach = Math.max(z.near, s.t, p.t);
      return p.c >= s.a - reach && p.c <= s.b + reach && s.c >= p.a - reach && s.c <= p.b + reach;
    }),
  );
}

const runOf = (segs: readonly WallSeg[]) => segs.reduce((n, s) => n + (s.b - s.a + 1), 0);

/** The buildings among the pieces: pieces that meet, corner to corner, are
    one building, and a small knot of them off on its own is something else
    drawn in the wall's shade (a title block's logo, a north point, a key's
    sample: 19 Mythos Ave's "LOOK" lettering drew five grid lines of its
    own until this). A small knot well clear of the biggest building is
    left out; a garage or a studio across the yard is big enough to stay. */
export function buildingsOf(segs: readonly WallSeg[], z: WallSizes): WallSeg[] {
  const parent = segs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i];
      const p = segs[j];
      const reach = Math.max(z.near, s.t, p.t);
      const meet =
        p.dir !== s.dir
          ? p.c >= s.a - reach && p.c <= s.b + reach && s.c >= p.a - reach && s.c <= p.b + reach
          : /* in one line, either side of a door or a window */ Math.abs(p.c - s.c) <= reach && Math.max(p.a, s.a) - Math.min(p.b, s.b) <= z.line * 2;
      if (meet) parent[find(i)] = find(j);
    }
  const run = new Map<number, number>();
  segs.forEach((s, i) => run.set(find(i), (run.get(find(i)) ?? 0) + (s.b - s.a + 1)));
  const most = Math.max(0, ...run.values());
  /* where the big knots stand, taken together, and a margin round them: a
     big house is several knots (doors, glazing and curved walls keep its
     wings from meeting: 3570's ground floor is four), and a wall piece
     anywhere among them is the house's even when it meets nothing */
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const ends = (s: WallSeg) => (s.dir === "h" ? { x0: s.a, x1: s.b, y0: s.c, y1: s.c } : { x0: s.c, x1: s.c, y0: s.a, y1: s.b });
  segs.forEach((s, i) => {
    if ((run.get(find(i)) ?? 0) < most / 4) return;
    const e = ends(s);
    box.x0 = Math.min(box.x0, e.x0);
    box.y0 = Math.min(box.y0, e.y0);
    box.x1 = Math.max(box.x1, e.x1);
    box.y1 = Math.max(box.y1, e.y1);
  });
  const pad = z.line * 3;
  return segs.filter((s, i) => {
    if ((run.get(find(i)) ?? 0) >= most / 4) return true;
    const e = ends(s);
    return e.x1 >= box.x0 - pad && e.x0 <= box.x1 + pad && e.y1 >= box.y0 - pad && e.y0 <= box.y1 + pad;
  });
}

/** Bars lying side by side with only a line between them are hatching (roof
    sheeting, decking, paving), not walls: three or more in a row are left
    out. Two are the leaves of one cavity wall, and become one piece. */
export function withoutStripes(segs: readonly WallSeg[]): WallSeg[] {
  const out: WallSeg[] = [];
  for (const dir of ["h", "v"] as const) {
    const list = segs.filter((s) => s.dir === dir).sort((p, q) => p.c - q.c);
    const used = new Set<WallSeg>();
    for (const s of list) {
      if (used.has(s)) continue;
      /* the row of bars this one starts: each next one touching the last */
      const row = [s];
      for (;;) {
        const last = row[row.length - 1];
        const nxt = list.find(
          (o) =>
            !used.has(o) &&
            !row.includes(o) &&
            o.c > last.c &&
            o.c - last.c <= (o.t + last.t) / 2 + 3 &&
            Math.min(o.b, last.b) - Math.max(o.a, last.a) >=
              0.5 * Math.min(o.b - o.a, last.b - last.a),
        );
        if (!nxt) break;
        row.push(nxt);
      }
      for (const r of row) used.add(r);
      if (row.length === 1) out.push(s);
      else if (row.length === 2) {
        const [p, q] = row;
        out.push({
          dir,
          c: (p.c - p.t / 2 + q.c + q.t / 2) / 2,
          a: Math.max(p.a, q.a),
          b: Math.min(p.b, q.b),
          t: q.c + q.t / 2 - (p.c - p.t / 2),
        });
      }
    }
  }
  return out;
}

export type ShadeWalls = { shade: number; segs: WallSeg[]; run: number; tied: WallSeg[] };

/** Each shade a wall fill could be, with the wall it would draw: most first.
    A shade's wall is the run of its pieces that meet others at corners. */
export function wallsByShade(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, mmPerPx: number | null): ShadeWalls[] {
  const z = wallSizes(width, mmPerPx);
  return shadesOf(rgba, width, height)
    .map((shade) => {
      const segs = withoutStripes(segsOf(maskOf(rgba, width, height, shade), width, height, z));
      const tied = tiedOf(segs, z);
      return { shade, segs, run: runOf(tied), tied };
    })
    .sort((p, q) => q.run - p.run);
}

/** The walls of a drawing, off its pixels (RGBA, row by row). Null when no
    shade on it draws walls: a scan, a sketch, or walls drawn as lines.
    A drawing can fill its walls in two shades (new work and existing, or
    brick and stud). A second shade is wall too when it draws a fair share
    of the first's and nearly all of its pieces meet at corners, as walls do
    and a hatch's stray bars don't; only its pieces that meet are taken. */
export function findWalls(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, mmPerPx: number | null): Walls | null {
  const z = wallSizes(width, mmPerPx);
  const [best, ...rest] = wallsByShade(rgba, width, height, mmPerPx);
  /* a building has walls both ways and a few rooms' worth of them */
  if (!best || best.run < z.line * 8) return null;
  const also = rest.filter((w) => w.run >= 0.35 * best.run && w.run >= 0.75 * runOf(w.segs));
  const segs = buildingsOf([...best.segs, ...also.flatMap((w) => w.tied)], z);
  const grid = gridOf(segs, z);
  if (grid.x.length < 2 || grid.y.length < 2) return null;
  return { shade: best.shade, segs, grid, run: best.run + also.reduce((n, w) => n + w.run, 0) };
}

/** Walls found on a drawing drawn `k` times the size, back in the size asked for. */
export function scaleWalls(w: Walls, k: number): Walls {
  const r = (n: number) => Math.round((n / k) * 10) / 10;
  return {
    shade: w.shade,
    run: Math.round(w.run / k),
    segs: w.segs.map((s) => ({
      dir: s.dir,
      c: r(s.c),
      a: r(s.a),
      b: r(s.b),
      t: r(s.t),
    })),
    grid: { x: w.grid.x.map(r), y: w.grid.y.map(r) },
  };
}
