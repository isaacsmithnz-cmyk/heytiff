import type { DesignDocument, Floor, Point } from "./document";
import { floorBasesM, floorHeightM } from "./graph";
import type { ReadSpace, SheetReading, SpaceKind } from "./reading";
import { framingOf, roofHeightAt, roofMesh, type Member, type Mesh, type RoofRect } from "./roof3d";

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

export type Space3D = { name: string; kind: SpaceKind | "zone"; pts: XZ[]; existing: boolean };

export type Opening3D = {
  kind: "door" | "window";
  a: XZ;
  b: XZ;
  external: boolean;
  /** above the floor, metres */
  sill: number;
  head: number;
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
};

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
};

export type Run3D = { floorId: string; pts: [number, number, number][] };

/** A roof part as drawn: its sheets, the walls rising to it, on the floor whose walls carry it. */
export type Roof3D = { floorId: string; existing: boolean; faces: Mesh; fills: Mesh };

/** A floor's ceilings: flat ones as outlines at a height, raked ones as their own surface. */
export type Ceiling3D = { floorId: string; flat: { pts: XZ[]; y: number }[]; raked: Mesh[] };

export type Scene3D = {
  floors: Floor3D[];
  units: Unit3D[];
  pipes: Run3D[];
  /** the roof and its framing, from Tiff's read of the set; empty until she has read it */
  roofs: Roof3D[];
  framing: (Member & { floorId: string })[];
  ceilings: Ceiling3D[];
  /** Tiff has read the roof off the set (it may have found none) */
  roofRead: boolean;
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
type Raw = { floor: Floor; spaces: Space3D[]; openings: Opening3D[]; read: boolean };

function rawFloor(doc: DesignDocument, floor: Floor, ceiling: number): Raw | null {
  const k = floor.scaleMmPerUnit;
  if (!k || k <= 0) return null;
  const m = (p: Point): XZ => [(p.x * k) / 1000, (p.y * k) / 1000];
  const sheets: SheetReading[] = doc.reading?.floors[floor.id] ?? [];
  const spaces: Space3D[] = [];
  const openings: Opening3D[] = [];
  for (const r of sheets) {
    const sheet = floor.plans.find((p) => p.id === r.sheetId);
    if (!sheet) continue;
    const on = (p: Point): XZ => m({ x: sheet.x + p.x, y: sheet.y + p.y });
    for (const s of r.spaces as ReadSpace[]) {
      if (s.outline.length < 3 || s.kind === "notch") continue;
      spaces.push({ name: s.name, kind: s.kind, pts: s.outline.map(on), existing: s.existing });
    }
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
  return spaces.length ? { floor, spaces, openings, read } : null;
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
  let most = standing(below, above, [0, 0]) * CLEARLY_BETTER;
  for (const a of stairsOf(ground)) {
    for (const b of stairsOf(other)) {
      const [ax, az] = centroid(a.pts);
      const [bx, bz] = centroid(b.pts);
      const d: XZ = [ax - bx, az - bz];
      const n = standing(below, above, d);
      if (n > most) {
        most = n;
        best = d;
      }
    }
  }
  if (best) return best;
  if (overlap(g, o) >= 0.5) return [0, 0];
  return [(g.x0 + g.x1) / 2 - (o.x0 + o.x1) / 2, (g.z0 + g.z1) / 2 - (o.z0 + o.z1) / 2];
}

const shift = ([dx, dz]: XZ) => (p: XZ): XZ => [p[0] + dx, p[1] + dz];

/** Everything the 3D view draws for this design. */
export function sceneOf(doc: DesignDocument): Scene3D {
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
    floors.push({
      id: f.id,
      name: f.name,
      level: f.level,
      y0: mm((bases.get(f.id) ?? 0) - ground0),
      ceiling: ceilingOf(f),
      spaces: r.spaces.map((s) => ({ ...s, pts: s.pts.map(mv) })),
      openings: r.openings.map((o) => ({ ...o, a: mv(o.a), b: mv(o.b) })),
      read: r.read,
    });
  }

  const floorById = new Map(floors.map((f) => [f.id, f]));
  const systemType = new Map(doc.systems.map((s) => [s.id, s.type]));
  const units: Unit3D[] = [];
  const pipes: Run3D[] = [];
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
      const h = outdoor ? outdoorHeight(wMm) : ducted ? DUCTED_UNIT_H : WALL_UNIT_H;
      const y = outdoor
        ? o.plane === "external-roof"
          ? f.y0 + f.ceiling + FLOOR_ZONE_M
          : Math.min(0, f.y0)
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
      });
    }
    if (o.type === "pipe-run" && o.geometry.kind === "polyline" && o.geometry.points.length >= 2) {
      /* a run rides in the ceiling cavity over its floor */
      const y = mm(f.y0 + f.ceiling + 0.1);
      pipes.push({ floorId: f.id, pts: o.geometry.points.map((p) => { const [x, z] = m(p); return [x, y, z]; }) });
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
    roofs.push({ floorId: f.id, existing: part.existing, faces, fills });
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
    const raked = rakedSpaces.map(({ s, rake }) => rakedCeiling(s.pts, f.y0 + f.ceiling, f.y0 + rake.highMm / 1000, rects.filter((q) => q.floorId === f.id)));
    ceilings.push({ floorId: f.id, flat, raked });
  }

  const all = floors.flatMap((f) => f.spaces.flatMap((s) => s.pts));
  const b = boxOf(all) ?? { x0: 0, z0: 0, x1: 10, z1: 10 };
  return {
    floors,
    units,
    pipes,
    roofs,
    framing,
    ceilings,
    roofRead: !!roofRead,
    roofRects: rects,
    center: [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2],
    span: Math.max(6, b.x1 - b.x0, b.z1 - b.z0),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** "Kitchen/Living" and "KITCHEN / LIVING" are one room */
const sameName = (a: string, b: string) => norm(a) === norm(b);

/** A raked ceiling: under the roof by a rafter's depth, never below the flat ceiling nor above the height read for it. */
function rakedCeiling(pts: XZ[], flatY: number, highY: number, over: RoofRect[]): Mesh {
  const b = boxOf(pts)!;
  const yAt = (x: number, z: number) => {
    const roof = Math.max(...over.map((r) => roofHeightAt(r, x, z)));
    return mm(Math.max(flatY, Math.min(highY, Number.isFinite(roof) ? roof - 0.16 : flatY)));
  };
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