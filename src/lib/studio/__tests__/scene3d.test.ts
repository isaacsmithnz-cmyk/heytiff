import { createDesign, type DesignDocument, type DesignObject, type Floor } from "../document";
import type { ReadSpace, SheetReading } from "../reading";
import { lineUp, sceneOf, threeDState } from "../scene3d";

/* The 3D view's arithmetic (lib/studio/scene3d): what it draws, in metres,
   and how the floors stand on each other. */

const sheet = (id: string, x = 0, y = 0) => ({ id, imageRef: `r/${id}.png`, pageNumber: 1, name: id, width: 2400, height: 1700, x, y });

function floor(id: string, level: number, over: Partial<Floor> = {}): Floor {
  return { id, name: id, level, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [sheet(`s-${id}`)], ...over };
}

const space = (name: string, kind: ReadSpace["kind"], [x0, y0, x1, y1]: number[], existing = false): ReadSpace => ({
  name,
  named: true,
  kind,
  outline: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
  written: "",
  existing,
  openTo: "",
  stair: "",
});

const read = (sheetId: string, spaces: ReadSpace[], openings: SheetReading["openings"] = []): SheetReading => ({
  sheetId,
  spaces,
  openings,
  marks: [],
  furniture: [],
  checklist: [],
  flags: [],
  planUp: "",
});

function design(floors: Floor[], reading: Record<string, SheetReading[]> | null, objects: DesignObject[] = []): DesignDocument {
  const d = createDesign({ name: "House", mode: "plan" });
  return {
    ...d,
    floors,
    objects,
    systems: [{ id: "sys", type: "ducted", brand: "x", colour: "#000", name: "Ducted", settings: {} }],
    reading: reading ? { at: "2026-10-20T00:00:00Z", model: "m", floors: reading, failed: [] } : null,
  };
}

describe("a floor's spaces", () => {
  it("are Tiff's reading in metres, from the sheet's own pixels where it sits", () => {
    const f = floor("gf", 0, { plans: [sheet("s-gf", 100, 0)] });
    const s = sceneOf(design([f], { gf: [read("s-gf", [space("Lounge", "room", [0, 0, 400, 300])])] }));
    expect(s.floors).toHaveLength(1);
    expect(s.floors[0].read).toBe(true);
    // 10 mm a pixel: 100 + 400 px = 5 m
    expect(s.floors[0].spaces[0].pts).toEqual([
      [1, 0],
      [5, 0],
      [5, 3],
      [1, 3],
    ]);
  });

  it("are the zones you drew when she hasn't read the plans", () => {
    const zone: DesignObject = {
      id: "z1",
      type: "room",
      systemId: null,
      floorId: "gf",
      plane: "room",
      geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }] },
      props: { name: "Bed 1" },
    };
    const s = sceneOf(design([floor("gf", 0)], null, [zone]));
    expect(s.floors[0]).toMatchObject({ read: false, spaces: [{ name: "Bed 1", kind: "zone" }] });
  });

  it("leaves out a floor with no scale, and says when nothing can be drawn", () => {
    const d = design([floor("gf", 0, { scaleMmPerUnit: null })], { gf: [read("s-gf", [space("Lounge", "room", [0, 0, 400, 300])])] });
    expect(sceneOf(d).floors).toEqual([]);
    expect(threeDState(d)).toEqual({ drawable: false, read: false, plans: true });
  });

  it("gives a window a sill and a door the floor, both under the ceiling", () => {
    const opening = (kind: "door" | "window") => ({ kind, tag: "", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, widthMm: 1000, room: "Lounge", external: true, facing: "N" });
    const s = sceneOf(design([floor("gf", 0)], { gf: [read("s-gf", [space("Lounge", "room", [0, 0, 400, 300])], [opening("window"), opening("door")])] }));
    expect(s.floors[0].openings.map((o) => [o.kind, o.sill, o.head])).toEqual([
      ["window", 0.9, 2.1],
      ["door", 0, 2.1],
    ]);
  });
});

describe("floors stack", () => {
  it("each on the one below, by its storey height less the floor zone", () => {
    const s = sceneOf(
      design([floor("gf", 0, { heightM: 3.2 }), floor("l1", 1)], {
        gf: [read("s-gf", [space("Lounge", "room", [0, 0, 400, 300])])],
        l1: [read("s-l1", [space("Bed", "room", [0, 0, 400, 300])])],
      }),
    );
    expect(s.floors.map((f) => [f.id, f.y0, f.ceiling])).toEqual([
      ["gf", 0, 2.9],
      ["l1", 3.2, 2.7],
    ]);
  });

  const g = (spaces: ReadSpace[]) => ({
    floor: floor("gf", 0),
    openings: [],
    read: true,
    spaces: spaces.map((s) => ({ name: s.name, kind: s.kind, existing: s.existing, pts: s.outline.map((p) => [p.x / 100, p.y / 100] as [number, number]) })),
  });

  it("where they already overlap, as drawn", () => {
    expect(lineUp(g([space("A", "room", [0, 0, 1000, 800])]), g([space("B", "room", [100, 100, 900, 700])]))).toEqual([0, 0]);
  });

  it("stair over stair when the plans sit apart", () => {
    const ground = g([space("A", "room", [0, 0, 1000, 800]), space("Stair", "stair", [800, 0, 1000, 300])]);
    const upper = g([space("B", "room", [3000, 0, 3800, 800]), space("Stair", "stair", [3600, 0, 3800, 300])]);
    expect(lineUp(ground, upper)).toEqual([-28, 0]);
  });

  it("middle over middle with no stair to go by", () => {
    expect(lineUp(g([space("A", "room", [0, 0, 1000, 800])]), g([space("B", "room", [3000, 2000, 3400, 2400])]))).toEqual([-27, -18]);
  });
});

describe("units and runs", () => {
  const unit = (id: string, role: "idu" | "odu", systemId: string, plane: DesignObject["plane"] = "room"): DesignObject => ({
    id,
    type: "unit",
    systemId,
    floorId: "gf",
    plane,
    geometry: { kind: "point", at: { x: 200, y: 100 } },
    props: { role, model: role === "odu" ? "PUZ-M100" : "PEAD-M100", widthMm: role === "odu" ? 1050 : 1100, depthMm: 330 },
  });

  it("lie in the ceiling when ducted, stand on the ground outside, sized from the model", () => {
    const s = sceneOf(design([floor("gf", 0)], { gf: [read("s-gf", [space("Lounge", "room", [0, 0, 400, 300])])] }, [unit("i", "idu", "sys"), unit("o", "odu", "sys", "external-ground")]));
    expect(s.units.map((u) => [u.id, u.label, u.y, u.h, u.w, u.at])).toEqual([
      ["i", "PEAD-M100", 2.72, 0.25, 1.1, [2, 1]],
      ["o", "PUZ-M100", 0, 1.35, 1.05, [2, 1]],
    ]);
  });

  it("carry a run through the ceiling cavity over its floor", () => {
    const run: DesignObject = { id: "p", type: "pipe-run", systemId: "sys", floorId: "gf", plane: "ceiling-cavity", geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, props: {} };
    const s = sceneOf(design([floor("gf", 0)], { gf: [read("s-gf", [space("Lounge", "room", [0, 0, 400, 300])])] }, [run]));
    expect(s.pipes[0].pts).toEqual([
      [0, 2.8, 0],
      [1, 2.8, 0],
    ]);
  });
});
