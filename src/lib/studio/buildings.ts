import { newId, type Building, type DesignDocument, type DesignObject, type Floor, type PlanSheet, type Point } from "./document";
import { boundsOfPoints, distToSegment, polygonArea } from "./geometry";
import { floorBasesM } from "./graph";
import { defaultFloorName, floorDisplayName, formatLevel } from "./plans";
import { touches } from "./room-edit";

/* THE JOB'S BUILDINGS IN THE DESIGN (join 2, "the building": Isaac, 27
   November 2026, "Go head" to https://claude.ai/artifact/6xDKm8xV6f2PGZJKVo6M46,
   boards 2 to 4). A design held only the house's floors, so a guest wing
   over the garage or a cabana by the pool had no floor of its own: it was
   drawn on the house's Level 1, or not at all, and stood at the house's
   heights. Now each is a building with its own floors, its ground floor
   set up or down against the house's.

   A building's floors are the design's floors with its id (document.ts
   Floor.buildingId), so every room, unit, load and list goes on as it was;
   the house is every floor with none. Tiff finds a part of a floor that
   stands apart from the rest of it, as 3570's Bed 8 suite stands 7 m clear
   of its Level 1, and says what's under it. Making it a building moves its
   zones, with what's in them, onto a floor of the building's that carries
   the same sheet cut down to them, so nothing drawn moves on the plan.

   Pure. */

/** The house's id among the buildings: its floors carry none. */
export const HOUSE = "house";

export type BuildingView = {
  /** HOUSE for the house */
  id: string;
  name: string;
  /** lowest first */
  floors: Floor[];
  /** the record; null for the house */
  building: Building | null;
  /** its zones on the design */
  zones: DesignObject[];
};

const rooms = (doc: Pick<DesignDocument, "objects">, floorId: string) =>
  doc.objects.filter((o) => o.type === "room" && o.floorId === floorId && o.geometry.kind === "polygon");

/** The house, then each building, each with its floors and zones. */
export function buildingsOf(doc: Pick<DesignDocument, "floors" | "objects" | "buildings">): BuildingView[] {
  const byLevel = (fs: Floor[]) => [...fs].sort((a, b) => a.level - b.level);
  const zonesOf = (fs: Floor[]) => fs.flatMap((f) => rooms(doc, f.id));
  const house = byLevel(doc.floors.filter((f) => !f.buildingId || !doc.buildings?.some((b) => b.id === f.buildingId)));
  const out: BuildingView[] = [{ id: HOUSE, name: "House", floors: house, building: null, zones: zonesOf(house) }];
  for (const b of doc.buildings ?? []) {
    const floors = byLevel(doc.floors.filter((f) => f.buildingId === b.id));
    out.push({ id: b.id, name: b.name, floors, building: b, zones: zonesOf(floors) });
  }
  return out;
}

/** The building a floor is a floor of; null for the house. */
export const buildingOf = (doc: Pick<DesignDocument, "buildings">, floor: Pick<Floor, "buildingId">): Building | null =>
  (floor.buildingId && doc.buildings?.find((b) => b.id === floor.buildingId)) || null;

/** What the plan's floor button says: the level alone with the house on
    its own; "House, GF" once there are buildings; a building of one floor
    by its name, one of more by its name and the level. */
export function floorWord(doc: Pick<DesignDocument, "floors" | "buildings">, floor: Floor): string {
  if (!doc.buildings?.length) return formatLevel(floor.level);
  const b = buildingOf(doc, floor);
  if (!b) return `House, ${formatLevel(floor.level)}`;
  const mine = doc.floors.filter((f) => f.buildingId === b.id);
  return mine.length > 1 ? `${b.name}, ${formatLevel(floor.level)}` : b.name;
}

/** Where a building sits against the house, in a few words. */
export function levelWords(mm: number | null | undefined): string {
  if (!mm) return "Level with the house";
  const m = (Math.abs(mm) / 1000).toFixed(1);
  return mm > 0 ? `${m} m up` : `${m} m down`;
}

/** A building changed: its name, where it sits, what's under it, where it joins. */
export function setBuilding(doc: DesignDocument, id: string, patch: Partial<Omit<Building, "id">>): DesignDocument {
  if (!doc.buildings?.some((b) => b.id === id)) return doc;
  return { ...doc, buildings: doc.buildings.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
}

/** A floor's name, as its building would have it */
const floorNameIn = (b: Building | null, level: number, first: boolean) =>
  b ? (first ? b.name : `${b.name}, ${defaultFloorName(level)}`) : defaultFloorName(level);

/** A building added by hand: its ground floor blank, at the house's ground
    floor's scale and north, level with the house until it's set. */
export function addBuilding(doc: DesignDocument, name: string): { doc: DesignDocument; id: string; floorId: string } {
  const id = newId("bld");
  const ground = houseGround(doc);
  const building: Building = { id, name, floorMm: null };
  const floor: Floor = {
    id: newId("flr"),
    name,
    level: 0,
    buildingId: id,
    scaleMmPerUnit: ground?.scaleMmPerUnit ?? 10,
    northDeg: ground?.northDeg ?? null,
    northPos: null,
    plans: [],
  };
  return { doc: { ...doc, buildings: [...(doc.buildings ?? []), building], floors: [...doc.floors, floor] }, id, floorId: floor.id };
}

/** A floor added to a building, or to the house (null), over its top one. */
export function addFloorTo(doc: DesignDocument, buildingId: string | null): { doc: DesignDocument; floorId: string } {
  const b = buildingId ? (doc.buildings?.find((x) => x.id === buildingId) ?? null) : null;
  const mine = doc.floors.filter((f) => (b ? f.buildingId === b.id : !f.buildingId));
  const top = mine.reduce((m, f) => Math.max(m, f.level), -1);
  const level = top + 1;
  const like = mine.find((f) => f.level === top) ?? houseGround(doc);
  const floor: Floor = {
    id: newId("flr"),
    name: floorNameIn(b, level, mine.length === 0),
    level,
    ...(b ? { buildingId: b.id } : {}),
    scaleMmPerUnit: like?.scaleMmPerUnit ?? 10,
    northDeg: b ? (like?.northDeg ?? null) : null,
    northPos: null,
    plans: [],
  };
  return { doc: { ...doc, floors: [...doc.floors, floor] }, floorId: floor.id };
}

/** A building whose floors have all gone goes too. */
export function tidyBuildings(doc: DesignDocument): DesignDocument {
  if (!doc.buildings?.length) return doc;
  const kept = doc.buildings.filter((b) => doc.floors.some((f) => f.buildingId === b.id));
  if (kept.length === doc.buildings.length) return doc;
  const { buildings: _gone, ...rest } = doc;
  void _gone;
  return kept.length ? { ...rest, buildings: kept } : rest;
}

const houseGround = (doc: Pick<DesignDocument, "floors">): Floor | undefined => {
  const house = doc.floors.filter((f) => !f.buildingId).sort((a, b) => a.level - b.level);
  return house.find((f) => f.level === 0) ?? house[0];
};

/* ── zones onto another building's floor ── */

const ptsOf = (o: DesignObject): Point[] => (o.geometry.kind === "point" ? [o.geometry.at] : o.geometry.points);
const inside = (p: Point, poly: Point[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
/** the margin a sheet cut down to some zones keeps round them, metres */
const CROP_MARGIN_M = 2;
const GAP = 200;

/** The sheet of a floor a set of points sits on: the one holding their middle. */
function sheetUnder(floor: Floor, pts: Point[]): PlanSheet | null {
  const b = boundsOfPoints(pts);
  if (!b) return null;
  const mid = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  return (
    floor.plans.find((s) => {
      const c = s.crop ?? { x: 0, y: 0, w: s.width, h: s.height };
      return mid.x >= s.x + c.x && mid.x <= s.x + c.x + c.w && mid.y >= s.y + c.y && mid.y <= s.y + c.y + c.h;
    }) ?? null
  );
}

/** Zones moved onto another floor, with every unit in them and everything
    placed inside them, and with them the sheet they're drawn on, cut down to
    them, so each stands on its own drawing where it stood. Null when there's
    nothing of a floor to move, or the floor is where they are. */
export function moveZones(doc: DesignDocument, zoneIds: readonly string[], toFloorId: string): DesignDocument | null {
  const to = doc.floors.find((f) => f.id === toFloorId);
  const zones = doc.objects.filter((o) => zoneIds.includes(o.id) && o.type === "room" && o.geometry.kind === "polygon");
  if (!to || zones.length === 0) return null;
  const fromId = zones[0].floorId;
  const from = doc.floors.find((f) => f.id === fromId);
  if (!from || fromId === toFloorId || zones.some((z) => z.floorId !== fromId)) return null;

  const ids = new Set(zones.map((z) => z.id));
  const outlines = zones.map((z) => ptsOf(z));
  const moving = (o: DesignObject) =>
    o.floorId === fromId &&
    (ids.has(o.id) ||
      (typeof o.props.roomId === "string" && ids.has(o.props.roomId)) ||
      (o.type !== "room" && ptsOf(o).length > 0 && ptsOf(o).every((p) => outlines.some((poly) => inside(p, poly)))));

  /* the sheet they're on, onto the floor they go to: where it's there
     already they go to it, else it comes cut down to them */
  const all = zones.flatMap(ptsOf);
  const sheet = sheetUnder(from, all);
  let plans = to.plans;
  let dx = 0;
  let dy = 0;
  if (sheet) {
    const b = boundsOfPoints(all)!;
    const k = from.scaleMmPerUnit ?? to.scaleMmPerUnit ?? 0;
    const pad = k ? (CROP_MARGIN_M * 1000) / k : 0;
    const there = to.plans.find((s) => s.imageRef === sheet.imageRef);
    const x = there ? there.x : to.plans.length ? Math.max(...to.plans.map((s) => s.x + s.width)) + GAP : sheet.x;
    const y = there ? there.y : to.plans.length ? Math.min(...to.plans.map((s) => s.y)) : sheet.y;
    dx = x - sheet.x;
    dy = y - sheet.y;
    /* what of the sheet they need, in its own pixels, inside the sheet */
    const want = {
      x0: Math.max(0, b.minX - pad - sheet.x),
      y0: Math.max(0, b.minY - pad - sheet.y),
      x1: Math.min(sheet.width, b.maxX + pad - sheet.x),
      y1: Math.min(sheet.height, b.maxY + pad - sheet.y),
    };
    if (there) {
      const c = there.crop;
      plans = c
        ? to.plans.map((s) => {
            if (s.id !== there.id) return s;
            const x0 = Math.min(c.x, want.x0);
            const y0 = Math.min(c.y, want.y0);
            return { ...s, crop: { x: x0, y: y0, w: Math.max(c.x + c.w, want.x1) - x0, h: Math.max(c.y + c.h, want.y1) - y0 } };
          })
        : to.plans;
    } else {
      const { shape: _shape, ...rest } = sheet;
      void _shape;
      plans = [...to.plans, { ...rest, id: newId("sht"), x, y, crop: { x: want.x0, y: want.y0, w: want.x1 - want.x0, h: want.y1 - want.y0 } }];
    }
  }

  const shift = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  const objects = doc.objects.map((o): DesignObject => {
    if (!moving(o)) return o;
    const geometry = o.geometry.kind === "point" ? { ...o.geometry, at: shift(o.geometry.at) } : { ...o.geometry, points: o.geometry.points.map(shift) };
    /* a zone off her read remembers the floor it was read on, so she never offers it there again */
    const props = o.type === "room" && o.props.fromReading === true && o.props.readFloor == null ? { ...o.props, readFloor: fromId } : o.props;
    return { ...o, floorId: toFloorId, geometry, props };
  });
  const floors = doc.floors.map((f) => (f.id === toFloorId ? { ...f, plans, scaleMmPerUnit: f.scaleMmPerUnit ?? from.scaleMmPerUnit } : f));
  return { ...doc, objects, floors };
}

/** Zones of a floor made a building of their own: its ground floor carries
    their sheet cut down to them, set where their floor stands against the
    house's ground floor until somebody says where it sits. */
export function makeBuilding(doc: DesignDocument, name: string, zoneIds: readonly string[], under?: string | null): { doc: DesignDocument; id: string; floorId: string } | null {
  const zone = doc.objects.find((o) => o.id === zoneIds[0] && o.type === "room");
  const from = zone && doc.floors.find((f) => f.id === zone.floorId);
  if (!from) return null;
  const made = addBuilding(doc, name);
  const bases = floorBasesM(doc.floors, doc.buildings);
  const ground = houseGround(doc);
  const up = Math.round((((bases.get(from.id) ?? 0) - (ground ? (bases.get(ground.id) ?? 0) : 0)) * 1000) / 10) * 10;
  const placed = setBuilding(made.doc, made.id, { floorMm: up || null, ...(under ? { under } : {}) });
  const sized = {
    ...placed,
    floors: placed.floors.map((f) =>
      f.id === made.floorId ? { ...f, scaleMmPerUnit: from.scaleMmPerUnit, northDeg: from.northDeg, northPos: from.northPos, ...(from.heightM ? { heightM: from.heightM } : {}) } : f,
    ),
  };
  const moved = moveZones(sized, zoneIds, made.floorId);
  return moved ? { doc: moved, id: made.id, floorId: made.floorId } : null;
}

/* ── what Tiff finds: part of a floor standing apart ── */

/** A part of a house floor that stands clear of the rest of it. */
export type ApartFind = {
  floorId: string;
  /** its zones, the largest first */
  zoneIds: string[];
  names: string[];
  /** how far it stands from the rest, metres, to one place */
  apartM: number;
  /** what's on the floor under it, as the plans name it */
  under: string | null;
};

/** rooms either side of a wall, or a wall and a step: one part of the floor */
const TOUCH_MM = 600;
/** clear of the rest by this much, it's somewhere else */
const APART_MM = 3000;

/** The parts of the house's floors that stand apart from the rest of their
    floor: each zone joined to every zone it touches, and every part but
    the largest that is more than 3 m clear of it. */
export function apartOn(doc: DesignDocument): ApartFind[] {
  const out: ApartFind[] = [];
  for (const f of doc.floors) {
    if (f.buildingId || !f.scaleMmPerUnit) continue;
    const zs = rooms(doc, f.id);
    if (zs.length < 2) continue;
    const k = f.scaleMmPerUnit;
    const pts = zs.map(ptsOf);
    /* parts: each zone with every zone it touches */
    const part = zs.map((_, i) => i);
    const root = (i: number): number => (part[i] === i ? i : (part[i] = root(part[i])));
    for (let i = 0; i < zs.length; i++) for (let j = i + 1; j < zs.length; j++) if (touches(pts[i], pts[j], TOUCH_MM / k)) part[root(i)] = root(j);
    const groups = new Map<number, number[]>();
    zs.forEach((_, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), i]));
    if (groups.size < 2) continue;
    const area = (g: number[]) => g.reduce((s, i) => s + polygonArea(pts[i]), 0);
    const [main, ...rest] = [...groups.values()].sort((a, b) => area(b) - area(a));
    for (const g of rest) {
      /* kept where it is, it isn't asked again */
      if (g.every((i) => zs[i].props.staysOn === f.id)) continue;
      const d = gapBetween(
        g.map((i) => pts[i]),
        main.map((i) => pts[i]),
      );
      if (d * k < APART_MM) continue;
      const ordered = [...g].sort((a, b) => polygonArea(pts[b]) - polygonArea(pts[a]));
      out.push({
        floorId: f.id,
        zoneIds: ordered.map((i) => zs[i].id),
        names: ordered.map((i) => String(zs[i].props.name ?? "Zone")),
        apartM: Math.round((d * k) / 100) / 10,
        under: underOf(doc, f, g.map((i) => pts[i]).flat()),
      });
    }
  }
  return out;
}

/** A part found apart, kept on its floor: Tiff doesn't ask of it again. */
export function keepApart(doc: DesignDocument, zoneIds: readonly string[]): DesignDocument {
  const ids = new Set(zoneIds);
  return { ...doc, objects: doc.objects.map((o) => (ids.has(o.id) && o.type === "room" ? { ...o, props: { ...o.props, staysOn: o.floorId } } : o)) };
}

/** the least distance between two sets of outlines, in plan units */
function gapBetween(a: Point[][], b: Point[][]): number {
  let best = Infinity;
  for (const p of a)
    for (const q of b) {
      for (const v of p) for (let i = 0; i < q.length; i++) best = Math.min(best, distToSegment(v, q[i], q[(i + 1) % q.length]));
      for (const v of q) for (let i = 0; i < p.length; i++) best = Math.min(best, distToSegment(v, p[i], p[(i + 1) % p.length]));
    }
  return best;
}

/** "GARAGE" → "Garage"; a name already written in mixed case stays as it is */
const said = (s: string) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);

/** What the floor below has under a part of a floor, by name: the zone or
    the room she read there that most of it stands over. The floors are
    pages of one set when their sheets are the same size, so a point on one
    is the same point on the other, off each sheet's corner. */
function underOf(doc: DesignDocument, floor: Floor, pts: Point[]): string | null {
  const below = doc.floors.find((f) => !f.buildingId && f.level === floor.level - 1);
  const b = boundsOfPoints(pts);
  const sheet = sheetUnder(floor, pts);
  if (!below || !b || !sheet) return null;
  const twin = below.plans.find((s) => s.width === sheet.width && s.height === sheet.height);
  if (!twin) return null;
  const dx = twin.x - sheet.x;
  const dy = twin.y - sheet.y;
  const box = { x0: b.minX + dx, y0: b.minY + dy, x1: b.maxX + dx, y1: b.maxY + dy };
  const size = (box.x1 - box.x0) * (box.y1 - box.y0);
  if (!(size > 0)) return null;
  const over = (outline: Point[]) => {
    const o = boundsOfPoints(outline);
    if (!o) return 0;
    const w = Math.min(box.x1, o.maxX) - Math.max(box.x0, o.minX);
    const h = Math.min(box.y1, o.maxY) - Math.max(box.y0, o.minY);
    return w > 0 && h > 0 ? (w * h) / size : 0;
  };
  const candidates: { name: string; share: number }[] = [
    ...rooms(doc, below.id).map((z) => ({ name: String(z.props.name ?? ""), share: over(ptsOf(z)) })),
    ...(doc.reading?.floors[below.id] ?? []).flatMap((r) => {
      const at = below.plans.find((s) => s.id === r.sheetId);
      if (!at) return [];
      return r.spaces.filter((s) => s.named).map((s) => ({ name: s.name, share: over(s.outline.map((p) => ({ x: p.x + at.x, y: p.y + at.y }))) }));
    }),
  ].filter((c) => c.name.trim() && c.share >= 0.3);
  const top = candidates.sort((x, y) => y.share - x.share)[0];
  return top ? said(top.name.trim()) : null;
}

/** A building's name for a part found apart: over what's under it, else after its largest zone. */
export const nameForApart = (find: Pick<ApartFind, "names" | "under">): string =>
  find.under ? `Over the ${find.under.toLowerCase()}` : `${said(find.names[0] ?? "The")} wing`;

/** A floor's name as a building's floor menu row says it. */
export const floorRowName = (doc: Pick<DesignDocument, "buildings">, floor: Floor): string => {
  const b = buildingOf(doc, floor);
  if (!b) return floorDisplayName(floor);
  return floor.name.trim() === b.name ? defaultFloorName(floor.level) : floorDisplayName(floor);
};
