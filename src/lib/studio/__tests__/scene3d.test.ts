import { createDesign, type DesignDocument, type DesignObject, type Floor } from "../document";
import type { ReadSpace, SheetReading } from "../reading";
import { lineUp, sceneOf } from "../scene3d";

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

  it("stays as drawn when a stair is read a little off two floors drawn in register", () => {
    const ground = g([space("A", "room", [0, 0, 1000, 800]), space("Stair", "stair", [800, 0, 1000, 300])]);
    const upper = g([space("B", "room", [0, 0, 1000, 800]), space("Stair", "stair", [820, 0, 1000, 300])]);
    expect(lineUp(ground, upper)).toEqual([0, 0]);
  });

  /* 6 Bishops Ave (28 October 2026: "the ground floor and first floor were
     misaligned"): Tiff's reading of its two plans, each its own sheet at its
     own scale, the first floor drawn 4.4 m nearer the top of its page. The
     two still overlapped by more than half, so it stood where it was drawn.
     Its stairs, its old stair kept and an outdoor one among them, put it
     over the ground. */
  it("stair over stair even where the plans overlap (6 Bishops Ave)", () => {
    const at = (k: number, rows: [string, ReadSpace["kind"], number, number, number, number, boolean?][]) => ({
      floor: floor("x", 0),
      openings: [],
      read: true,
      spaces: rows.map(([name, kind, x0, x1, y0, y1, existing = false]) => ({
        name,
        kind,
        existing,
        pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [(x * k) / 1000, (y * k) / 1000] as [number, number]),
      })),
    });
    const ground = at(35.14388760928441, [
      ["Ex. Entry", "circulation", 1365, 1495, 822, 890, true],
      ["Hall", "circulation", 1365, 1425, 677, 819, true],
      ["Bags", "cupboard", 1322, 1365, 712, 734],
      ["Pantry", "cupboard", 1167, 1205, 604, 667],
      ["Under Stairs Storage", "cupboard", 1290, 1370, 604, 647],
      ["Ex. Garage", "garage", 560, 718, 755, 910, true],
      ["Ex. Verandah", "outdoor", 1498, 1612, 604, 890, true],
      ["Outdoor Entertaining", "outdoor", 560, 718, 575, 752],
      ["Ex. Guest Bed", "room", 1428, 1555, 719, 819, true],
      ["Ex. Kids Play", "room", 1428, 1555, 604, 712, true],
      ["Kitchen / Living / Dining", "room", 1018, 1365, 604, 890],
      ["Outdoor stair over pool equip", "stair", 585, 636, 685, 727],
      ["Stairs", "stair", 1270, 1320, 652, 737],
      ["Ex. Bath", "wet", 1375, 1422, 604, 675, true],
      ["Laundry", "wet", 1208, 1265, 604, 667],
      ["P'WD RM", "wet", 1167, 1255, 672, 737],
    ]);
    const first = at(34.803996484313124, [
      ["Hall", "circulation", 1175, 1460, 486, 656],
      ["Ex. WIR", "cupboard", 1368, 1440, 554, 609, true],
      ["Storage", "cupboard", 563, 580, 619, 734, true],
      ["WIR", "cupboard", 1060, 1170, 557, 624],
      ["Front Verandah", "outdoor", 1495, 1612, 489, 775, true],
      ["Ex. Bed 2", "room", 1440, 1552, 489, 607, true],
      ["Ex. Bed 3", "room", 1348, 1495, 664, 775, true],
      ["Ex. Bed 4", "room", 1175, 1265, 486, 624, true],
      ["Ex. Bedroom", "room", 580, 700, 619, 734, true],
      ["Ex. Gym", "room", 1462, 1552, 612, 707, true],
      ["Ex. Living", "room", 580, 700, 514, 594, true],
      ["Kitchenette", "room", 565, 720, 489, 514, true],
      ["Master Bed", "room", 1060, 1172, 629, 775],
      ["Study", "room", 1175, 1270, 659, 775],
      ["Ex. Stairs Retained", "stair", 565, 665, 594, 619, true],
      ["Stair", "stair", 1280, 1325, 524, 624],
      ["Bath", "wet", 1273, 1345, 659, 775],
      ["Ens/Ldry", "wet", 563, 712, 734, 784],
      ["Ex. Ensuite", "wet", 1368, 1430, 489, 552, true],
      ["Master Ensuite", "wet", 1060, 1170, 486, 557],
    ]);
    const [dx, dz] = lineUp(ground, first);
    /* the new stair over the new stair */
    expect(dx).toBeCloseTo(0.18, 2);
    expect(dz).toBeCloseTo(4.43, 2);
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

/* Tiff's roof-void check (Isaac, 20 October 2026: "can I fit a ducted unit in the roof void?") */
describe("the roof void over each room", () => {
  const { roofSummary } = jest.requireActual("../scene3d") as typeof import("../scene3d");
  const withRoof = (raked: { floorId: string; room: string; lowMm: number; highMm: number }[] = []) => {
    const d = design([floor("gf", 0)], { gf: [read("s-gf", [space("Lounge", "room", [0, 0, 1000, 600]), space("Bed", "room", [0, 600, 1000, 800])])] });
    return {
      ...d,
      reading: {
        ...d.reading!,
        roof: {
          levels: [{ floorId: "gf", ceilingMm: 2400, floorZoneMm: 0, source: "section" }],
          parts: [{ floorId: "gf", sheetId: "s-gf", form: "gable" as const, outline: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }], ridge: "across" as const, fallsTo: "" as const, pitchDeg: 22.5, eaveMm: 2400, overhangMm: 450, existing: false, source: "" }],
          raked,
          material: "tile",
          roofSpace: "",
        },
      },
    };
  };

  it("says how high it is clear between the joists and the rafters, lowest and highest", () => {
    const r = roofSummary(withRoof());
    if (!r.read) throw new Error("not read");
    const lounge = r.void_over_rooms.find((v) => v.room === "Lounge")!;
    // 8 m span, ridge 4 m in; sampled on a 9 by 9 grid, the highest point read is 3.75 m in:
    // 3.75 tan 22.5 = 1.553 m, plus the roof's 172 mm seat on its rafters, less 140 of rafter and 120 of joist
    expect(lounge.clear_mm_highest).toBe(1465);
    expect(lounge.clear_mm_lowest).toBe(0);
    expect(r.levels[0]).toMatchObject({ ceiling_mm: 2400 });
    expect(r.framing).toMatch(/standard spacings/);
  });

  it("gives a raked room no void", () => {
    const r = roofSummary(withRoof([{ floorId: "gf", room: "Lounge", lowMm: 2400, highMm: 3200 }]));
    if (!r.read) throw new Error("not read");
    expect(r.void_over_rooms.find((v) => v.room === "Lounge")).toMatchObject({ ceiling: "raked: no roof void over it", clear_mm_highest: 0 });
  });

  it("says when the roof hasn't been read", () => {
    expect(roofSummary(design([floor("gf", 0)], null))).toMatchObject({ read: false });
  });
});
