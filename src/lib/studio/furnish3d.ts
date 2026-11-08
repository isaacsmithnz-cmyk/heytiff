import type { Opening3D, Space3D, XZ } from "./scene3d";

/* THE ROOMS FURNISHED, IN 3D (mock, Isaac 8 November 2026: "Push mock
   further", after "I want to make these things really pop"). What stands in
   each room: first what Tiff read off the drawing (its loose furniture and
   its joinery, where the drawing has them), then, in a room the drawing
   left empty, what a room of that name holds: a bed in a bedroom, a sofa
   in a living room, a car in a garage. A piece is never a room, a load or
   anything priced: it is there to make the house read as a house.

   Pure, in metres on the plan: x across, z toward the viewer, as scene3d. */

export type PieceKind =
  | "bed"
  | "bedside"
  | "sofa"
  | "coffee"
  | "rug"
  | "dining"
  | "chair"
  | "tv"
  | "fridge"
  | "washer"
  | "desk"
  | "car"
  | "toilet"
  | "bath"
  | "bench"
  | "island"
  | "tall"
  | "vanity"
  | "joinery"
  | "table"
  | "outdoor-table"
  | "outdoor-chair";

export type Piece3D = {
  kind: PieceKind;
  /** its middle on the plan */
  at: XZ;
  /** across its front, and front to back, metres */
  w: number;
  d: number;
  /** which way its front faces on the plan, a unit vector */
  facing: XZ;
  /** joinery's height, metres; else the kind's own */
  h?: number;
  /** read off the drawing (true) or placed by its room's name (false) */
  read: boolean;
  /** what the drawing calls it, for joinery: "Kitchen sink bench (BIN, DW)" */
  text?: string;
};

/** What Tiff read off a sheet, in metres: a loose piece's kind, or a built-in's words. */
export type ReadPiece = { kind: string; room: string; pts: XZ[] };

const sub = (a: XZ, b: XZ): XZ => [a[0] - b[0], a[1] - b[1]];
const plus = (a: XZ, b: XZ, k = 1): XZ => [a[0] + b[0] * k, a[1] + b[1] * k];
const dot = (a: XZ, b: XZ) => a[0] * b[0] + a[1] * b[1];
const cross = (a: XZ, b: XZ) => a[0] * b[1] - a[1] * b[0];
const size = (a: XZ) => Math.hypot(a[0], a[1]);
const unit = (a: XZ): XZ => {
  const l = size(a) || 1;
  return [a[0] / l, a[1] / l];
};
const perp = (a: XZ): XZ => [-a[1], a[0]];
const neg = (a: XZ): XZ => [-a[0], -a[1]];
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;

/** A shape's own frame: its middle, its long way `u` and short way `v`, and how far it runs each way. */
export type Frame = { c: XZ; u: XZ; v: XZ; lu: number; lv: number };

/** The frame a shape is drawn square to: its longest side's direction, measured across all its corners. */
export function frameOf(pts: XZ[]): Frame {
  let best = -1;
  let u: XZ = [1, 0];
  for (let i = 0; i < pts.length; i++) {
    const e = sub(pts[(i + 1) % pts.length], pts[i]);
    if (size(e) > best) {
      best = size(e);
      u = unit(e);
    }
  }
  if (u[0] < -1e-9 || (Math.abs(u[0]) < 1e-9 && u[1] < 0)) u = neg(u);
  let v = perp(u);
  let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const p of pts) {
    u0 = Math.min(u0, dot(p, u));
    u1 = Math.max(u1, dot(p, u));
    v0 = Math.min(v0, dot(p, v));
    v1 = Math.max(v1, dot(p, v));
  }
  const c = plus(plus([0, 0], u, (u0 + u1) / 2), v, (v0 + v1) / 2);
  let lu = u1 - u0;
  let lv = v1 - v0;
  if (lv > lu) {
    [u, v] = [v, u];
    [lu, lv] = [lv, lu];
  }
  return { c, u, v, lu, lv };
}

export function within(p: XZ, poly: XZ[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** How far from `p` along `dir` the shape's edge is. */
export function reach(p: XZ, dir: XZ, poly: XZ[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const e = sub(poly[(i + 1) % poly.length], a);
    const den = cross(dir, e);
    if (Math.abs(den) < 1e-9) continue;
    const w = sub(a, p);
    const t = cross(w, e) / den;
    const s = cross(w, dir) / den;
    if (t > 1e-6 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.min(best, t);
  }
  return best;
}

/** A piece's footprint: its middle, the way it faces, across and deep. */
type Rect = { c: XZ; f: XZ; w: number; d: number };

const corners = (r: Rect): XZ[] => {
  const s = perp(r.f);
  const a = plus(r.c, s, r.w / 2);
  const b = plus(r.c, s, -r.w / 2);
  return [plus(a, r.f, r.d / 2), plus(b, r.f, r.d / 2), plus(b, r.f, -r.d / 2), plus(a, r.f, -r.d / 2)];
};

/** Two footprints share ground: no axis of either parts them. */
function overlaps(p: Rect, q: Rect): boolean {
  const pc = corners(p);
  const qc = corners(q);
  for (const ax of [p.f, perp(p.f), q.f, perp(q.f)]) {
    const a = pc.map((x) => dot(x, ax));
    const b = qc.map((x) => dot(x, ax));
    if (Math.max(...a) <= Math.min(...b) + 1e-6 || Math.max(...b) <= Math.min(...a) + 1e-6) return false;
  }
  return true;
}

/** The footprint is wholly in the room: its corners in, and no corner of the room pokes into it. */
function fits(r: Rect, room: XZ[]): boolean {
  if (!corners(r).every((p) => within(p, room))) return false;
  const shrunk = { ...r, w: r.w - 0.02, d: r.d - 0.02 };
  const s = perp(r.f);
  return !room.some((p) => {
    const q = sub(p, shrunk.c);
    return Math.abs(dot(q, s)) < shrunk.w / 2 && Math.abs(dot(q, r.f)) < shrunk.d / 2;
  });
}

/** Room round it: `side` both sides, `front` before it. */
const roomy = (r: Rect, side: number, front: number, back = 0): Rect => ({
  c: plus(r.c, r.f, (front - back) / 2),
  f: r.f,
  w: r.w + side * 2,
  d: r.d + front + back,
});

const piece = (kind: PieceKind, r: Rect, read: boolean, extra: Partial<Piece3D> = {}): Piece3D => ({
  kind,
  at: [r3(r.c[0]), r3(r.c[1])],
  w: r3(r.w),
  d: r3(r.d),
  facing: [r3(r.f[0]), r3(r.f[1])],
  read,
  ...extra,
});

/* ── what the drawing calls it ── */

/** a loose piece's kind as she wrote it */
function looseKind(kind: string): PieceKind | null {
  const k = kind.toLowerCase();
  if (/bed/.test(k)) return "bed";
  if (/sofa|couch|lounge/.test(k)) return "sofa";
  if (/dining|table/.test(k)) return "dining";
  if (/\btv\b|television/.test(k)) return "tv";
  if (/fridge|refrigerator/.test(k)) return "fridge";
  if (/wash|dryer/.test(k)) return "washer";
  if (/desk/.test(k)) return "desk";
  if (/\bcar\b/.test(k)) return "car";
  if (/chair/.test(k)) return "chair";
  return null;
}

/** a built-in by its words: how tall it stands */
function joineryOf(text: string): { kind: PieceKind; h: number } {
  const t = text.toLowerCase();
  if (/robe|wardrobe|pantry|\bpty\b|linen|shelv|tall|broom/.test(t)) return { kind: "tall", h: 2.1 };
  if (/vanity|basin/.test(t)) return { kind: "vanity", h: 0.85 };
  if (/island/.test(t)) return { kind: "island", h: 0.9 };
  if (/bench|kitchen|laundry|tub/.test(t)) return { kind: "bench", h: 0.9 };
  if (/living|tv|entertain|media/.test(t)) return { kind: "joinery", h: 0.6 };
  return { kind: "joinery", h: 0.9 };
}

/** pieces that are longer than they are wide, front to back */
const LONG = new Set<PieceKind>(["bed", "car", "bath"]);

/** A piece read off the drawing, square to its outline, its back to the nearer wall of its room. */
function fromOutline(kind: PieceKind, pts: XZ[], room: XZ[] | null, extra: Partial<Piece3D> = {}): Piece3D {
  const fr = frameOf(pts);
  /* across its front is its long way, but for a bed, a car or a bath */
  const [across, deep] = LONG.has(kind) ? [fr.lv, fr.lu] : [fr.lu, fr.lv];
  const axis = LONG.has(kind) ? fr.u : fr.v;
  let f = axis;
  if (room) {
    const ahead = reach(fr.c, axis, room);
    const behind = reach(fr.c, neg(axis), room);
    /* the back goes to the wall it is nearer */
    f = behind <= ahead ? axis : neg(axis);
  }
  return piece(kind, { c: fr.c, f, w: across, d: deep }, true, extra);
}

/* ── a room by its name ── */

type Dress = "bed" | "living" | "dining" | "study" | "garage" | "bath" | "toilet" | "laundry" | "outdoor";

const nameOf = (s: Space3D) => s.name.toLowerCase().replace(/^ex\.?\s*/, "");

export function dressOf(s: Space3D): Dress[] {
  const n = nameOf(s);
  if (s.kind === "garage" || /garage|carport/.test(n)) return ["garage"];
  if (s.kind === "outdoor") return /deck|verandah|veranda|terrace|entertain|alfresco|patio|courtyard|balcony|porch/.test(n) ? ["outdoor"] : [];
  if (s.kind === "stair" || s.kind === "void" || s.kind === "circulation" || s.kind === "cupboard") return [];
  const out: Dress[] = [];
  if (s.kind === "wet") {
    if (/laundry|ldry/.test(n)) out.push("laundry");
    if (/\bbath/.test(n) && !/ens/.test(n)) out.push("bath");
    if (/bath|ens|wc|toilet|powder|p'?wd|pdr/.test(n)) out.push("toilet");
    return out;
  }
  if (/bed|master|guest|nursery/.test(n)) return ["bed"];
  if (/dining|meals/.test(n)) out.push("dining");
  if (/living|lounge|family|rumpus|media|sitting|retreat|play|theatre/.test(n)) out.push("living");
  if (/study|office/.test(n)) out.push("study");
  return out;
}

/** A wall of the room, its way along and the way into the room. */
type Wall = { a: XZ; e: XZ; n: XZ; len: number; door: number; window: boolean };

function wallsOf(room: XZ[], doors: Opening3D[], windows: Opening3D[]): Wall[] {
  const out: Wall[] = [];
  const on = (o: Opening3D, a: XZ, b: XZ) => {
    const m: XZ = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
    const e = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(m, a), e) / dot(e, e)));
    return size(sub(m, plus(a, e, t))) < 0.25;
  };
  for (let i = 0; i < room.length; i++) {
    const a = room[i];
    const b = room[(i + 1) % room.length];
    const len = size(sub(b, a));
    if (len < 0.3) continue;
    const e = unit(sub(b, a));
    let n = perp(e);
    if (!within(plus(plus(a, e, len / 2), n, 0.05), room)) n = neg(n);
    out.push({ a, e, n, len, door: doors.filter((o) => on(o, a, b)).length, window: windows.some((o) => on(o, a, b)) });
  }
  return out;
}

/** Spots along the walls, middle first, its back to the wall. */
function* wallSpots(walls: Wall[], w: number, d: number): Generator<Rect> {
  for (const wl of walls) {
    if (wl.len < w + 0.1) continue;
    const room = (wl.len - w) / 2;
    for (let k = 0; k * 0.25 <= room + 1e-9; k++)
      for (const s of k ? [1, -1] : [1]) {
        const t = wl.len / 2 + s * k * 0.25;
        yield { c: plus(plus(wl.a, wl.e, t), wl.n, d / 2 + 0.06), f: wl.n, w, d };
      }
  }
}

/** Spots anywhere in the room, square to it, on a 25 cm grid. */
function freeSpots(room: XZ[], w: number, d: number): Rect[] {
  const fr = frameOf(room);
  const out: Rect[] = [];
  const nu = Math.floor(fr.lu / 0.25);
  const nv = Math.floor(fr.lv / 0.25);
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j <= nv; j++) {
      const c = plus(plus(fr.c, fr.u, -fr.lu / 2 + i * 0.25), fr.v, -fr.lv / 2 + j * 0.25);
      if (!within(c, room)) continue;
      out.push({ c, f: fr.v, w, d }, { c, f: fr.u, w, d });
    }
  return out;
}

const near = (r: Rect, p: XZ) => size(sub(r.c, p));

/** Everything that stands in a floor's rooms. */
export function furnish(spaces: Space3D[], openings: Opening3D[], read: { furniture: ReadPiece[]; joinery: ReadPiece[] }): Piece3D[] {
  const out: Piece3D[] = [];
  const doors = openings.filter((o) => o.kind === "door");
  const windows = openings.filter((o) => o.kind === "window");
  /* a door's swing, kept clear: its width, 90 cm each side of the wall */
  const swings: Rect[] = doors.map((o) => ({ c: [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2], f: perp(unit(sub(o.b, o.a))), w: size(sub(o.b, o.a)) + 0.1, d: 1.8 }));
  const roomAt = (p: XZ, name: string) => {
    const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return (
      spaces.find((s) => s.kind !== "void" && within(p, s.pts)) ??
      spaces.find((s) => s.name.toLowerCase().replace(/[^a-z0-9]/g, "") === n) ??
      null
    );
  };
  const taken: Rect[] = [];
  const keep = (p: Piece3D) => {
    out.push(p);
    taken.push({ c: p.at, f: p.facing, w: p.w, d: p.d });
    return p;
  };
  const filled = new Set<Space3D>();
  const free = (r: Rect, room: XZ[]) => fits(r, room) && !taken.some((t) => overlaps(r, t)) && !swings.some((s) => overlaps(r, s));
  const freeOf = (r: Rect, room: XZ[], check: Rect) => fits(check, room) && !taken.some((t) => overlaps(check, t)) && !swings.some((s) => overlaps(r, s));

  /* what she read: the built-ins, then the loose pieces */
  for (const j of read.joinery) {
    if (j.pts.length < 3) continue;
    const fr = frameOf(j.pts);
    if (fr.lu < 0.2 || fr.lv < 0.2) continue;
    const room = roomAt(fr.c, j.room);
    const { kind, h } = joineryOf(j.kind);
    keep(fromOutline(kind, j.pts, room?.pts ?? null, { h, text: j.kind }));
  }
  for (const f of read.furniture) {
    const kind = looseKind(f.kind);
    if (!kind || f.pts.length < 3) continue;
    const fr = frameOf(f.pts);
    if (fr.lu < 0.2) continue;
    const room = roomAt(fr.c, f.room);
    if (room) filled.add(room);
    const p = keep(fromOutline(kind, f.pts, room?.pts ?? null));
    if (room) companions(p, room.pts, false);
  }


  /* what goes with a piece: a bed's tables, a sofa's table and rug, a table's chairs */
  function companions(p: Piece3D, room: XZ[], placed: boolean) {
    const f = p.facing;
    const s = perp(f);
    if (p.kind === "bed") {
      for (const k of [1, -1]) {
        const r: Rect = { c: plus(plus(p.at, s, k * (p.w / 2 + 0.3)), f, -p.d / 2 + 0.22), f, w: 0.45, d: 0.4 };
        if (free(r, room)) keep(piece("bedside", r, false));
      }
    } else if (p.kind === "sofa") {
      const coffee: Rect = { c: plus(p.at, f, p.d / 2 + 0.45 + 0.28), f, w: Math.min(1.2, p.w * 0.5), d: 0.55 };
      if (!free(coffee, room)) return;
      keep(piece("coffee", coffee, false));
      const rug: Rect = { c: coffee.c, f, w: Math.min(2.6, p.w + 0.4), d: 1.8 };
      if (fits(rug, room)) out.push(piece("rug", rug, false));
      if (!placed) return;
      /* the television on the wall it faces, when there is one in sight */
      const ahead = reach(coffee.c, f, room);
      if (ahead > 1.2 && ahead < 5.5) {
        const tv: Rect = { c: plus(coffee.c, f, ahead - 0.3), f: neg(f), w: 1.8, d: 0.45 };
        if (free(tv, room)) keep(piece("tv", tv, false));
      }
    } else if (p.kind === "dining" || p.kind === "outdoor-table") {
      const chair: PieceKind = p.kind === "dining" ? "chair" : "outdoor-chair";
      const n = Math.max(1, Math.round(p.w / 0.62));
      for (const k of [1, -1])
        for (let i = 0; i < n; i++) {
          const along = -p.w / 2 + (p.w / n) * (i + 0.5);
          const r: Rect = { c: plus(plus(p.at, s, along), f, k * (p.d / 2 + 0.28)), f: k > 0 ? neg(f) : f, w: 0.46, d: 0.46 };
          if (free(r, room)) keep(piece(chair, r, false));
        }
      if (p.d >= 1.2) {
        /* a square table seats one at each end too */
        for (const k of [1, -1]) {
          const r: Rect = { c: plus(p.at, s, k * (p.w / 2 + 0.28)), f: k > 0 ? neg(s) : s, w: 0.46, d: 0.46 };
          if (free(r, room)) keep(piece(chair, r, false));
        }
      }
    } else if (p.kind === "desk") {
      const r: Rect = { c: plus(p.at, f, p.d / 2 + 0.3), f: neg(f), w: 0.5, d: 0.5 };
      if (free(r, room)) keep(piece("chair", r, false));
    }
  }

  /* a room the drawing left empty: what a room of its name holds */
  for (const sp of spaces) {
    if (filled.has(sp) || sp.pts.length < 3) continue;
    const dress = dressOf(sp);
    if (!dress.length) continue;
    const room = sp.pts;
    const fr = frameOf(room);
    const walls = wallsOf(room, doors, windows);
    const joinery = out.filter((p) => p.read && within(p.at, room) && (p.kind === "bench" || p.kind === "island"));
    for (const what of dress) {
      if (what === "bed") {
        const king = /master/.test(nameOf(sp)) && fr.lv >= 3.6;
        const [w, d] = king ? [1.83, 2.03] : fr.lv >= 3.2 ? [1.53, 2.03] : fr.lv >= 2.6 ? [1.38, 1.88] : [0.92, 1.88];
        /* its head on a wall with no door, a window if it must */
        const order = [...walls].sort((p, q) => p.door - q.door || Number(p.window) - Number(q.window) || q.len - p.len);
        const r = first(wallSpots(order, w, d), (x) => freeOf(x, room, roomy(x, 0.45, 0.5))) ?? first(wallSpots(order, w, d), (x) => free(x, room));
        if (r) companions(keep(piece("bed", r, false)), room, true);
      } else if (what === "living") {
        const [w, d] = fr.lv >= 3.2 ? [2.2, 0.9] : [1.8, 0.85];
        const order = [...walls].sort((p, q) => p.door - q.door || q.len - p.len);
        /* in a kitchen's room, the sofa stands away from the kitchen */
        const away = (x: Rect) => (joinery.length ? -Math.min(...joinery.map((j) => near(x, j.at))) : 0);
        const spots = [...wallSpots(order, w, d)].filter((x) => freeOf(x, room, roomy(x, 0.1, 1.3)));
        spots.sort((p, q) => away(p) - away(q));
        if (spots[0]) companions(keep(piece("sofa", spots[0], false)), room, true);
      } else if (what === "dining") {
        const [w, d] = fr.lu >= 4 && fr.lv >= 3.2 ? [1.8, 0.95] : [1.4, 0.85];
        const goal = joinery.length ? joinery.reduce((a, j) => plus(a, j.at, 1 / joinery.length), [0, 0] as XZ) : fr.c;
        const score = (x: Rect) => (joinery.length ? Math.abs(near(x, goal) - 2.4) : near(x, goal));
        const spots = freeSpots(room, w, d).filter((x) => freeOf(x, room, roomy(x, 0.8, 0.8, 0.8)));
        spots.sort((p, q) => score(p) - score(q));
        if (spots[0]) companions(keep(piece("dining", spots[0], false)), room, true);
      } else if (what === "study") {
        const order = [...walls].sort((p, q) => Number(q.window) - Number(p.window) || p.door - q.door);
        const r = first(wallSpots(order, 1.4, 0.7), (x) => freeOf(x, room, roomy(x, 0, 0.8)));
        if (r) companions(keep(piece("desk", r, false)), room, true);
      } else if (what === "garage") {
        if (fr.lu < 5 || fr.lv < 2.5) continue;
        /* a double garage parks two, one in each half */
        const goals = fr.lv >= 5 ? [plus(fr.c, fr.v, -fr.lv / 4), plus(fr.c, fr.v, fr.lv / 4)] : [fr.c];
        for (const goal of goals) {
          const spots = freeSpots(room, 1.85, 4.6).filter((x) => Math.abs(dot(x.f, fr.u)) > 0.9 && freeOf(x, room, roomy(x, 0.3, 0.3, 0.3)));
          spots.sort((p, q) => near(p, goal) - near(q, goal));
          if (spots[0]) keep(piece("car", spots[0], false));
        }
      } else if (what === "bath") {
        const order = [...walls].sort((p, q) => p.door - q.door || p.len - q.len);
        const r = first(wallSpots(order, 1.7, 0.75), (x) => freeOf(x, room, roomy(x, 0, 0.5)));
        if (r) keep(piece("bath", r, false));
      } else if (what === "toilet") {
        const order = [...walls].sort((p, q) => p.door - q.door);
        const r = first(wallSpots(order, 0.4, 0.7), (x) => freeOf(x, room, roomy(x, 0.2, 0.5)));
        if (r) keep(piece("toilet", r, false));
      } else if (what === "laundry") {
        if (out.some((p) => p.kind === "washer" && within(p.at, room))) continue;
        const r = first(wallSpots(walls, 0.6, 0.6), (x) => freeOf(x, room, roomy(x, 0, 0.6)));
        if (r) keep(piece("washer", r, false));
      } else if (what === "outdoor") {
        if (fr.lv < 2.4 || fr.lu * fr.lv < 8) continue;
        const [w, d] = fr.lv >= 3.2 ? [1.6, 0.9] : [1.0, 0.8];
        const spots = freeSpots(room, w, d).filter((x) => freeOf(x, room, roomy(x, 0.7, 0.7, 0.7)));
        spots.sort((p, q) => near(p, fr.c) - near(q, fr.c));
        if (spots[0]) companions(keep(piece("outdoor-table", spots[0], false)), room, true);
      }
    }
  }
  return out;
}

function first(spots: Iterable<Rect>, ok: (r: Rect) => boolean): Rect | null {
  for (const r of spots) if (ok(r)) return r;
  return null;
}
