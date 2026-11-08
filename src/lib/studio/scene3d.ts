import type { DesignDocument, DesignObject, Floor, Point } from "./document";
import { attachOf, floorBasesM, floorHeightM } from "./graph";
import { ductPaint } from "./duct-size";
import type { GrilleMount, GrilleStyle } from "./grilles";
import { inside, type ReadPoint, type ReadSpace, type SheetReading, type SiteSurfaceKind, type SpaceKind } from "./reading";
import { finishInside, roofFinishFor, stairFinishOf, type RoofFinish, type SurfaceFinish } from "./finishes";
import { framingOf, roofHeightAt, roofMesh, type Member, type Mesh, type RoofRect } from "./roof3d";
import { frameOf, furnish, within, type Piece3D, type ReadPiece } from "./furnish3d";
import { snapOpenings, waysIn } from "./tidy3d";

/* THE DESIGN IN 3D (Isaac, 20 October 2026: "a button on Design"; the board
   https://claude.ai/artifact/VWq6nGGGaCPxCuRnReyCyX, option B). What the 3D
   view draws, worked out from the design alone: pure, no three.js, so the
   arithmetic is tested where it is decided and the view only paints it.

   A floor's spaces come from Tiff's reading of its plans when she has read
   them: every room, cupboard, hall and stair, the whole house. Without a
   reading the floor draws the zones you drew, which is the part the
   design is about. Openings are hers too; units and pipe runs are yours.

   Everything is in metres. The plan's x is the scene's x and the plan's y
   runs to the viewer (z), so north stays where the plan put it. A floor
   with no scale has no metres and is left out.

   FLOORS STACK ON THEIR OWN PLANS, LINED UP (the plans of one house are
   rarely drawn in the same place on their sheets: two floors cropped off
   one page sit side by side). Each floor above or below the ground lines
   up on the ground: stair over stair when both have one, else on its own
   place when the two already overlap, else middle over middle. */

export type XZ = [number, number];

export type Space3D = {
  name: string;
  kind: SpaceKind | "zone";
  pts: XZ[];
  existing: boolean;
  /** a stair's numbering as she read it: "risers 19, treads 18, bottom Hall, top Landing" */
  stair?: string;
  /** the stair's well on the floor its flight rises to: open, no floor */
  well?: boolean;
  /** steps standing free: no walls round them */
  bare?: boolean;
  /** its floor's finish, the closest standard one to what the plan writes in it (finishes.ts); absent when it says nothing */
  finish?: SurfaceFinish;
};

/** A flight of stairs, on the floor it rises from: its bottom step's middle to its top's, its treads' width, how many risers over how high. */
export type Stair3D = {
  floorId: string;
  from: XZ;
  to: XZ;
  w: number;
  y0: number;
  rise: number;
  risers: number;
  finish?: SurfaceFinish;
  /** each tread's reach across the flight, from its line, where the stair's shape narrows (a tread to a riser less than the risers) */
  spans?: [number, number][];
  /** a U stair's half-landing at the top of its first flight: its outline and its height */
  landing?: { pts: XZ[]; y: number };
};

export type Opening3D = {
  kind: "door" | "window";
  a: XZ;
  b: XZ;
  external: boolean;
  /** above the floor, metres */
  sill: number;
  head: number;
  /** cuts the face across a thick wall from the one it's drawn in, and draws nothing there (tidy3d) */
  echo?: boolean;
};

export type Floor3D = {
  id: string;
  name: string;
  level: number;
  /** the floor's level above the ground's, metres */
  y0: number;
  /** floor to ceiling, metres */
  ceiling: number;
  spaces: Space3D[];
  openings: Opening3D[];
  /** whether the spaces are Tiff's reading (true) or the zones drawn (false) */
  read: boolean;
  /** the floor's own drawing, laid on its slab: the part of each sheet the design is on */
  tiles: PlanTile[];
  /** what stands in its rooms: read off the drawing, else by the room's name (furnish3d) */
  pieces: Piece3D[];
  /** its flights of stairs up to the floor above */
  stairs: Stair3D[];
  /** where no wall stands: a flight's foot, open to the room it starts from, and its well's head, open to the landing */
  open?: [XZ, XZ][];
  /** floor laid across a wall's thickness where it's open or a door goes through it (tidy3d) */
  bridges?: XZ[][];
  /** back to the plan: a point here is (p - shift) * 1000 / mm plan units, mm the floor's scale */
  shift?: XZ;
  mm?: number;
  /** true north, degrees clockwise from the plan's up; 0 when unset */
  north?: number;
};

/** A piece of a plan sheet in metres, and where it sits on the image (0 to 1, top left 0). */
export type PlanTile = { ref: string; x0: number; z0: number; x1: number; z1: number; u0: number; v0: number; u1: number; v1: number };

export type Unit3D = {
  id: string;
  floorId: string;
  outdoor: boolean;
  label: string;
  at: XZ;
  /** its underside, metres above the ground */
  y: number;
  w: number;
  h: number;
  d: number;
  /** degrees */
  rot: number;
  /** what it is, off the pack: "wall", "cassette-4way", "ducted", "bulkhead", ..., or "outdoor" */
  form: string;
  /** its system's colour (rule 18a) */
  colour: string;
};

export type Run3D = { floorId: string; pts: [number, number, number][] };

/** A duct as drawn, at its size and in its size's colour, in the cavity it runs in. */
export type Duct3D = { floorId: string; pts: [number, number, number][]; r: number; flex: boolean; body: string; edge: string; rib: string };

/** A grille where it is fixed: its face's middle, its size, metres. */
export type Grille3D = {
  floorId: string;
  at: XZ;
  y: number;
  w: number;
  h: number;
  rot: number;
  mount: GrilleMount;
  style: GrilleStyle;
  stream: "supply" | "return";
};

/** A riser between two floors: a duct (DR) or the pipes (PR), and where it goes through the floor. */
export type Riser3D = { floorId: string; at: XZ; y0: number; y1: number; r: number; duct: boolean; body: string; slab: number };

/** A roof part as drawn: its sheets, the walls rising to it, on the floor whose walls carry it. */
export type Roof3D = { floorId: string; existing: boolean; faces: Mesh; fills: Mesh; finish: RoofFinish | null };

/** The site round the house, in metres on the ground (Isaac, 8 November 2026: "Paths, walkways, streets and driveways too ... neighbours property as a ghost"). */
export type Site3D = {
  boundary: XZ[];
  surfaces: { kind: SiteSurfaceKind; pts: XZ[]; finish: string }[];
  /** the kerb nearest the house and how wide the road is, metres */
  street: { name: string; kerb: [XZ, XZ]; width: number } | null;
  neighbours: { pts: XZ[]; storeys: number; attached: boolean; note: string }[];
  fences: { pts: XZ[]; height: number }[];
};

/** A floor's ceilings: flat ones as outlines at a height, raked ones as their own surface. */
export type Ceiling3D = {
  floorId: string;
  flat: { pts: XZ[]; y: number }[];
  raked: Mesh[];
  /** a raked room's walls, carried on up from the flat ceiling's height to meet it */
  tops: Mesh[];
};

export type Scene3D = {
  floors: Floor3D[];
  units: Unit3D[];
  pipes: Run3D[];
  ducts: Duct3D[];
  grilles: Grille3D[];
  risers: Riser3D[];
  /** the roof and its framing, from Tiff's read of the set; empty until she has read it */
  roofs: Roof3D[];
  framing: (Member & { floorId: string })[];
  ceilings: Ceiling3D[];
  /** Tiff has read the roof off the set (it may have found none) */
  roofRead: boolean;
  /** the site round the house in metres, off Tiff's read of the site plan; null until read, or when the set has none */
  site: Site3D | null;
  /** the roof parts in metres, for the roof-void check */
  roofRects: (RoofRect & { floorId: string })[];
  /** the middle of everything, so the view turns about the house */
  center: XZ;
  /** the longest side of everything, metres, so the camera can stand back far enough */
  span: number;
};

/** The storey's floor-to-floor less a ceiling cavity and a floor zone. */
export const FLOOR_ZONE_M = 0.3;
const SILL_M = 0.9;
const HEAD_M = 2.1;
/** a wall split hangs just under the ceiling; a ducted unit lies in the cavity above it */
const WALL_UNIT_H = 0.3;
const DUCTED_UNIT_H = 0.25;
/** an outdoor unit's height from its width: the big ones are the tall two-fan cabinets */
const outdoorHeight = (wMm: number) => (wMm >= 1000 ? 1.35 : 0.8);

/** Spaces that stand in walls: everything but the open air, holes and the stair's own well. */
export const WALLED: ReadonlySet<Space3D["kind"]> = new Set(["room", "wet", "cupboard", "circulation", "stair", "garage", "other", "zone"]);

/** to the millimetre, so a sum of storeys reads as the metres it is */
const mm = (v: number) => Math.round(v * 1000) / 1000;
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

function centroid(pts: XZ[]): XZ {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return [x / pts.length, z / pts.length];
}

type Box = { x0: number; z0: number; x1: number; z1: number };
function boxOf(pts: XZ[]): Box | null {
  if (!pts.length) return null;
  const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  for (const [x, z] of pts) {
    b.x0 = Math.min(b.x0, x);
    b.z0 = Math.min(b.z0, z);
    b.x1 = Math.max(b.x1, x);
    b.z1 = Math.max(b.z1, z);
  }
  return b;
}
const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.z1 - b.z0);
const meet = (a: Box, b: Box): Box => ({ x0: Math.max(a.x0, b.x0), z0: Math.max(a.z0, b.z0), x1: Math.min(a.x1, b.x1), z1: Math.min(a.z1, b.z1) });
/** how much of the smaller box the two share */
function overlap(a: Box, b: Box): number {
  const i = area(meet(a, b));
  const least = Math.min(area(a), area(b));
  return least > 0 ? i / least : 0;
}

/** A floor's spaces, openings and units in metres, before it is lined up. */
type Raw = { floor: Floor; spaces: Space3D[]; openings: Opening3D[]; read: boolean; furniture?: ReadPiece[]; joinery?: ReadPiece[] };

function rawFloor(doc: DesignDocument, floor: Floor, ceiling: number): Raw | null {
  const k = floor.scaleMmPerUnit;
  if (!k || k <= 0) return null;
  const m = (p: Point): XZ => [(p.x * k) / 1000, (p.y * k) / 1000];
  const sheets: SheetReading[] = doc.reading?.floors[floor.id] ?? [];
  const spaces: Space3D[] = [];
  const openings: Opening3D[] = [];
  const furniture: ReadPiece[] = [];
  const joinery: ReadPiece[] = [];
  /* the plan's own words, kept from the PDF at upload, for the finishes they name */
  const pageOf = new Map(Object.entries(doc.planImport?.placed ?? {}).map(([i, ref]) => [ref, Number(i)]));
  for (const r of sheets) {
    const sheet = floor.plans.find((p) => p.id === r.sheetId);
    if (!sheet) continue;
    const on = (p: Point): XZ => m({ x: sheet.x + p.x, y: sheet.y + p.y });
    const page = pageOf.get(sheet.imageRef);
    const c = sheet.crop;
    const words = (page === undefined ? [] : (doc.planImport?.words?.[page] ?? [])).filter((w) => !c || (w.at.x >= c.x && w.at.x <= c.x + c.w && w.at.y >= c.y && w.at.y <= c.y + c.h));
    const stairs = stairFinishOf(words);
    for (const s of r.spaces as ReadSpace[]) {
      if (s.outline.length < 3 || s.kind === "notch") continue;
      const finish = s.kind === "stair" ? stairs : finishInside(words, s.outline, inside);
      spaces.push({ name: s.name, kind: s.kind, pts: s.outline.map(on), existing: s.existing, ...(s.kind === "stair" ? { stair: s.stair } : {}), ...(finish ? { finish } : {}) });
    }
    for (const f of r.furniture ?? []) if (f.outline.length >= 3) furniture.push({ kind: f.kind, room: f.room, pts: f.outline.map(on) });
    for (const j of r.marks ?? []) if (j.item === "joinery" && j.outline.length >= 3) joinery.push({ kind: j.text, room: j.room, pts: j.outline.map(on) });
    for (const o of r.openings) {
      if (o.kind === "skylight") continue;
      const head = Math.min(HEAD_M, ceiling);
      openings.push({
        kind: o.kind,
        a: on(o.a),
        b: on(o.b),
        external: o.external,
        sill: o.kind === "window" ? Math.min(SILL_M, head - 0.3) : 0,
        head,
      });
    }
  }
  const read = spaces.length > 0;
  if (!read) {
    for (const o of doc.objects) {
      if (o.floorId !== floor.id || o.type !== "room" || o.geometry.kind !== "polygon" || o.geometry.points.length < 3) continue;
      spaces.push({ name: typeof o.props.name === "string" ? o.props.name : "", kind: "zone", pts: o.geometry.points.map(m), existing: false });
    }
  }
  return spaces.length ? { floor, spaces, openings, read, furniture, joinery } : null;
}

const solid = (r: Raw) => r.spaces.filter((s) => WALLED.has(s.kind) && !s.existing);
const stairsOf = (r: Raw) => r.spaces.filter((s) => s.kind === "stair");
/** every walled space's box, old or new: the building one floor stands on */
const walledBoxes = (r: Raw) => r.spaces.filter((s) => WALLED.has(s.kind)).flatMap((s) => boxOf(s.pts) ?? []);

/** How much of the floor above stands on the floor below, moved by `d`:
    each of its spaces' share of the floor below, never more than itself. */
function standing(below: Box[], above: Box[], [dx, dz]: XZ): number {
  let all = 0;
  for (const a of above) {
    const moved = { x0: a.x0 + dx, z0: a.z0 + dz, x1: a.x1 + dx, z1: a.z1 + dz };
    let on = 0;
    for (const b of below) on += area(meet(b, moved));
    all += Math.min(on, area(moved));
  }
  return all;
}

/** As drawn stands unless a stair does this much better: a stair read a
    little off must not walk two floors drawn in register out of it. */
const CLEARLY_BETTER = 1.1;

/** How far to move a floor so it stands over the ground floor.

    A STAIR IS IN THE SAME PLACE ON BOTH FLOORS, so where both have one it
    decides (6 Bishops Ave, 28 October 2026: its two plans sit 4.4 m apart
    on their sheets yet still overlapped by more than half, so the first
    floor stood 4.4 m out over the ground). Every stair below against every
    stair above, since an outdoor stair or an old one kept is a stair too,
    and as drawn: whichever stands most of the floor on the one below. */
export function lineUp(ground: Raw, other: Raw): XZ {
  const g = boxOf(solid(ground).flatMap((s) => s.pts));
  const o = boxOf(solid(other).flatMap((s) => s.pts));
  if (!g || !o) return [0, 0];
  const below = walledBoxes(ground);
  const above = walledBoxes(other);
  let best: XZ | null = null;
  const asDrawn = standing(below, above, [0, 0]);
  let most = asDrawn * CLEARLY_BETTER;
  /* A stair a metre out of register stands the floor as well as the drawing does
     (90 O'Brien St, 9 November 2026: its first floor, narrower than the ground,
     stood over it either way, and its flight came up a metre beside its well).
     Where the two stairs don't already sit over each other, putting them so
     wins whenever it stands the floor near as well as the drawing does. */
  let near = asDrawn * 0.95;
  let nearBest: XZ | null = null;
  for (const a of stairsOf(ground)) {
    for (const b of stairsOf(other)) {
      const ba = boxOf(a.pts)!;
      const bb = boxOf(b.pts)!;
      const d: XZ = [(ba.x0 + ba.x1) / 2 - (bb.x0 + bb.x1) / 2, (ba.z0 + ba.z1) / 2 - (bb.z0 + bb.z1) / 2];
      const n = standing(below, above, d);
      if (n > most) {
        most = n;
        best = d;
      }
      if (overlap(ba, bb) < 0.7 && n >= near) {
        near = n;
        nearBest = d;
      }
    }
  }
  if (best) return best;
  if (nearBest) return nearBest;
  if (overlap(g, o) >= 0.5) return [0, 0];
  return [(g.x0 + g.x1) / 2 - (o.x0 + o.x1) / 2, (g.z0 + g.z1) / 2 - (o.z0 + o.z1) / 2];
}

const shift = ([dx, dz]: XZ) => (p: XZ): XZ => [p[0] + dx, p[1] + dz];

/** what the 3D view can ask the pack about a unit (the next flow) */
export type UnitRow = { form_factor: string; height_mm?: number | null };

/* where a unit sits, from the unit itself: its kind off the pack and its
   plane, not its system's type (7 Cutler's bulkhead heads were drawn as wall
   splits). `top` is the unit's top, from the floor it serves. */
const HIGH_WALL_TOP_M = 2.1;
export function indoorHeight(form: string, underFloor: boolean, base: number, ceiling: number, h: number): number {
  if (underFloor) return base - h - 0.02;
  if (form === "wall") return base + Math.min(HIGH_WALL_TOP_M, ceiling - 0.15) - h;
  if (form === "floor-console" || form === "floor-concealed") return base;
  if (form === "under-ceiling") return base + ceiling - h;
  /* a cassette's face is flush with the ceiling; ducted and bulkhead heads lie over it */
  if (form.startsWith("cassette")) return base + ceiling;
  return base + ceiling + 0.02;
}

/** THE FLOOR'S OWN DRAWING ON ITS SLAB: the part of each sheet the design is
    on, so a floor shows the house as drawn even where nobody has drawn a room.
    The design's own things, and Tiff's spaces when she has read them, with a
    margin round them: never the title block or the next drawing over. */
const TILE_MARGIN_M = 2;
function tilesOf(doc: DesignDocument, f: Floor, raw: Raw, move: XZ): PlanTile[] {
  const k = f.scaleMmPerUnit;
  if (!k) return [];
  const xs: number[] = [];
  const ys: number[] = [];
  const take = (p: Point) => {
    xs.push(p.x);
    ys.push(p.y);
  };
  for (const o of doc.objects) {
    if (o.floorId !== f.id || o.type === "note") continue;
    const g = o.geometry;
    if (g.kind === "point") take(g.at);
    else if ("points" in g) for (const p of g.points) take(p);
  }
  if (raw.read)
    for (const s of raw.spaces)
      for (const [x, z] of s.pts) {
        xs.push((x * 1000) / k);
        ys.push((z * 1000) / k);
      }
  if (!xs.length) return [];
  const pad = (TILE_MARGIN_M * 1000) / k;
  const box = { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
  const out: PlanTile[] = [];
  for (const sh of f.plans) {
    if (!sh.imageRef || !sh.width || !sh.height) continue;
    const c = sh.crop ?? { x: 0, y: 0, w: sh.width, h: sh.height };
    const x0 = Math.max(box.x0, sh.x + c.x);
    const y0 = Math.max(box.y0, sh.y + c.y);
    const x1 = Math.min(box.x1, sh.x + c.x + c.w);
    const y1 = Math.min(box.y1, sh.y + c.y + c.h);
    if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
    const m = (v: number) => (v * k) / 1000;
    out.push({
      ref: sh.imageRef,
      x0: mm(m(x0) + move[0]),
      z0: mm(m(y0) + move[1]),
      x1: mm(m(x1) + move[0]),
      z1: mm(m(y1) + move[1]),
      u0: (x0 - sh.x) / sh.width,
      v0: (y0 - sh.y) / sh.height,
      u1: (x1 - sh.x) / sh.width,
      v1: (y1 - sh.y) / sh.height,
    });
  }
  return out;
}

/** Everything the 3D view draws for this design. `unitRow` is the pack's word
    on a model, when the caller has the pack. */
export function sceneOf(doc: DesignDocument, unitRow?: (model: string) => UnitRow | null): Scene3D {
  const bases = floorBasesM(doc.floors);
  const ordered = [...doc.floors].sort((a, b) => a.level - b.level);
  const groundFloor = ordered.find((f) => f.level === 0) ?? ordered[0];
  const ground0 = groundFloor ? (bases.get(groundFloor.id) ?? 0) : 0;
  /* her heights off the sections win over the storey's default */
  const levelOf = new Map((doc.reading?.roof?.levels ?? []).map((l) => [l.floorId, l]));
  const ceilingOf = (f: Floor) => {
    const read = levelOf.get(f.id);
    return mm(read ? read.ceilingMm / 1000 : Math.max(2.1, floorHeightM(f) - FLOOR_ZONE_M));
  };

  const raws = new Map<string, Raw>();
  for (const f of ordered) {
    const r = rawFloor(doc, f, ceilingOf(f));
    if (r) raws.set(f.id, r);
  }
  const groundRaw = groundFloor ? raws.get(groundFloor.id) : undefined;
  const moves = new Map<string, XZ>();
  for (const [id, r] of raws) moves.set(id, groundRaw && r !== groundRaw ? lineUp(groundRaw, r) : [0, 0]);

  const floors: Floor3D[] = [];
  for (const f of ordered) {
    const r = raws.get(f.id);
    if (!r) continue;
    const mv = shift(moves.get(f.id)!);
    const spaces = r.spaces.map((s) => ({ ...s, pts: s.pts.map(mv) }));
    /* each door and window onto the wall it belongs to (tidy3d) */
    const openings = r.read ? snapOpenings(spaces, r.openings.map((o) => ({ ...o, a: mv(o.a), b: mv(o.b) }))) : r.openings.map((o) => ({ ...o, a: mv(o.a), b: mv(o.b) }));
    floors.push({
      id: f.id,
      name: f.name,
      shift: moves.get(f.id)!,
      mm: f.scaleMmPerUnit ?? undefined,
      north: f.northDeg ?? 0,
      level: f.level,
      y0: mm((bases.get(f.id) ?? 0) - ground0),
      ceiling: ceilingOf(f),
      spaces,
      openings,
      read: r.read,
      tiles: tilesOf(doc, f, r, moves.get(f.id)!),
      pieces: [],
      stairs: [],
    });
  }
  flightsOf(floors);
  /* no wall where the plan has none, and a way into every room; then each room furnished clear of its doors and arches */
  for (const f of floors) {
    const r = raws.get(f.id)!;
    if (!f.read) continue;
    waysIn(f);
    const moved = (p: ReadPiece) => ({ ...p, pts: p.pts.map(shift(moves.get(f.id)!)) });
    const arches = (f.open ?? []).map(([a, b]): Opening3D => ({ kind: "door", a, b, external: false, sill: 0, head: 2.1 }));
    f.pieces = furnish(f.spaces, [...f.openings, ...arches], { furniture: (r.furniture ?? []).map(moved), joinery: (r.joinery ?? []).map(moved) });
  }

  const floorById = new Map(floors.map((f) => [f.id, f]));
  const systemType = new Map(doc.systems.map((s) => [s.id, s.type]));
  const systemColour = new Map(doc.systems.map((s) => [s.id, s.colour]));
  const units: Unit3D[] = [];
  const pipes: Run3D[] = [];
  const unitById = new Map<string, Unit3D>();
  for (const o of doc.objects) {
    const f = floorById.get(o.floorId);
    const floor = doc.floors.find((x) => x.id === o.floorId);
    const k = floor?.scaleMmPerUnit;
    if (!f || !k) continue;
    const mv = shift(moves.get(f.id)!);
    const m = (p: Point): XZ => mv([(p.x * k) / 1000, (p.y * k) / 1000]);
    if (o.type === "unit" && o.geometry.kind === "point") {
      const outdoor = o.props.role === "odu";
      const wMm = num(o.props.widthMm, outdoor ? 800 : 900);
      const dMm = num(o.props.depthMm, outdoor ? 300 : 250);
      const ducted = systemType.get(o.systemId ?? "") === "ducted";
      const row = !outdoor && typeof o.props.model === "string" ? (unitRow?.(o.props.model) ?? null) : null;
      const underFloor = o.plane === "floor-cavity";
      const h = outdoor
        ? outdoorHeight(wMm)
        : row?.height_mm
          ? row.height_mm / 1000
          : ducted || underFloor
            ? DUCTED_UNIT_H
            : WALL_UNIT_H;
      const y = outdoor
        ? o.plane === "external-roof"
          ? f.y0 + f.ceiling + FLOOR_ZONE_M
          : Math.min(0, f.y0)
        : row || underFloor
          ? indoorHeight(row?.form_factor ?? "ducted", underFloor, f.y0, f.ceiling, h)
          : ducted
            ? f.y0 + f.ceiling + 0.02
            : f.y0 + f.ceiling - 0.15 - h;
      units.push({
        id: o.id,
        floorId: f.id,
        outdoor,
        label: typeof o.props.model === "string" ? o.props.model : outdoor ? "Outdoor unit" : "Indoor unit",
        at: m(o.geometry.at),
        y: mm(y),
        w: wMm / 1000,
        h,
        d: dMm / 1000,
        rot: o.geometry.rotation ?? 0,
        form: outdoor ? "outdoor" : (row?.form_factor ?? (ducted || underFloor ? "ducted" : "wall")),
        colour: systemColour.get(o.systemId ?? "") ?? "#050505",
      });
      unitById.set(o.id, units[units.length - 1]);
    }
    if (o.type === "pipe-run" && o.geometry.kind === "polyline" && o.geometry.points.length >= 2) {
      /* a run rides in the ceiling cavity over its floor */
      const y = mm(f.y0 + f.ceiling + 0.1);
      pipes.push({ floorId: f.id, pts: o.geometry.points.map((p) => { const [x, z] = m(p); return [x, y, z]; }), ends: [attachOf(o.props.startAttach)?.id ?? null, attachOf(o.props.endAttach)?.id ?? null] } as Run3D);
    }
  }
  /* PIPES THAT JOIN UP: a run ends where its unit is, not in the air over it.
     Down to an indoor unit's middle; an outdoor unit's tails come out low on
     its side, so the run goes down the outside wall to them. */
  for (const run of pipes as (Run3D & { ends?: (string | null)[] })[]) {
    const [a, b] = run.ends ?? [null, null];
    delete run.ends;
    const drop = (id: string | null, end: [number, number, number], first: boolean) => {
      const u = id ? unitById.get(id) : undefined;
      if (!u) return;
      const y = mm(u.outdoor ? u.y + Math.min(0.35, u.h / 2) : u.y + u.h / 2);
      const p: [number, number, number] = [end[0], y, end[2]];
      if (first) run.pts.unshift(p);
      else run.pts.push(p);
    };
    drop(a, run.pts[0], true);
    drop(b, run.pts[run.pts.length - 1], false);
  }

  /* ── THE AIR SIDE: ducts at their size, in the cavity they run in; the
     grilles they end on; risers between floors ── */
  const byId = new Map(doc.objects.map((o) => [o.id, o]));
  const lowGrille = (o: DesignObject | undefined) => o?.type === "grille" && (o.props.mount === "floor" || o.props.mount === "kicker");
  /** a duct under its floor: it reaches a unit under the floor, or a grille in the floor or a kicker */
  const ductBelow = (o: DesignObject): boolean =>
    [attachOf(o.props.startAttach), attachOf(o.props.endAttach)].some((a) => {
      const t = a ? byId.get(a.id) : undefined;
      return (t?.type === "unit" && t.plane === "floor-cavity") || lowGrille(t);
    });
  const fedBelow = new Set<string>();
  const ductY = (f: Floor3D, below: boolean, r: number) => mm(below ? f.y0 - 0.08 - r : f.y0 + f.ceiling + 0.08 + r);
  for (const o of doc.objects)
    if (o.type === "duct-run" && ductBelow(o))
      for (const a of [attachOf(o.props.startAttach), attachOf(o.props.endAttach)]) if (a?.kind === "grille") fedBelow.add(a.id);

  const grilles: Grille3D[] = [];
  const grilleById = new Map<string, Grille3D>();
  for (const o of doc.objects) {
    if (o.type !== "grille" || o.geometry.kind !== "point") continue;
    const f = floorById.get(o.floorId);
    const k = doc.floors.find((x) => x.id === o.floorId)?.scaleMmPerUnit;
    if (!f || !k) continue;
    const mv = shift(moves.get(f.id)!);
    const w = num(o.props.wMm, 300) / 1000;
    const h = num(o.props.hMm, 300) / 1000;
    const mount: GrilleMount = o.props.mount === "wall" || o.props.mount === "floor" || o.props.mount === "kicker" ? o.props.mount : "ceiling";
    const style: GrilleStyle = o.props.style === "round" || o.props.style === "square" || o.props.style === "linear" ? o.props.style : Math.abs(w - h) < 0.01 ? "square" : "linear";
    const y =
      mount === "ceiling" ? f.y0 + f.ceiling : mount === "floor" ? f.y0 : mount === "kicker" ? f.y0 + 0.05 + h / 2 : fedBelow.has(o.id) ? f.y0 + 0.3 + h / 2 : f.y0 + f.ceiling - 0.3 - h / 2;
    const g: Grille3D = { floorId: f.id, at: mv([(o.geometry.at.x * k) / 1000, (o.geometry.at.y * k) / 1000]), y: mm(y), w, h, rot: o.geometry.rotation ?? 0, mount, style, stream: o.props.stream === "return" ? "return" : "supply" };
    grilles.push(g);
    grilleById.set(o.id, g);
  }

  const ducts: Duct3D[] = [];
  const ductOf = new Map<string, Duct3D>();
  for (const o of doc.objects) {
    if (o.type !== "duct-run" || o.geometry.kind !== "polyline" || o.geometry.points.length < 2) continue;
    const f = floorById.get(o.floorId);
    const k = doc.floors.find((x) => x.id === o.floorId)?.scaleMmPerUnit;
    if (!f || !k) continue;
    const mv = shift(moves.get(f.id)!);
    const dia = num(o.props.diaMm, 250);
    const r = dia / 2000;
    const below = ductBelow(o);
    const y = ductY(f, below, r);
    const pts: [number, number, number][] = o.geometry.points.map((p) => {
      const [x, z] = mv([(p.x * k) / 1000, (p.y * k) / 1000]);
      return [x, y, z];
    });
    /* each end goes to what it is on: down or up to a grille's face, to a unit's middle */
    const endAt = (id: string | undefined): number | null => {
      if (!id) return null;
      const g = grilleById.get(id);
      if (g) return g.mount === "ceiling" ? g.y + 0.01 : g.mount === "floor" ? g.y - 0.01 : g.y;
      const u = unitById.get(id);
      if (u) return mm(u.y + u.h / 2);
      return null;
    };
    const ya = endAt(attachOf(o.props.startAttach)?.id);
    const yb = endAt(attachOf(o.props.endAttach)?.id);
    if (ya != null && Math.abs(ya - y) > 0.02) pts.unshift([pts[0][0], ya, pts[0][2]]);
    if (yb != null && Math.abs(yb - y) > 0.02) pts.push([pts[pts.length - 1][0], yb, pts[pts.length - 1][2]]);
    const paint = ductPaint(dia);
    const d: Duct3D = { floorId: f.id, pts, r, flex: o.props.form !== "rigid", body: paint.body, edge: paint.edge, rib: paint.rib };
    ducts.push(d);
    ductOf.set(o.id, d);
  }

  /* a riser's floors, lower to upper: its group within its system (graph.ts) */
  const risers: Riser3D[] = [];
  const groups = new Map<string, DesignObject[]>();
  for (const o of doc.objects) {
    if (o.type !== "riser" || o.geometry.kind !== "point") continue;
    const key = `${o.systemId ?? ""}:${String(o.props.group ?? "")}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const ductOnRiser = (id: string): Duct3D | undefined => {
    for (const o of doc.objects)
      if (o.type === "duct-run" && [attachOf(o.props.startAttach), attachOf(o.props.endAttach)].some((a) => a?.id === id)) return ductOf.get(o.id);
    return undefined;
  };
  for (const list of groups.values()) {
    const sorted = list
      .map((o) => ({ o, f: floorById.get(o.floorId) }))
      .filter((x): x is { o: DesignObject; f: Floor3D } => !!x.f)
      .sort((a, b) => a.f.level - b.f.level);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const lo = sorted[i];
      const hi = sorted[i + 1];
      const k = doc.floors.find((x) => x.id === lo.f.id)?.scaleMmPerUnit;
      if (!k || lo.o.geometry.kind !== "point") continue;
      const at = shift(moves.get(lo.f.id)!)([(lo.o.geometry.at.x * k) / 1000, (lo.o.geometry.at.y * k) / 1000]);
      const dLo = ductOnRiser(lo.o.id);
      const dHi = ductOnRiser(hi.o.id);
      const d = dLo ?? dHi;
      risers.push({
        floorId: lo.f.id,
        at,
        y0: d ? (dLo ? dLo.pts.find((p) => Math.hypot(p[0] - at[0], p[2] - at[1]) < 0.6)?.[1] ?? dLo.pts[0][1] : lo.f.y0 - 0.2) : mm(lo.f.y0 + lo.f.ceiling + 0.1),
        y1: d ? (dHi ? dHi.pts.find((p) => Math.hypot(p[0] - at[0], p[2] - at[1]) < 0.6)?.[1] ?? dHi.pts[0][1] : hi.f.y0 - 0.2) : mm(hi.f.y0 + hi.f.ceiling + 0.1),
        r: d ? d.r : 0.035,
        duct: !!d,
        body: d ? d.body : "#B45309",
        slab: hi.f.y0,
      });
    }
  }

  /* ── the roof, its framing and the ceilings under it ── */
  const roofs: Roof3D[] = [];
  const framing: Scene3D["framing"] = [];
  const ceilings: Ceiling3D[] = [];
  const roofRead = doc.reading?.roof ?? null;
  const rects: (RoofRect & { floorId: string })[] = [];
  for (const part of roofRead?.parts ?? []) {
    const f = floorById.get(part.floorId);
    const floor = doc.floors.find((x) => x.id === part.floorId);
    const sheet = floor?.plans.find((p) => p.id === part.sheetId);
    const k = floor?.scaleMmPerUnit;
    if (!f || !sheet || !k || part.outline.length < 3) continue;
    const mv = shift(moves.get(f.id)!);
    const pts = part.outline.map((p) => mv([((sheet.x + p.x) * k) / 1000, ((sheet.y + p.y) * k) / 1000]));
    const b = boxOf(pts)!;
    const rect = { ...b, base: mm(f.y0 + part.eaveMm / 1000), part, floorId: f.id };
    rects.push(rect);
    const { faces, fills } = roofMesh(rect);
    roofs.push({ floorId: f.id, existing: part.existing, faces, fills, finish: roofFinishFor(part, roofRead?.material ?? "") });
  }
  for (const f of floors) {
    const rakes = (roofRead?.raked ?? []).filter((r) => r.floorId === f.id);
    const rakedSpaces = f.spaces
      .map((s) => ({ s, rake: rakes.find((r) => sameName(r.room, s.name)) }))
      .filter((x): x is { s: Space3D; rake: (typeof rakes)[number] } => !!x.rake);
    const rakedBoxes = rakedSpaces.map((x) => boxOf(x.s.pts)!);
    const isRaked = (x: number, z: number) => rakedBoxes.some((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1);
    /* an existing roof's timber isn't on the drawings and isn't ours to draw */
    for (const r of rects.filter((q) => q.floorId === f.id && !q.part.existing))
      for (const m of framingOf(r, isRaked)) framing.push({ ...m, floorId: f.id });
    const flat = f.spaces
      .filter((s) => WALLED.has(s.kind) && s.kind !== "stair" && !rakedSpaces.some((x) => x.s === s))
      .map((s) => ({ pts: s.pts, y: mm(f.y0 + f.ceiling) }));
    const over = rects.filter((q) => q.floorId === f.id);
    const raked = rakedSpaces.map(({ s, rake }) => rakedCeiling(s.pts, f.y0 + f.ceiling, f.y0 + rake.highMm / 1000, over));
    /* a kept room's walls are see-through and stay as they were */
    const tops = rakedSpaces.filter(({ s }) => !s.existing).map(({ s, rake }) => rakedTops(s.pts, f.y0 + f.ceiling, f.y0 + rake.highMm / 1000, over));
    ceilings.push({ floorId: f.id, flat, raked, tops });
  }

  const all = floors.flatMap((f) => f.spaces.flatMap((s) => s.pts));
  const b = boxOf(all) ?? { x0: 0, z0: 0, x1: 10, z1: 10 };
  return {
    floors,
    units,
    pipes,
    ducts,
    grilles,
    risers,
    roofs,
    framing,
    ceilings,
    roofRead: !!roofRead,
    site: siteOf(doc, moves),
    roofRects: rects,
    center: [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2],
    span: Math.max(6, b.x1 - b.x0, b.z1 - b.z0),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** "Kitchen/Living" and "KITCHEN / LIVING" are one room */
const sameName = (a: string, b: string) => norm(a) === norm(b);

/** A raked ceiling's height at a point: under the roof by a rafter's depth, never below the flat ceiling nor above the height read for it. */
const rakedY = (flatY: number, highY: number, over: RoofRect[]) => (x: number, z: number) => {
  const roof = Math.max(...over.map((r) => roofHeightAt(r, x, z)));
  return mm(Math.max(flatY, Math.min(highY, Number.isFinite(roof) ? roof - 0.16 : flatY)));
};

/** A raked room's walls from the flat ceiling's height up to its raked ceiling, so none stops short of it. */
export function rakedTops(pts: XZ[], flatY: number, highY: number, over: RoofRect[]): Mesh {
  const yAt = rakedY(flatY, highY, over);
  const verts: [number, number, number][] = [];
  const tris: number[] = [];
  pts.forEach((a, k) => {
    const b = pts[(k + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25));
    const along = Array.from({ length: n + 1 }, (_, i): [number, number, number] => {
      const x = a[0] + ((b[0] - a[0]) * i) / n;
      const z = a[1] + ((b[1] - a[1]) * i) / n;
      return [mm(x), yAt(x, z), mm(z)];
    });
    /* a wall the ceiling doesn't rise over needs nothing more */
    if (along.every(([, y]) => y <= flatY + 0.005)) return;
    along.forEach(([x, y, z], i) => {
      verts.push([x, mm(flatY), z], [x, y, z]);
      if (i) {
        const c = verts.length - 2;
        tris.push(c - 2, c, c + 1, c - 2, c + 1, c - 1);
      }
    });
  });
  return { verts, tris };
}

/** A raked ceiling: under the roof by a rafter's depth, never below the flat ceiling nor above the height read for it. */
function rakedCeiling(pts: XZ[], flatY: number, highY: number, over: RoofRect[]): Mesh {
  const b = boxOf(pts)!;
  const yAt = rakedY(flatY, highY, over);
  const nx = Math.max(1, Math.ceil((b.x1 - b.x0) / 0.25));
  const nz = Math.max(1, Math.ceil((b.z1 - b.z0) / 0.25));
  const verts: [number, number, number][] = [];
  const tris: number[] = [];
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const x = b.x0 + ((b.x1 - b.x0) * i) / nx;
      const z = b.z0 + ((b.z1 - b.z0) * j) / nz;
      verts.push([mm(x), yAt(x, z), mm(z)]);
      if (i && j) {
        const c = i * (nz + 1) + j;
        tris.push(c - nz - 2, c - 1, c, c - nz - 2, c, c - nz - 1);
      }
    }
  return { verts, tris };
}

/** The middle of a space, for its label. */
export const middleOf = centroid;

/* THE STAIRS AS STEPS (mock, 8 November 2026). A stair read on a floor with
   a stair over it on the floor above is a flight between the two: it rises
   along its long way, from the end nearer the room she read at its bottom,
   in the risers she counted or as many 180 mm risers as the height takes.
   The stair above is its well, open to it.

   A STAIR THAT TURNS BACK (Isaac, 9 November 2026: "staircases going into
   walls"): where its bottom and its top are at the same end (the hall
   below, the landing above, both at the stair's south end, 90 O'Brien St
   and 27 Milroy Ave), it is a U: up one half to a landing at the far end,
   back along the other half. Drawn straight, it rose into the outside
   wall. The half it starts up is the one her outline fills at its foot. */
export function flightsOf(floors: Floor3D[]) {
  const byHeight = [...floors].sort((a, b) => a.y0 - b.y0);
  const used = new Set<Space3D>();
  byHeight.forEach((f, i) => {
    const up = byHeight[i + 1];
    if (!up || up.y0 - f.y0 < 1.5) return;
    for (const s of f.spaces) {
      if (s.kind !== "stair") continue;
      const sb = boxOf(s.pts)!;
      /* the stair above that this one rises to: over it, and (where two are) the one whose own read says it comes up from below, not one going on up */
      const goesOn = (t: Space3D) => /top\s+[^,]*(above|upper|\bup\b)/i.test(t.stair ?? "") && !/bottom\s+[^,]*(below|lower|ground|floor)/i.test(t.stair ?? "");
      const over = up.spaces
        .filter((t) => t.kind === "stair" && !used.has(t) && overlap(sb, boxOf(t.pts)!) > 0.4)
        .sort((p, q) => Number(goesOn(p)) - Number(goesOn(q)) || overlap(sb, boxOf(q.pts)!) - overlap(sb, boxOf(p.pts)!))[0];
      if (!over) continue;
      over.well = true;
      used.add(s).add(over);
      const fr = frameOf(s.pts);
      const a: XZ = [fr.c[0] - (fr.u[0] * fr.lu) / 2, fr.c[1] - (fr.u[1] * fr.lu) / 2];
      const b: XZ = [fr.c[0] + (fr.u[0] * fr.lu) / 2, fr.c[1] + (fr.u[1] * fr.lu) / 2];
      const said = (end: "bottom" | "top") => new RegExp(`${end}\\s+([^,(]+)`, "i").exec(s.stair ?? "")?.[1]?.trim() ?? "";
      const bottom = endOf(f, s, [a, b], said("bottom"));
      const topSaid = /top\s+([^,(]+)/i.exec(over.stair ?? "")?.[1]?.trim() || said("top");
      const top = endOf(up, over, [a, b], topSaid);
      const rise = mm(up.y0 - f.y0);
      const counted = Number(/risers\s+(\d+)/i.exec(s.stair ?? "")?.[1]);
      const risers = counted >= 3 && counted <= 30 ? counted : Math.max(3, Math.round(rise / 0.18));
      const finish = s.finish ? { finish: s.finish } : {};
      const turns = bottom !== null && top !== null && bottom === top && fr.lu >= 2 && fr.lv >= 1.5;
      if (turns) {
        const foot = bottom === 0 ? a : b;
        const head = bottom === 0 ? b : a;
        const along: XZ = [(head[0] - foot[0]) / fr.lu, (head[1] - foot[1]) / fr.lu];
        const across = fr.v;
        const at = (p: XZ, k: number): XZ => [mm(p[0] + across[0] * k), mm(p[1] + across[1] * k)];
        const back = (p: XZ, d: number): XZ => [p[0] - along[0] * d, p[1] - along[1] * d];
        /* the half her outline fills at the foot goes up first */
        const filled = (side: number) => within(at([foot[0] + along[0] * 0.3, foot[1] + along[1] * 0.3], (side * fr.lv) / 4), s.pts);
        const first = filled(-1) || !filled(1) ? -1 : 1;
        const deep = Math.max(0.9, Math.min(1.2, fr.lv / 2));
        const n1 = Math.ceil(risers / 2);
        const r1 = mm((rise * n1) / risers);
        const half = mm(fr.lv / 2);
        f.stairs.push(
          { floorId: f.id, from: at(foot, (first * fr.lv) / 4), to: at(back(head, deep), (first * fr.lv) / 4), w: half, y0: f.y0, rise: r1, risers: n1, ...finish, landing: { pts: [at(head, -fr.lv / 2), at(head, fr.lv / 2), at(back(head, deep), fr.lv / 2), at(back(head, deep), -fr.lv / 2)], y: mm(f.y0 + r1) } },
          { floorId: f.id, from: at(back(head, deep), (-first * fr.lv) / 4), to: at(foot, (-first * fr.lv) / 4), w: half, y0: mm(f.y0 + r1), rise: mm(rise - r1), risers: risers - n1, ...finish },
        );
        /* open at the foot on the half it starts up, and at the top on the half it arrives by */
        (f.open ??= []).push([at(foot, (first * fr.lv) / 2), at(foot, 0)]);
        /* on the well's own end, as drawn above: the half the second flight arrives by */
        const fo = frameOf(over.pts);
        const ends: XZ[] = [-1, 1].map((k): XZ => [fo.c[0] + (fo.u[0] * fo.lu * k) / 2, fo.c[1] + (fo.u[1] * fo.lu * k) / 2]);
        const wellFoot = ends.sort((p, q) => Math.hypot(p[0] - foot[0], p[1] - foot[1]) - Math.hypot(q[0] - foot[0], q[1] - foot[1]))[0];
        const sign = fo.v[0] * across[0] + fo.v[1] * across[1] < 0 ? -1 : 1;
        const arrive = (k: number): XZ => [mm(wellFoot[0] + fo.v[0] * sign * k), mm(wellFoot[1] + fo.v[1] * sign * k)];
        (up.open ??= []).push([arrive(0), arrive((-first * fo.lv) / 2)]);
        continue;
      }
      let [from, to] = [a, b];
      if (bottom === 1 || (bottom === null && top === 0)) [from, to] = [b, a];
      f.stairs.push({ floorId: f.id, from, to, w: mm(fr.lv), y0: f.y0, rise, risers, ...finish, spans: spansOf(s.pts, from, to, risers - 1, fr.lv) });
      /* no wall across its foot, nor across its well's head on the floor above */
      (f.open ??= []).push(edgeNear(s.pts, from));
      (up.open ??= []).push(edgeNear(over.pts, to));
    }
  });
  for (const f of byHeight) for (const s of f.spaces) if (s.kind === "stair" && !used.has(s)) loneStair(f, s);
}

/* A STAIR WITH NO STAIR OVER OR UNDER IT (Isaac, 9 November 2026: "rooms
   going to nowhere"): drawn as a walled box with no steps, it read as a
   cupboard. Now, by what she read at its ends:
   - its top is a room here and its bottom isn't (the floor below isn't in
     the design): a stairwell, railed, going down from that room;
   - its bottom is a room here and its top isn't: a flight going up out of
     the room, a storey high, standing free;
   - both ends are here (steps between the garden and the path, or down
     into a sunken family room): its steps, as many as she counted, with
     no walls round them. */
function loneStair(f: Floor3D, s: Space3D) {
  const fr = frameOf(s.pts);
  if (fr.lu < 0.6) return;
  const a: XZ = [fr.c[0] - (fr.u[0] * fr.lu) / 2, fr.c[1] - (fr.u[1] * fr.lu) / 2];
  const b: XZ = [fr.c[0] + (fr.u[0] * fr.lu) / 2, fr.c[1] + (fr.u[1] * fr.lu) / 2];
  const said = (end: "bottom" | "top") => new RegExp(`${end}\\s+([^,(]+)`, "i").exec(s.stair ?? "")?.[1]?.trim() ?? "";
  /* "ground floor", "level below", "first floor hallway": a floor, not a room on this one */
  const here = (t: string) => f.spaces.some((x) => x !== s && roomWords(x.name).some((w) => roomWords(t).includes(w)));
  const floorish = (t: string) => /floor|level|below|above|upstairs|downstairs|upper|lower|\bup\b|\bdown\b/i.test(t) && !here(t);
  /* nothing read at either end: most likely the stair up to a floor the plans she was given don't show */
  const [lo, hi] = !said("bottom") && !said("top") ? [false, true] : [floorish(said("bottom")), floorish(said("top"))];
  const counted = Number(/risers\s+(\d+)/i.exec(s.stair ?? "")?.[1]);
  const storey = mm(f.ceiling + FLOOR_ZONE_M);
  const finish = s.finish ? { finish: s.finish } : {};
  const flight = (from: XZ, to: XZ, y0: number, rise: number, risers: number) =>
    f.stairs.push({ floorId: f.id, from, to, w: mm(fr.lv), y0: mm(y0), rise: mm(rise), risers, ...finish, spans: spansOf(s.pts, from, to, risers - 1, fr.lv) });
  const steps = (rise: number) => (counted >= 2 && counted <= 30 ? counted : Math.max(2, Math.round(rise / 0.18)));
  if (lo && !hi) {
    /* down to a floor the design hasn't got: from the room at its top */
    const top = endOf(f, s, [a, b], said("top"));
    const [head, foot] = top === 1 ? [b, a] : [a, b];
    flight(foot, head, f.y0 - storey, storey, steps(storey));
    s.well = true;
    (f.open ??= []).push(edgeNear(s.pts, head));
    return;
  }
  if (hi && !lo) {
    /* up to a floor the design hasn't got */
    const bottom = endOf(f, s, [a, b], said("bottom"));
    const [foot, head] = bottom === 1 ? [b, a] : [a, b];
    flight(foot, head, f.y0, storey, steps(storey));
    s.bare = true;
    return;
  }
  /* steps between two places on this floor */
  const bottom = endOf(f, s, [a, b], said("bottom"));
  const top = endOf(f, s, [a, b], said("top"));
  const [foot, head] = bottom === 1 || (bottom === null && top === 0) ? [b, a] : [a, b];
  const risers = steps(0.9);
  const rise = mm(risers * 0.175);
  /* into a room here from outside, the steps come down from its floor; otherwise they rise from it */
  const inRoom = (t: string) => f.spaces.some((x) => x !== s && INDOOR_KINDS.has(x.kind) && roomWords(x.name).some((w) => roomWords(t).includes(w)));
  flight(foot, head, inRoom(said("top")) && !inRoom(said("bottom")) ? f.y0 - rise : f.y0, rise, risers);
  s.bare = true;
}
const INDOOR_KINDS: ReadonlySet<Space3D["kind"]> = new Set(["room", "wet", "circulation", "garage", "other", "zone"]);

/** Words that name a room, not a floor: "HALL / DINING" is the hall and the dining; "ground floor" names none. */
const roomWords = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !["floor", "ground", "first", "second", "level", "upper", "lower", "below", "above", "the", "and", "top", "bottom", "stair", "stairs"].includes(w));

/** Which end of a stair (0 or 1) a room is at: the room she named there, else the one walkable space past one end and not the other. null when it can't be told. */
function endOf(f: Floor3D, stair: Space3D, ends: [XZ, XZ], said: string, namedOnly = false): 0 | 1 | null {
  const others = f.spaces.filter((x) => x !== stair && x.kind !== "stair" && x.kind !== "void" && x.kind !== "notch");
  const gap = (p: XZ, x: Space3D) => (within(p, x.pts) ? 0 : Math.min(...x.pts.map((q, k) => segDist(p, q, x.pts[(k + 1) % x.pts.length]))));
  const want = roomWords(said);
  const named = want.length ? others.filter((x) => roomWords(x.name).some((w) => want.includes(w))) : [];
  if (named.length) {
    const d = ends.map((e) => Math.min(...named.map((x) => gap(e, x))));
    if (Math.abs(d[0] - d[1]) > 0.3) return d[0] < d[1] ? 0 : 1;
  }
  if (namedOnly) return null;
  /* past each end, half a metre out */
  const c = middleOf(stair.pts);
  const past = ends.map((e) => {
    const L = Math.hypot(e[0] - c[0], e[1] - c[1]) || 1;
    const p: XZ = [e[0] + ((e[0] - c[0]) / L) * 0.5, e[1] + ((e[1] - c[1]) / L) * 0.5];
    return others.some((x) => x.kind !== "outdoor" && within(p, x.pts));
  });
  if (past[0] !== past[1]) return past[0] ? 0 : 1;
  return null;
}

function segDist(p: XZ, a: XZ, b: XZ) {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t);
}

/** How far each tread reaches either side of the flight's line, inside the stair's own shape: an L-shaped stair's treads narrow where it does. */
function spansOf(pts: XZ[], from: XZ, to: XZ, treads: number, w: number): [number, number][] {
  const run = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (run < 0.5 || treads < 1) return [];
  const ux = (to[0] - from[0]) / run;
  const uz = (to[1] - from[1]) / run;
  /* across the flight, as the 3D lays a tread: (uz, -ux) */
  const vx = uz;
  const vz = -ux;
  return Array.from({ length: treads }, (_, i): [number, number] => {
    const t = ((i + 0.5) * run) / treads;
    const c: XZ = [from[0] + ux * t, from[1] + uz * t];
    const hits: number[] = [];
    pts.forEach((a, k) => {
      const b = pts[(k + 1) % pts.length];
      /* where the line across, c + s v, meets the side a to b */
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const den = vx * ez - vz * ex;
      if (Math.abs(den) < 1e-9) return;
      const q = ((a[0] - c[0]) * vz - (a[1] - c[1]) * vx) / den;
      if (q < -1e-9 || q > 1 + 1e-9) return;
      hits.push(((a[0] - c[0]) * ez - (a[1] - c[1]) * ex) / den);
    });
    return hits.length >= 2 ? [mm(Math.min(...hits)), mm(Math.max(...hits))] : [mm(-w / 2), mm(w / 2)];
  });
}

/** The side of a shape nearest a point. */
function edgeNear(pts: XZ[], p: XZ): [XZ, XZ] {
  let best: [XZ, XZ] = [pts[0], pts[1 % pts.length]];
  let least = Infinity;
  pts.forEach((a, k) => {
    const b = pts[(k + 1) % pts.length];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / (ex * ex + ez * ez || 1)));
    const d = Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t);
    if (d < least) {
      least = d;
      best = [a, b];
    }
  });
  return best;
}

/* ── THE ROOF VOID, FOR TIFF (Isaac, 20 October 2026: "can I fit a ducted
   unit in the roof void?"). Over every room with a roof above it: how much
   clear height there is between the top of the ceiling joists and the
   underside of the rafters, lowest and highest, sampled across the room.
   The framing is the standard one drawn in 3D (rafters at 600, joists at
   450), because a set seldom has a framing plan; she says so. ── */
const RAFTER_DEPTH = 0.14;
const JOIST_DEPTH = 0.12;

export function roofSummary(doc: DesignDocument) {
  const roof = doc.reading?.roof;
  if (!roof) return { read: false as const, said: "Tiff hasn't read the roof off this design's drawings yet: Read the plans in Design's 3D view reads it." };
  const scene = sceneOf(doc);
  const nameOf = new Map(doc.floors.map((f) => [f.id, f.name]));
  const voids = scene.floors.flatMap((f) => {
    const over = scene.roofRects;
    const raked = new Set(roof.raked.filter((r) => r.floorId === f.id).map((r) => norm(r.room)));
    return f.spaces
      .filter((sp) => WALLED.has(sp.kind) && sp.kind !== "stair" && !sp.existing)
      .flatMap((sp) => {
        const b = boxOf(sp.pts)!;
        const top = f.y0 + f.ceiling + JOIST_DEPTH;
        const clears: number[] = [];
        for (let i = 0; i <= 8; i++)
          for (let j = 0; j <= 8; j++) {
            const x = b.x0 + ((b.x1 - b.x0) * i) / 8;
            const z = b.z0 + ((b.z1 - b.z0) * j) / 8;
            const roofY = Math.max(...over.map((r) => roofHeightAt(r, x, z)));
            if (Number.isFinite(roofY)) clears.push(roofY - RAFTER_DEPTH - top);
          }
        if (!clears.length) return [];
        const isRaked = raked.has(norm(sp.name));
        return [
          {
            floor: nameOf.get(f.id) ?? f.name,
            room: sp.name,
            ceiling: isRaked ? "raked: no roof void over it" : "flat",
            clear_mm_lowest: isRaked ? 0 : Math.max(0, Math.round(Math.min(...clears) * 1000)),
            clear_mm_highest: isRaked ? 0 : Math.max(0, Math.round(Math.max(...clears) * 1000)),
          },
        ];
      });
  });
  return {
    read: true as const,
    levels: roof.levels.map((l) => ({ floor: nameOf.get(l.floorId) ?? "", ceiling_mm: l.ceilingMm, floor_zone_mm: l.floorZoneMm, source: l.source })),
    parts: roof.parts.map((p) => {
      const pts = p.outline;
      const k = doc.floors.find((f) => f.id === p.floorId)?.scaleMmPerUnit ?? null;
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      const size = k ? `${(((Math.max(...xs) - Math.min(...xs)) * k) / 1000).toFixed(1)} m by ${(((Math.max(...ys) - Math.min(...ys)) * k) / 1000).toFixed(1)} m` : "unscaled";
      return { floor: nameOf.get(p.floorId) ?? "", form: p.form, pitch_deg: p.pitchDeg, eave_mm: p.eaveMm, overhang_mm: p.overhangMm, size, existing: p.existing, source: p.source };
    }),
    raked: roof.raked.map((r) => ({ floor: nameOf.get(r.floorId) ?? "", room: r.room, low_mm: r.lowMm, high_mm: r.highMm })),
    material: roof.material,
    roof_space: roof.roofSpace,
    framing: "Not on the drawings: drawn at standard spacings, rafters 140 deep at 600 mm, ceiling joists 120 deep at 450 mm. The builder's framing may differ.",
    void_over_rooms: voids,
  };
}
/** A point in the 3D, in metres, back on its floor's plan, in plan units: where a tap on the 3D lands on the drawing. */
export function toPlan(f: Pick<Floor3D, "shift" | "mm">, p: XZ): { x: number; y: number } | null {
  if (!f.mm) return null;
  const [dx, dz] = f.shift ?? [0, 0];
  return { x: ((p[0] - dx) * 1000) / f.mm, y: ((p[1] - dz) * 1000) / f.mm };
}

/** Tiff's read of the site, in metres on the ground floor as the 3D lays it. */
function siteOf(doc: DesignDocument, moves: Map<string, XZ>): Site3D | null {
  const site = doc.reading?.site;
  if (!site) return null;
  const floor = doc.floors.find((x) => x.id === site.floorId);
  const sheet = floor?.plans.find((p) => p.id === site.sheetId);
  const k = floor?.scaleMmPerUnit;
  if (!floor || !sheet || !k) return null;
  const mv = shift(moves.get(floor.id) ?? [0, 0]);
  const M = (p: ReadPoint): XZ => {
    const [x, z] = mv([((sheet.x + p.x) * k) / 1000, ((sheet.y + p.y) * k) / 1000]);
    return [mm(x), mm(z)];
  };
  const kerb = site.street?.kerb.map(M);
  return {
    boundary: site.boundary.map(M),
    surfaces: site.surfaces.map((x) => ({ kind: x.kind, pts: x.outline.map(M), finish: x.finish })),
    street: site.street && kerb && kerb.length >= 2 ? { name: site.street.name, kerb: [kerb[0], kerb[kerb.length - 1]], width: site.street.widthMm / 1000 } : null,
    neighbours: site.neighbours.map((x) => ({ pts: x.outline.map(M), storeys: x.storeys, attached: x.attached, note: x.note })),
    fences: site.fences.map((x) => ({ pts: x.line.map(M), height: x.heightMm / 1000 })),
  };
}
