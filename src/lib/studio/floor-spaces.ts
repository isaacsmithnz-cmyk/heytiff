/* UNDER THE HOUSE AND IN THE ROOF (Isaac, 15 November 2026: "Some floor
   plans have it, but most dont. So we need to be able to show our equipment
   under the house"; the mock "Under the house",
   https://claude.ai/artifact/36TVHmDKkFttsLnQfRMpNK). A subfloor hangs off
   the lowest floor and a roof space off the top one. Each follows its floor's
   outline, traced from the rooms Tiff read there (or the rooms drawn), until a
   corner is dragged; its height is typed. Pure. */

import type { DesignDocument, Floor, FloorSpace, Point } from "./document";
import { polygonArea } from "./geometry";
import type { ReadSpace } from "./reading";
import { andList } from "@/lib/swms/library";

export type SpaceKind = "under" | "over";

export const SPACE_NAME: Record<SpaceKind, string> = { under: "Subfloor", over: "Roof space" };
export const SPACE_LEVEL: Record<SpaceKind, string> = { under: "SF", over: "RS" };

/* the house's floors: a subfloor and a roof space are the house's, not another building's (buildings.ts) */
const byLevel = (doc: Pick<DesignDocument, "floors">) => [...doc.floors].filter((f, _, all) => !f.buildingId || all.every((g) => g.buildingId)).sort((a, b) => a.level - b.level);
export const lowestFloor = (doc: Pick<DesignDocument, "floors">): Floor | undefined => byLevel(doc)[0];
export const topFloor = (doc: Pick<DesignDocument, "floors">): Floor | undefined => byLevel(doc).at(-1);

/** the floor a space hangs off: the lowest for a subfloor, the top for a roof space */
export const floorFor = (doc: Pick<DesignDocument, "floors">, kind: SpaceKind) => (kind === "under" ? lowestFloor(doc) : topFloor(doc));

/** the design's subfloor or roof space, and the floor it hangs off */
export function spaceOf(doc: Pick<DesignDocument, "floors">, kind: SpaceKind): { floor: Floor; space: FloorSpace } | null {
  const floor = floorFor(doc, kind);
  const space = floor?.[kind];
  return floor && space ? { floor, space } : null;
}

/** Tiff read a roof off the set: the roof space is hers, so none is added by hand */
export const roofRead = (doc: Pick<DesignDocument, "reading">) => (doc.reading?.roof?.parts.length ?? 0) > 0;

/** whether the floor menu offers to add one */
export function canAdd(doc: Pick<DesignDocument, "floors" | "reading">, kind: SpaceKind): boolean {
  const floor = floorFor(doc, kind);
  if (!floor || floor[kind]) return false;
  return kind === "under" || !roofRead(doc);
}

const withSpace = (doc: DesignDocument, floorId: string, kind: SpaceKind, space: FloorSpace | undefined): DesignDocument => ({
  ...doc,
  floors: doc.floors.map((f) => {
    if (f.id !== floorId) return f;
    const next = { ...f };
    if (space) next[kind] = space;
    else delete next[kind];
    return next;
  }),
});

export function addSpace(doc: DesignDocument, kind: SpaceKind): DesignDocument {
  const floor = floorFor(doc, kind);
  if (!floor || floor[kind]) return doc;
  return withSpace(doc, floor.id, kind, { heightMm: null, outline: null, from: "hand" });
}

export function removeSpace(doc: DesignDocument, kind: SpaceKind): DesignDocument {
  const at = spaceOf(doc, kind);
  return at ? withSpace(doc, at.floor.id, kind, undefined) : doc;
}

export function patchSpace(doc: DesignDocument, kind: SpaceKind, patch: Partial<FloorSpace>): DesignDocument {
  const at = spaceOf(doc, kind);
  return at ? withSpace(doc, at.floor.id, kind, { ...at.space, ...patch }) : doc;
}

/** a height typed in mm: a whole number over nothing, else not known */
export const heightOf = (mm: number | null): number | null => (mm != null && Number.isFinite(mm) && mm > 0 ? Math.round(mm) : null);

/* ── the floor's outline ─────────────────────────────────────────────── */

/* what stands over a subfloor: the rooms, and a balcony or deck built out
   from them (Ipsum's outdoor units go under its balcony); not a garden,
   a courtyard or a garage on its slab, and not a stair (a stair inside is a
   hole in the outline anyway; one outside sticks out of it) */
const RAISED = /\b(balcony|deck|verandah|veranda|porch)\b/i;
export const standsOver = (s: Pick<ReadSpace, "kind" | "name">) =>
  s.kind === "outdoor" ? RAISED.test(s.name) : !["garage", "stair", "void", "notch"].includes(s.kind);

/** the polygons a floor's outline is traced round: Tiff's spaces on it, else the rooms drawn */
export function floorPolygons(doc: Pick<DesignDocument, "reading" | "objects">, floor: Floor): Point[][] {
  const out: Point[][] = [];
  for (const r of doc.reading?.floors[floor.id] ?? []) {
    const sheet = floor.plans.find((p) => p.id === r.sheetId);
    if (!sheet) continue;
    for (const s of r.spaces) if (s.outline.length >= 3 && standsOver(s)) out.push(s.outline.map((p) => ({ x: sheet.x + p.x, y: sheet.y + p.y })));
  }
  if (out.length) return out;
  for (const o of doc.objects)
    if (o.floorId === floor.id && o.type === "room" && o.geometry.kind === "polygon" && o.geometry.points.length >= 3) out.push(o.geometry.points);
  return out;
}

/* the walls between rooms are closed over: this far, mm */
const WALL_MM = 400;
const CELLS = 320;

const inPoly = (x: number, y: number, poly: Point[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};

/** The one outline round a set of rooms: filled on a grid, the walls between
    them closed, the outer edge traced and its stair steps smoothed out. */
export function traceOutline(polys: Point[][], mmPerUnit: number | null): Point[] | null {
  const all = polys.flat();
  if (all.length < 3) return null;
  const x0 = Math.min(...all.map((p) => p.x));
  const y0 = Math.min(...all.map((p) => p.y));
  const span = Math.max(Math.max(...all.map((p) => p.x)) - x0, Math.max(...all.map((p) => p.y)) - y0);
  if (!(span > 0)) return null;
  const cell = span / CELLS;
  const pad = Math.ceil(WALL_MM / ((mmPerUnit && mmPerUnit > 0 ? mmPerUnit : 10) * cell)) + 2;
  const W = Math.ceil((Math.max(...all.map((p) => p.x)) - x0) / cell) + pad * 2;
  const H = Math.ceil((Math.max(...all.map((p) => p.y)) - y0) / cell) + pad * 2;
  const ox = x0 - pad * cell;
  const oy = y0 - pad * cell;
  let grid = new Uint8Array(W * H);
  for (const poly of polys) {
    const xs = poly.map((p) => (p.x - ox) / cell);
    const ys = poly.map((p) => (p.y - oy) / cell);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(W - 1, Math.ceil(Math.max(...xs))); x++)
        if (inPoly(ox + (x + 0.5) * cell, oy + (y + 0.5) * cell, poly)) grid[y * W + x] = 1;
  }
  /* close the walls: grow by the wall's width, then shrink back */
  const r = Math.max(1, pad - 2);
  const pass = (src: Uint8Array, grow: boolean) => {
    const rows = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let v = grow ? 0 : 1;
        for (let k = -r; k <= r && (grow ? !v : v); k++) {
          const xx = x + k;
          const on = xx >= 0 && xx < W && src[y * W + xx] === 1;
          v = grow ? (on ? 1 : 0) : on ? 1 : 0;
        }
        rows[y * W + x] = v;
      }
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let v = grow ? 0 : 1;
        for (let k = -r; k <= r && (grow ? !v : v); k++) {
          const yy = y + k;
          const on = yy >= 0 && yy < H && rows[yy * W + x] === 1;
          v = grow ? (on ? 1 : 0) : on ? 1 : 0;
        }
        out[y * W + x] = v;
      }
    return out;
  };
  grid = pass(pass(grid, true), false);
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && grid[y * W + x] === 1;
  /* the edges between filled and empty cells, clockwise round the filled */
  const next = new Map<number, number>();
  const key = (x: number, y: number) => y * (W + 1) + x;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) next.set(key(x, y), key(x + 1, y));
      if (!on(x + 1, y)) next.set(key(x + 1, y), key(x + 1, y + 1));
      if (!on(x, y + 1)) next.set(key(x + 1, y + 1), key(x, y + 1));
      if (!on(x - 1, y)) next.set(key(x, y + 1), key(x, y));
    }
  const seen = new Set<number>();
  let best: number[] = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let p: number | undefined = start;
    while (p !== undefined && !seen.has(p)) {
      seen.add(p);
      loop.push(p);
      p = next.get(p);
    }
    if (loop.length > best.length) best = loop;
  }
  if (best.length < 4) return null;
  const pts = best.map((k) => ({ x: ox + (k % (W + 1)) * cell, y: oy + Math.floor(k / (W + 1)) * cell }));
  const simple = simplify(pts, cell * 1.6);
  return simple.length >= 3 ? simple : null;
}

/* Douglas–Peucker round a closed loop, from its two farthest-apart points */
function simplify(loop: Point[], tol: number): Point[] {
  const far = (i: number) => loop.reduce((b, p, j) => (Math.hypot(p.x - loop[i].x, p.y - loop[i].y) > Math.hypot(loop[b].x - loop[i].x, loop[b].y - loop[i].y) ? j : b), i);
  const a = 0;
  const b = far(a);
  const half = (from: number, to: number) => {
    const seg: Point[] = [];
    for (let i = from; i !== to; i = (i + 1) % loop.length) seg.push(loop[i]);
    seg.push(loop[to]);
    return dp(seg, tol);
  };
  const one = half(a, b);
  const two = half(b, a);
  return [...one.slice(0, -1), ...two.slice(0, -1)];
}

function dp(pts: Point[], tol: number): Point[] {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / len;
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tol) return [a, b];
  return [...dp(pts.slice(0, at + 1), tol).slice(0, -1), ...dp(pts.slice(at), tol)];
}

/** the outline a floor's subfloor or roof space follows */
export function floorOutline(doc: Pick<DesignDocument, "reading" | "objects">, floor: Floor): Point[] | null {
  return traceOutline(floorPolygons(doc, floor), floor.scaleMmPerUnit);
}

/** the space's outline as it stands: drawn by hand, else the plans', else its floor's */
export function outlineOf(doc: Pick<DesignDocument, "reading" | "objects">, floor: Floor, space: FloorSpace): Point[] | null {
  return space.outline ?? space.planOutline ?? floorOutline(doc, floor);
}

/** its area, m² */
export const areaM2 = (pts: Point[], mmPerUnit: number | null) => (mmPerUnit ? (Math.abs(polygonArea(pts)) * mmPerUnit * mmPerUnit) / 1e6 : null);

/* ── what goes in it ─────────────────────────────────────────────────── */

/** A unit against the space it sits in. An outdoor unit stands in a subfloor
    on its own height; an indoor one hangs, and needs its hangers too. */
export function fitIn(unitHeightMm: number, spaceMm: number, hangersMm = 0): { needMm: number; fits: boolean } {
  const needMm = unitHeightMm + hangersMm;
  return { needMm, fits: spaceMm >= needMm };
}

/** the words beside Where: what it needs against what's there */
export function fitWords(kind: SpaceKind, unitHeightMm: number | null, spaceMm: number | null, hangersMm = 0): { text: string; good: boolean | null } {
  const name = SPACE_NAME[kind].toLowerCase();
  if (spaceMm == null) return { text: `The ${name}'s height isn't set`, good: null };
  if (unitHeightMm == null) return { text: `In the ${name}, ${spaceMm} mm`, good: null };
  const { needMm, fits } = fitIn(unitHeightMm, spaceMm, hangersMm);
  return fits
    ? { text: `Fits, ${needMm} mm ${hangersMm ? "hung" : "tall"} in ${spaceMm} mm`, good: true }
    : { text: `Needs ${needMm} mm, the ${name} is ${spaceMm}`, good: false };
}

/* ── off the plans (the mock https://claude.ai/artifact/B2Cr5YiUkZG7eSrsLd8Uum) ── */

/** what the set says of the subfloor, once read: drawn, only mentioned, or nothing */
export const subfloorRead = (doc: Pick<DesignDocument, "reading">) => doc.reading?.roof?.subfloor ?? null;

/** The subfloor Tiff read, put under the design's lowest floor as the design
    opens: its outline set out where she drew it, its height hers or the one
    typed in a design since. Only a drawn one, under the lowest floor, and
    only where the design has none: one added or changed by hand stays. */
export function subfloorFromReading(doc: DesignDocument): DesignDocument {
  const read = subfloorRead(doc);
  const lowest = lowestFloor(doc);
  if (!read || read.shown !== "drawn" || !lowest || lowest.under || read.floorId !== lowest.id) return doc;
  const sheet = lowest.plans.find((p) => p.id === read.sheetId);
  if (!sheet) return doc;
  const heightMm = read.set?.heightMm ?? (read.heightMm > 0 ? read.heightMm : null);
  const said = read.set ? undefined : read.heightFrom || undefined;
  return withSpace(doc, lowest.id, "under", {
    heightMm,
    outline: null,
    from: "plans",
    planOutline: read.outline.map((p) => ({ x: sheet.x + p.x, y: sheet.y + p.y })),
    ...(said ? { said } : {}),
  });
}

/** The floor menu's word for a subfloor the plans only name: where, as the mock has it ("The plans mention a subfloor, on A200"). */
export function mentionWords(doc: Pick<DesignDocument, "floors" | "reading">): string | null {
  const read = subfloorRead(doc);
  if (!read || read.shown !== "mentioned" || !canAdd(doc, "under")) return null;
  return `The plans mention a subfloor${read.sheet ? `, on ${read.sheet}` : ""}`;
}

/* ── asked of Tiff in the design's chat ──────────────────────────────── */

/** A subfloor asked for in words (Isaac, 15 November 2026: "create a
    subfloor area under family @ 1400 high"): the rooms it runs under, by
    name, on the lowest floor (null keeps where it is; none, the whole
    floor), its height (null keeps it), or taken away. */
export type SubfloorAsk = { rooms: string[] | null; heightMm: number | null; remove: boolean };

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** a room named in words against one on the plan: the same, one inside the
    other ("family" in "Family room"), or a word of it cut short ("kit" for
    the kitchen) */
function names(word: string, name: string): boolean {
  const a = key(word);
  const b = key(name);
  if (!a || !b) return false;
  if (a === b || b.includes(a) || a.includes(b)) return true;
  const as = a.split(" ").filter((t) => t.length >= 3);
  const bs = b.split(" ").filter((t) => t.length >= 3);
  return as.length > 0 && as.every((t) => bs.some((u) => t.startsWith(u) || u.startsWith(t)));
}

/** The rooms on a floor that can stand over a subfloor, each with its outline on the floor. */
function roomsOn(doc: Pick<DesignDocument, "reading" | "objects">, floor: Floor): { name: string; outline: Point[] }[] {
  const out: { name: string; outline: Point[] }[] = [];
  for (const o of doc.objects)
    if (o.floorId === floor.id && o.type === "room" && o.geometry.kind === "polygon" && o.geometry.points.length >= 3)
      out.push({ name: String(o.props.name ?? ""), outline: o.geometry.points });
  for (const r of doc.reading?.floors[floor.id] ?? []) {
    const sheet = floor.plans.find((p) => p.id === r.sheetId);
    if (!sheet) continue;
    for (const sp of r.spaces) if (sp.outline.length >= 3 && standsOver(sp)) out.push({ name: sp.name, outline: sp.outline.map((p) => ({ x: sheet.x + p.x, y: sheet.y + p.y })) });
  }
  return out.filter((r) => r.name.trim());
}

/** The design with the subfloor asked for, and what to say of it; or why it can't be. */
export function askedSubfloor(doc: DesignDocument, ask: SubfloorAsk): { ok: true; doc: DesignDocument; said: string } | { ok: false; said: string } {
  const floor = lowestFloor(doc);
  if (!floor) return { ok: false, said: "The design has no floor to put a subfloor under yet." };
  if (ask.remove) {
    if (!floor.under) return { ok: false, said: "The design has no subfloor to take away." };
    return { ok: true, doc: removeSpace(doc, "under"), said: `Took the subfloor away from under the ${floor.name}.` };
  }
  if (ask.heightMm != null && (heightOf(ask.heightMm) == null || ask.heightMm < 100 || ask.heightMm > 6000))
    return { ok: false, said: `${ask.heightMm} mm isn't a subfloor's height: give it in millimetres, between 100 and 6000.` };
  if (floor.under && ask.rooms == null && ask.heightMm == null) return { ok: false, said: "Say the rooms it runs under, or how high it is." };

  let outline: Point[] | null | undefined;
  let under = "";
  if (ask.rooms && ask.rooms.length > 0) {
    const rooms = roomsOn(doc, floor);
    const picked: { name: string; outline: Point[] }[] = [];
    const missing: string[] = [];
    for (const word of ask.rooms) {
      const hit = rooms.filter((r) => names(word, r.name));
      if (hit.length) picked.push(...hit);
      else missing.push(word);
    }
    if (missing.length) {
      const known = [...new Set(rooms.map((r) => r.name))];
      return {
        ok: false,
        said: `There's no ${andList(missing.map((m) => `"${m}"`))} on the ${floor.name}${known.length ? `. Its rooms are ${andList(known)}` : ", which has no rooms marked or read yet"}.`,
      };
    }
    outline = traceOutline(picked.map((r) => r.outline), floor.scaleMmPerUnit);
    if (!outline) return { ok: false, said: "Those rooms' outline couldn't be traced." };
    under = andList([...new Set(picked.map((r) => r.name))]);
  } else if (ask.rooms) outline = null;

  const was = floor.under;
  /* rooms named: drawn round them, by hand (what the plans drew is kept to
     go back to); the whole floor: it follows the floor; neither: as it was */
  const space: FloorSpace =
    outline === undefined
      ? { heightMm: was?.heightMm ?? null, outline: was?.outline ?? null, from: was?.from ?? "hand", ...(was?.planOutline ? { planOutline: was.planOutline } : {}), ...(was?.said ? { said: was.said } : {}) }
      : outline === null
        ? { heightMm: was?.heightMm ?? null, outline: null, from: "hand" }
        : { heightMm: was?.heightMm ?? null, outline, from: "hand", ...(was?.planOutline ? { planOutline: was.planOutline } : {}) };
  if (ask.heightMm != null) {
    space.heightMm = heightOf(ask.heightMm);
    delete space.said;
  }
  const next = withSpace(doc, floor.id, "under", space);
  const at = outlineOf(next, floor, space);
  const m2 = at ? areaM2(at, floor.scaleMmPerUnit) : null;
  const where = under ? `under ${under}` : space.outline ? "where it was drawn" : `under the whole ${floor.name}`;
  const high = space.heightMm ? `${space.heightMm} mm high` : "its height not set yet";
  return { ok: true, doc: next, said: `${was ? "The subfloor is now" : "Made a subfloor"} ${where}, ${high}${m2 ? `, about ${Math.round(m2)} m²` : ""}.` };
}

