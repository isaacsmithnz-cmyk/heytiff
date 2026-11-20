import type { PlanWord, ReadPoint, ReadSpace, SpaceKind } from "../reading";
import type { WallGrid, WallSeg, Walls, WallSizes } from "./walls";

/* ROOMS NAMED BETWEEN MEASURED WALLS. The walls and their numbered lines are
   measured (walls.ts); which lines a room stands between is a judgment, and
   that alone is asked of the model: "Bed 6 is x18,y0 x20,y0 x20,y3 x18,y3".
   A corner is a line's number, or a bare pixel where no line runs (a short
   wall, a bay, a curve). Here each answer is set on the walls it names and
   then checked against the drawing: a corner that sits on nothing, rooms
   that overlap, a name written on the plan that ended up in no room. What
   fails goes back to her once, said plainly, and what still fails is kept
   for a person to look at; nothing is quietly guessed. */

/** A room as the model gives it: corners in line numbers or its picture's pixels. */
export type NamedRoom = {
  name: string;
  named: boolean;
  kind: SpaceKind;
  /** "x3,y4 x5,y4 x5,y5 x3,y5": each corner an x and a y, a line (x3) or a pixel (812) */
  corners: string;
  openTo: string;
  stair: string;
};

/** Something about a reading a person should look at, and which room it is about. */
export type Problem = {
  kind: "corner" | "overlap" | "label" | "small" | "off_wall" | "shape";
  room: string;
  said: string;
};

type Coord = { v: number; line: number | null };
type Corner = { x: Coord; y: Coord };

const REF = /^([xy])(\d+)$/i;

/** One corner word, "x3" or "812": on the line named, or at the pixel given
    (in the model's picture, brought back to the sheet's own by `back`). */
function coord(
  word: string,
  axis: "x" | "y",
  grid: WallGrid,
  back: (v: number) => number,
): Coord | null {
  const m = REF.exec(word.trim());
  if (m) {
    if (m[1].toLowerCase() !== axis) return null;
    const v = grid[axis][Number(m[2])];
    return v == null ? null : { v, line: Number(m[2]) };
  }
  const v = Number(word);
  return Number.isFinite(v) ? { v: back(v), line: null } : null;
}

/** A room's corners as written, read. Null when any of it isn't a corner. */
export function parseCorners(
  text: string,
  grid: WallGrid,
  backX: (v: number) => number,
  backY: (v: number) => number,
): Corner[] | null {
  const out: Corner[] = [];
  for (const pair of text.trim().split(/\s+/)) {
    const [a, b, ...rest] = pair.split(",");
    if (!a || !b || rest.length) return null;
    const x = coord(a, "x", grid, backX);
    const y = coord(b, "y", grid, backY);
    if (!x || !y) return null;
    out.push({ x, y });
  }
  return out.length >= 3 ? out : null;
}

/** The wall piece a bare coordinate was meant for: one running the right
    way, close by, and passing the corner. Null when none is. */
function wallNear(
  segs: readonly WallSeg[],
  dir: "h" | "v",
  c: number,
  along: number,
  z: WallSizes,
): WallSeg | null {
  let best: WallSeg | null = null;
  for (const s of segs) {
    if (s.dir !== dir) continue;
    const reach = Math.max(z.near, s.t);
    if (Math.abs(s.c - c) > reach || along < s.a - reach || along > s.b + reach)
      continue;
    if (!best || Math.abs(s.c - c) < Math.abs(best.c - c)) best = s;
  }
  return best;
}

const area = (p: readonly ReadPoint[]) =>
  Math.abs(
    p.reduce(
      (n, a, i) =>
        n + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y,
      0,
    ),
  ) / 2;
const turnsRight = (p: readonly ReadPoint[]) =>
  p.reduce(
    (n, a, i) =>
      n + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y,
    0,
  ) > 0;

export function inside(p: ReadPoint, poly: readonly ReadPoint[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      hit = !hit;
  }
  return hit;
}

/** The wall along an edge between two corners, when it lies on one: its thickness. */
function wallAlong(
  segs: readonly WallSeg[],
  a: ReadPoint,
  b: ReadPoint,
  z: WallSizes,
): { t: number; on: number } {
  const level = Math.abs(a.y - b.y) < 0.5;
  const upright = Math.abs(a.x - b.x) < 0.5;
  if (!level && !upright) return { t: 0, on: 0 };
  const c = level ? a.y : a.x;
  const lo = Math.min(level ? a.x : a.y, level ? b.x : b.y);
  const hi = Math.max(level ? a.x : a.y, level ? b.x : b.y);
  let on = 0;
  let weight = 0;
  let thick = 0;
  for (const s of segs) {
    if (
      s.dir !== (level ? "h" : "v") ||
      Math.abs(s.c - c) > Math.max(z.near, s.t / 2)
    )
      continue;
    const cover = Math.min(hi, s.b) - Math.max(lo, s.a);
    if (cover <= 0) continue;
    on += cover;
    weight += cover;
    thick += s.t * cover;
  }
  return {
    t: weight ? thick / weight : 0,
    on: hi > lo ? Math.min(1, on / (hi - lo)) : 0,
  };
}

/** The room's outline on the INSIDE face of its walls, as every reading
    gives one: each edge lying on a wall moves in by half that wall. */
function inner(
  pts: readonly ReadPoint[],
  segs: readonly WallSeg[],
  z: WallSizes,
): ReadPoint[] {
  const n = pts.length;
  const cw = turnsRight(pts);
  /* how far each edge i (from point i to i+1) moves, and which way */
  const move = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const { t } = wallAlong(segs, a, b, z);
    if (!t) return { dx: 0, dy: 0 };
    const half = t / 2;
    /* y runs down the sheet: going round with the inside on the right */
    if (Math.abs(a.y - b.y) < 0.5)
      return { dx: 0, dy: (b.x > a.x === cw ? 1 : -1) * half };
    return { dx: (b.y > a.y === cw ? -1 : 1) * half, dy: 0 };
  });
  return pts.map((p, i) => {
    const before = move[(i + n - 1) % n];
    const after = move[i];
    /* two edges in one line share their move, they don't add it */
    const dx =
      before.dx && after.dx ? (before.dx + after.dx) / 2 : before.dx + after.dx;
    const dy =
      before.dy && after.dy ? (before.dy + after.dy) / 2 : before.dy + after.dy;
    return { x: Math.round(p.x + dx), y: Math.round(p.y + dy) };
  });
}

export type Snapped = { spaces: ReadSpace[]; problems: Problem[] };

const NO_WALLS: readonly SpaceKind[] = ["outdoor", "void", "notch", "stair"];

/** The model's rooms set on the walls and checked. `back` brings her
    picture's pixels to the sheet's; `words` are the sheet's own, for the
    names she says are written; `mmPerPx` sizes the checks when it's known. */
export function snapRooms(
  rooms: readonly NamedRoom[],
  walls: Walls,
  z: WallSizes,
  opts: {
    backX: (v: number) => number;
    backY: (v: number) => number;
    words?: readonly PlanWord[];
    mmPerPx?: number | null;
  },
): Snapped {
  const problems: Problem[] = [];
  const set: { room: NamedRoom; centre: ReadPoint[] }[] = [];
  for (const room of rooms) {
    const corners = parseCorners(
      room.corners,
      walls.grid,
      opts.backX,
      opts.backY,
    );
    if (!corners) {
      problems.push({
        kind: "shape",
        room: room.name,
        said: `${room.name}: its corners "${room.corners}" aren't corners. Give each as x,y, a line (x3) or a pixel.`,
      });
      continue;
    }
    /* a bare pixel goes onto the wall it was meant for, when one is there.
       The same pixel said at two corners is one edge, and lands on one
       wall: whichever of its corners (or their neighbours) passes one */
    const n = corners.length;
    const onto = (axis: "x" | "y", v: number): number => {
      const dir = axis === "x" ? "v" : "h";
      const other = axis === "x" ? "y" : "x";
      for (let i = 0; i < n; i++) {
        const c = corners[i];
        if (c[axis].line != null || Math.abs(c[axis].v - v) > 1) continue;
        for (const k of [i, (i + 1) % n, (i + n - 1) % n]) {
          const hit = wallNear(walls.segs, dir, v, corners[k][other].v, z);
          if (hit) return hit.c;
        }
      }
      return v;
    };
    const pts = corners.map((c): ReadPoint => ({
      x: c.x.line != null ? c.x.v : onto("x", c.x.v),
      y: c.y.line != null ? c.y.v : onto("y", c.y.v),
    }));
    /* corners said twice running, or three in a line, are one */
    const tidy = pts.filter((p, i) => {
      const q = pts[(i + pts.length - 1) % pts.length];
      return Math.abs(p.x - q.x) > 0.5 || Math.abs(p.y - q.y) > 0.5;
    });
    if (tidy.length < 3 || area(tidy) < z.short * z.short * 0.5) {
      problems.push({
        kind: "small",
        room: room.name,
        said: `${room.name}: its corners enclose next to nothing.`,
      });
      continue;
    }
    set.push({ room, centre: tidy });
  }

  /* a walled room's edges lie on walls: one mostly off them was set between the wrong lines */
  for (const { room, centre } of set) {
    if (NO_WALLS.includes(room.kind)) continue;
    const edges = centre
      .map((a, i) => ({ a, b: centre[(i + 1) % centre.length] }))
      .filter((e) => Math.hypot(e.a.x - e.b.x, e.a.y - e.b.y) >= z.long);
    const bare = edges.filter(
      (e) => wallAlong(walls.segs, e.a, e.b, z).on < 0.25,
    );
    /* an open-plan room has an open side or two; more than half its long edges bare is a miss */
    if (edges.length && bare.length > edges.length / 2)
      problems.push({
        kind: "off_wall",
        room: room.name,
        said: `${room.name}: ${bare.length} of its ${edges.length} sides run along no wall. Check which lines it stands between.`,
      });
  }

  /* two rooms can't hold the same floor: counted on a coarse lattice */
  const step = Math.max(2, z.near);
  const cells = new Map<string, number[]>();
  set.forEach(({ centre }, k) => {
    const xs = centre.map((p) => p.x);
    const ys = centre.map((p) => p.y);
    for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step)
      for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step)
        if (inside({ x, y }, centre)) {
          const key = `${Math.round(x / step)},${Math.round(y / step)}`;
          const at = cells.get(key);
          if (at) at.push(k);
          else cells.set(key, [k]);
        }
  });
  const size = new Map<number, number>();
  const shared = new Map<string, number>();
  for (const at of cells.values()) {
    for (const k of at) size.set(k, (size.get(k) ?? 0) + 1);
    for (let i = 0; i < at.length; i++)
      for (let j = i + 1; j < at.length; j++)
        shared.set(
          `${at[i]}|${at[j]}`,
          (shared.get(`${at[i]}|${at[j]}`) ?? 0) + 1,
        );
  }
  for (const [pair, count] of shared) {
    const [i, j] = pair.split("|").map(Number);
    const smaller = Math.min(size.get(i) ?? 0, size.get(j) ?? 0);
    /* a stair or a void drawn inside the hall it is in is not a clash */
    if (
      [set[i].room.kind, set[j].room.kind].some(
        (k) => k === "stair" || k === "void" || k === "notch",
      )
    )
      continue;
    if (smaller && count / smaller > 0.15)
      problems.push({
        kind: "overlap",
        room: set[i].room.name,
        said: `${set[i].room.name} and ${set[j].room.name} overlap. One of them is between the wrong lines.`,
      });
  }

  /* a name she says is written is on the sheet, inside its room */
  const words = opts.words ?? [];
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (words.length)
    for (const { room, centre } of set) {
      if (!room.named) continue;
      /* a name of several words is written as several: its first word finds it */
      const first = norm(room.name.split(/[\s,/&]+/)[0] ?? "");
      if (first.length < 2) continue;
      const hits = words.filter(
        (w) => norm(w.text) === first || norm(w.text) === norm(room.name),
      );
      if (!hits.length) continue;
      const reach = z.near * 2;
      const within = hits.some(
        (w) =>
          inside(w.at, centre) ||
          centre.some((p) => Math.hypot(p.x - w.at.x, p.y - w.at.y) < reach),
      );
      if (!within)
        problems.push({
          kind: "label",
          room: room.name,
          said: `${room.name}: the plan writes "${hits[0].text}" at ${Math.round(hits[0].at.x)},${Math.round(hits[0].at.y)}, outside the room given. Set the room round its label.`,
        });
    }

  const spaces = set.map(({ room, centre }): ReadSpace => ({
    name: room.name,
    named: room.named,
    kind: room.kind,
    outline:
      NO_WALLS.includes(room.kind) && room.kind !== "stair"
        ? centre.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
        : inner(centre, walls.segs, z),
    written: "",
    existing: false,
    openTo: room.openTo,
    stair: room.stair,
  }));
  return { spaces, problems };
}

/** How alike two readings of one floor are: of the rooms named in both, the
    share whose middles sit inside each other's outline. Used to hold a
    second reader's rooms up against the first's. */
export function agreement(
  a: readonly ReadSpace[],
  b: readonly ReadSpace[],
): { both: number; agree: number; onlyA: string[]; onlyB: string[] } {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const mid = (o: readonly ReadPoint[]): ReadPoint => ({
    x: o.reduce((n, p) => n + p.x, 0) / o.length,
    y: o.reduce((n, p) => n + p.y, 0) / o.length,
  });
  /* the same name, nearest pair first: a house has several ensuites */
  const A = a.filter((s) => s.outline.length >= 3);
  const B = b.filter((s) => s.outline.length >= 3);
  const pairs = A.flatMap((s, i) =>
    B.map((t, j) => ({
      i,
      j,
      same: norm(s.name) === norm(t.name),
      d: Math.hypot(
        mid(s.outline).x - mid(t.outline).x,
        mid(s.outline).y - mid(t.outline).y,
      ),
    })),
  )
    .filter((p) => p.same)
    .sort((p, q) => p.d - q.d);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  let both = 0;
  let agree = 0;
  for (const p of pairs) {
    if (usedA.has(p.i) || usedB.has(p.j)) continue;
    usedA.add(p.i);
    usedB.add(p.j);
    both++;
    if (
      inside(mid(A[p.i].outline), B[p.j].outline) &&
      inside(mid(B[p.j].outline), A[p.i].outline)
    )
      agree++;
  }
  return {
    both,
    agree,
    onlyA: A.filter((_, i) => !usedA.has(i)).map((s) => s.name),
    onlyB: B.filter((_, j) => !usedB.has(j)).map((s) => s.name),
  };
}
