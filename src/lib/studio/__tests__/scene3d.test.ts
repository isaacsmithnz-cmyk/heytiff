import { createDesign, type DesignDocument, type DesignObject, type Floor } from "../document";
import type { ReadSpace, SheetReading } from "../reading";
import { lineUp, sceneOf, solidsOf } from "../scene3d";

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

  it("as drawn with no stair to go by: its middle over the ground's would be a guess", () => {
    expect(lineUp(g([space("A", "room", [0, 0, 1000, 800])]), g([space("B", "room", [3000, 2000, 3400, 2400])]))).toEqual([0, 0]);
  });

  /* the first floor narrower than the ground, its stair a metre off the one below (as 90 Dreamer St's) */
  const dreamer = (planImport: DesignDocument["planImport"], l1 = 10) => ({
    ...design([floor("gf", 0), floor("l1", 1, { scaleMmPerUnit: l1 })], {
      gf: [read("s-gf", [space("Long", "room", [0, 0, 2000, 500]), space("Stair", "stair", [1000, 0, 1200, 400])])],
      l1: [read("s-l1", [space("Short", "room", [0, 0, 1500, 500]), space("Stair", "stair", [900, 0, 1100, 400])])],
    }),
    planImport,
  });
  const one = { sources: [{ ref: "r/set.pdf", kind: "pdf" as const }], placed: { 2: "r/s-gf.png", 3: "r/s-l1.png" }, chosen: [2, 3], names: {} };
  it("as drawn when they are pages of one PDF at one size and scale: the sheets share an origin, and a stair read off doesn't move a floor", () => {
    expect(sceneOf(dreamer(one)).floors.map((f) => [f.id, f.shift])).toEqual([
      ["gf", [0, 0]],
      ["l1", [0, 0]],
    ]);
  });
  it("lined up stair over stair when one PDF's pages are at different scales: a point on paper lands elsewhere in the world", () => {
    const [, l1] = sceneOf(dreamer(one, 10.1)).floors;
    /* the stairs' middles 11 m and 10.1 m along, 2 m and 2.02 m down */
    expect(l1.shift![0]).toBeCloseTo(0.9, 5);
    expect(l1.shift![1]).toBeCloseTo(-0.02, 5);
  });
  it("lined up stair over stair when each floor is a file of its own", () => {
    expect(sceneOf(dreamer(null)).floors.map((f) => [f.id, f.shift])).toEqual([
      ["gf", [0, 0]],
      ["l1", [1, 0]],
    ]);
  });

  it("stays as drawn when a stair is read a little off two floors drawn in register", () => {
    const ground = g([space("A", "room", [0, 0, 1000, 800]), space("Stair", "stair", [800, 0, 1000, 300])]);
    const upper = g([space("B", "room", [0, 0, 1000, 800]), space("Stair", "stair", [820, 0, 1000, 300])]);
    expect(lineUp(ground, upper)).toEqual([0, 0]);
  });

  /* 90 Dreamer St (9 November 2026): the first floor, narrower than the ground,
     stood over it as drawn and with its stair over the stair below; as drawn
     won, and its flight came up a metre beside its well */
  it("stair over stair when they're out of register and the floor stands as well either way", () => {
    const ground = g([space("Long", "room", [0, 0, 2000, 500]), space("Stair", "stair", [1000, 0, 1200, 400])]);
    const upper = g([space("Short", "room", [0, 0, 1500, 500]), space("Stair", "stair", [900, 0, 1100, 400])]);
    expect(lineUp(ground, upper)).toEqual([1, 0]);
  });

  /* 6 Nostrud Ave (28 October 2026: "the ground floor and first floor were
     misaligned"): Tiff's reading of its two plans, each its own sheet at its
     own scale, the first floor drawn 4.4 m nearer the top of its page. The
     two still overlapped by more than half, so it stood where it was drawn.
     Its stairs, its old stair kept and an outdoor one among them, put it
     over the ground. */
  type Row = [string, ReadSpace["kind"], number, number, number, number, boolean?];
  const nostrudGround: Row[] = [
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
  ];
  const nostrudFirst: Row[] = [
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
  ];
  it("stair over stair even where the plans overlap (6 Nostrud Ave)", () => {
    const at = (k: number, rows: Row[]) => ({
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
    const [dx, dz] = lineUp(at(35.14388760928441, nostrudGround), at(34.803996484313124, nostrudFirst));
    /* the new stair over the new stair */
    expect(dx).toBeCloseTo(0.18, 2);
    expect(dz).toBeCloseTo(4.43, 2);
  });
  it("stair over stair on two pages of one PDF at one size and scale, where the stair stands the floor clearly better (6 Nostrud Ave's, drawn out of register)", () => {
    const k = 35.14388760928441;
    const sheetOf = (rows: Row[], id: string) => read(id, rows.map(([name, kind, x0, x1, y0, y1, existing = false]) => space(name, kind, [x0, y0, x1, y1], existing)));
    const d = design([floor("gf", 0, { scaleMmPerUnit: k }), floor("l1", 1, { scaleMmPerUnit: k })], { gf: [sheetOf(nostrudGround, "s-gf")], l1: [sheetOf(nostrudFirst, "s-l1")] });
    const [, l1] = sceneOf({ ...d, planImport: one }).floors;
    /* the new stair's middle over the new stair's: 7.5 px west and 120.5 px down the page */
    expect(l1.shift![0]).toBeCloseTo((-7.5 * k) / 1000, 5);
    expect(l1.shift![1]).toBeCloseTo((120.5 * k) / 1000, 5);
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

  it("stand on the ground beside a house with a floor below it, which is dug in (job 3570)", () => {
    const lower = { ...unit("o", "odu", "sys", "external-ground"), floorId: "lg" };
    const s = sceneOf(
      design(
        [floor("lg", -1), floor("gf", 0)],
        { lg: [read("s-lg", [space("Cellar", "room", [0, 0, 400, 300])])], gf: [read("s-gf", [space("Lounge", "room", [0, 0, 400, 300])])] },
        [lower],
      ),
    );
    expect(s.floors.map((f) => [f.id, f.y0 < 0])).toEqual([
      ["lg", true],
      ["gf", false],
    ]);
    expect(s.floors.find((f) => f.id === "gf")!.y0).toBe(0);
    expect(s.units[0].y).toBe(0);
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

  it("carries a raked room's walls up to meet its ceiling, and no other room's", () => {
    const s = sceneOf(withRoof([{ floorId: "gf", room: "Lounge", lowMm: 2400, highMm: 3200 }]));
    const flatY = s.floors[0].y0 + s.floors[0].ceiling;
    expect(s.ceilings[0].tops).toHaveLength(1);
    const ys = s.ceilings[0].tops[0].verts.map(([, y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(flatY);
    expect(Math.max(...ys)).toBeGreaterThan(flatY + 0.5);
    expect(Math.max(...ys)).toBeLessThanOrEqual(3.2);
  });

  it("says when the roof hasn't been read", () => {
    expect(roofSummary(design([floor("gf", 0)], null))).toMatchObject({ read: false });
  });
});

/* A roof read off the roof plan's own lines (lib/studio/vector/roof.ts) */
describe("the roof's own faces", () => {
  it("rise at their pitch from a rafter's seat over the top of the wall, their overhang's fall lower at the eave line", () => {
    const d = design([floor("gf", 0)], { gf: [read("s-gf", [space("Lounge", "room", [0, 0, 400, 300])])] });
    const face = { floorId: "gf", sheetId: "s-gf", outline: [{ x: 0, y: -60 }, { x: 400, y: -60 }, { x: 400, y: 300 }, { x: 0, y: 300 }], pitchDeg: 45, fall: { x: 0, y: 1 }, eaveMm: 2700, overhangMm: 600, existing: false, page: 4 };
    const s = sceneOf({ ...d, reading: { ...d.reading!, roof: { levels: [], parts: [], raked: [], material: "", roofSpace: "", faces: [face] } } });
    expect(s.roofs).toHaveLength(1);
    const ys = s.roofs[0].faces.verts.map(([, y]) => y);
    /* the eave line 600 mm out past the wall, at 45°: 600 mm under the wall's top of 2.7 m and a 140 mm rafter's seat (0.218 m at 45°); 3.6 m up the fall to its top */
    const seat = 0.14 / Math.cos(Math.PI / 4) + 0.02;
    expect(Math.min(...ys)).toBeCloseTo(2.1 + seat, 3);
    expect(Math.max(...ys)).toBeCloseTo(5.7 + seat, 3);
  });

  it("of one roof sit on one seat, at the pitch most of them have, so faces of two pitches meet without a step", () => {
    const d = design([floor("gf", 0)], { gf: [read("s-gf", [space("Lounge", "room", [0, 0, 400, 300])])] });
    const at = (pitchDeg: number, x0: number) => ({ floorId: "gf", sheetId: "s-gf", outline: [{ x: x0, y: 0 }, { x: x0 + 100, y: 0 }, { x: x0 + 100, y: 100 }, { x: x0, y: 100 }], pitchDeg, fall: { x: 0, y: 1 }, eaveMm: 2700, overhangMm: 0, existing: false, page: 4 });
    const s = sceneOf({ ...d, reading: { ...d.reading!, roof: { levels: [], parts: [], raked: [], material: "", roofSpace: "", faces: [at(40, 0), at(40, 100), at(20, 200)] } } });
    const eaves = s.roofs.map((r) => Math.min(...r.faces.verts.map(([, y]) => y)));
    expect(eaves[2]).toBeCloseTo(eaves[0], 6);
  });
});

/* The site round the house (Isaac, 8 November 2026: "Paths, walkways, streets and driveways too ... neighbours property as a ghost") */
describe("the site round the house", () => {
  const base = design([floor("gf", 0)], { gf: [read("s-gf", [space("Lounge", "room", [0, 0, 400, 300])])] });
  const sq = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];

  it("is in metres on the ground floor, as the house is", () => {
    const s = sceneOf({
      ...base,
      reading: {
        ...base.reading!,
        site: {
          floorId: "gf",
          sheetId: "s-gf",
          boundary: sq(-100, -100, 600, 900),
          surfaces: [{ kind: "driveway", outline: sq(420, 0, 520, 800), finish: "exposed aggregate" }],
          street: { name: "Rumour St", kerb: [{ x: -100, y: 1000 }, { x: 600, y: 1000 }], widthMm: 8000 },
          neighbours: [{ outline: sq(-600, 0, -150, 300), storeys: 2, attached: false, note: "No. 21" }],
          fences: [{ line: [{ x: -100, y: -100 }, { x: 600, y: -100 }], heightMm: 1800 }],
        },
      },
    });
    expect(s.site?.surfaces[0]).toMatchObject({ kind: "driveway", pts: [[4.2, 0], [5.2, 0], [5.2, 8], [4.2, 8]] });
    expect(s.site?.street).toEqual({ name: "Rumour St", kerb: [[-1, 10], [6, 10]], width: 8 });
    expect(s.site?.neighbours[0].storeys).toBe(2);
    expect(s.site?.fences[0].height).toBe(1.8);
  });

  /* the read gives 0 for a figure the set doesn't (reading-server toSite): a road and a neighbour of no size aren't drawn as if they had one */
  it("has no road width or storeys where the set doesn't give them", () => {
    const s = sceneOf({
      ...base,
      reading: {
        ...base.reading!,
        site: {
          floorId: "gf",
          sheetId: "s-gf",
          boundary: [],
          surfaces: [],
          street: { name: "Rumour St", kerb: [{ x: -100, y: 1000 }, { x: 600, y: 1000 }], widthMm: 0 },
          neighbours: [{ outline: sq(-600, 0, -150, 300), storeys: 0, attached: false, note: "" }],
          fences: [],
        },
      },
    });
    expect(s.site?.street).toEqual({ name: "Rumour St", kerb: [[-1, 10], [6, 10]], width: null });
    expect(s.site?.neighbours[0].storeys).toBeNull();
  });

  it("is nothing until she has read it", () => {
    expect(sceneOf(base).site).toBeNull();
  });
});

describe("a subfloor (floor-spaces.ts)", () => {
  const unit = (id: string, odu: boolean, plane: DesignObject["plane"]): DesignObject =>
    ({ id, type: "unit", floorId: "gf", systemId: "sys", plane, geometry: { kind: "point", at: { x: 100, y: 100 } }, props: odu ? { role: "odu", widthMm: 1050 } : { model: "PEA" } }) as DesignObject;
  const house = (under?: Floor["under"], objects: DesignObject[] = []) =>
    sceneOf(
      design([floor("gf", 0, under ? { under } : {}), floor("l1", 1)], { gf: [read("s-gf", [space("Lounge", "room", [0, 0, 400, 300])])], l1: [read("s-l1", [space("Bed", "room", [0, 0, 400, 300])])] }, objects),
      () => ({ form_factor: "ducted", height_mm: 380 })
    );

  it("stands the house on it: a storey of its own under the lowest floor, the floors up by its height", () => {
    const s = house({ heightMm: 1400, outline: null, from: "hand" });
    expect(s.floors.map((f) => f.name)).toEqual(["Subfloor", "gf", "l1"]);
    expect(s.floors[0].y0).toBe(0);
    expect(s.floors[0].ceiling).toBe(1.4);
    expect(s.floors[1].y0).toBe(1.4);
    /* the ground floor's outline, 4 m by 3 m */
    const xs = s.floors[0].spaces[0].pts.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 0);
  });

  it("is not drawn until its height is known", () => {
    const s = house({ heightMm: null, outline: null, from: "hand" });
    expect(s.floors.map((f) => f.name)).toEqual(["gf", "l1"]);
    expect(s.floors[0].y0).toBe(0);
  });

  it("takes an outdoor unit put there and a head hung under the floor; one outside stands on the ground beside it", () => {
    const s = house({ heightMm: 1400, outline: null, from: "hand" }, [unit("odu-in", true, "floor-cavity"), unit("odu-out", true, "external-ground"), unit("head", false, "floor-cavity")]);
    const by = new Map(s.units.map((u) => [u.id, u]));
    expect(by.get("odu-in")!.floorId).toBe("gf:under");
    expect(by.get("odu-in")!.y).toBe(0);
    expect(by.get("odu-out")!.floorId).toBe("gf");
    expect(by.get("odu-out")!.y).toBe(0);
    expect(by.get("head")!.floorId).toBe("gf:under");
    /* hung under the ground floor, inside the subfloor */
    expect(by.get("head")!.y).toBeGreaterThan(0.9);
    expect(by.get("head")!.y).toBeLessThan(1.4);
  });
});

describe("a roof space (floor-spaces.ts)", () => {
  const unit = (id: string, plane: DesignObject["plane"], model = "PEA", floorId = "l1"): DesignObject =>
    ({ id, type: "unit", floorId, systemId: "sys", plane, geometry: { kind: "point", at: { x: 100, y: 100 } }, props: { model } }) as DesignObject;
  const house = (over?: Floor["over"], objects: DesignObject[] = [], form = "ducted") =>
    sceneOf(
      design([floor("gf", 0), floor("l1", 1, over ? { over } : {})], { gf: [read("s-gf", [space("Lounge", "room", [0, 0, 400, 300])])], l1: [read("s-l1", [space("Bed", "room", [0, 0, 400, 300])])] }, objects),
      (model: string) => ({ form_factor: model.startsWith("MSZ") ? "wall" : form, height_mm: 250 })
    );

  it("sits on the top floor's ceiling as a storey of its own, as high as typed, round the top floor's outline", () => {
    const s = house({ heightMm: 1800, outline: null, from: "hand" });
    expect(s.floors.map((f) => f.name)).toEqual(["gf", "l1", "Roof space"]);
    const [, l1, rs] = s.floors;
    expect(rs.id).toBe("l1:over");
    expect(rs.y0).toBeCloseTo(l1.y0 + l1.ceiling, 3);
    expect(rs.ceiling).toBe(1.8);
    const xs = rs.spaces[0].pts.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 0);
  });

  it("is not drawn until its height is known", () => {
    expect(house({ heightMm: null, outline: null, from: "hand" }).floors.map((f) => f.name)).toEqual(["gf", "l1"]);
  });

  it("holds a head set in the top floor's ceiling, not a wall split in the room or a head on a floor below", () => {
    const s = house({ heightMm: 1800, outline: null, from: "hand" }, [unit("in-ceiling", "ceiling-cavity"), unit("in-room", "room", "MSZ-AP50"), unit("below", "ceiling-cavity", "PEA", "gf")]);
    const by = new Map(s.units.map((u) => [u.id, u]));
    expect(by.get("in-ceiling")!.floorId).toBe("l1:over");
    expect(by.get("in-room")!.floorId).toBe("l1");
    expect(by.get("below")!.floorId).toBe("gf");
  });
});



describe("the walls the drawing file draws", () => {
  const ring = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  it("stand on the floor in metres with their gaps, and a door in its gap isn't moved onto a room's side", () => {
    const sh = {
      ...read("s-gf", [space("Lounge", "room", [10, 10, 390, 290])], [{ kind: "door", tag: "", a: { x: 100, y: 5 }, b: { x: 190, y: 5 }, widthMm: 900, room: "Lounge", external: true, facing: "N", inGap: true }]),
      walled: { grid: { x: [], y: [] }, rounds: 0, look: [], walls: [[ring(0, 0, 100, 10)], [ring(190, 0, 400, 10)]], gaps: [{ a: { x: 100, y: 5 }, b: { x: 190, y: 5 }, t: 10 }] },
    };
    const f = sceneOf(design([floor("gf", 0)], { gf: [sh] })).floors[0];
    /* 10 mm a plan unit: 100 units is a metre */
    expect(f.walls).toEqual([
      { outer: [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], holes: [] },
      { outer: [[1.9, 0], [4, 0], [4, 0.1], [1.9, 0.1]], holes: [] },
    ]);
    expect(f.gaps).toEqual([{ a: [1, 0.05], b: [1.9, 0.05], t: 0.1 }]);
    expect(f.openings[0]).toMatchObject({ a: [1, 0.05], b: [1.9, 0.05], inGap: true });
  });
  it("a floor with none has none, and its rooms' walls are drawn round them as before", () => {
    const f = sceneOf(design([floor("gf", 0)], { gf: [read("s-gf", [space("Lounge", "room", [0, 0, 400, 300])])] })).floors[0];
    expect(f.walls).toBeUndefined();
  });
  it("an outline inside another is a hole in it; one beside it is a wall of its own", () => {
    const sq = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const out = solidsOf([sq(0, 0, 10, 10), sq(2, 2, 8, 8), sq(20, 0, 30, 1)]);
    expect(out).toEqual([
      { outer: sq(0, 0, 10, 10), holes: [sq(2, 2, 8, 8)] },
      { outer: sq(20, 0, 30, 1), holes: [] },
    ]);
  });
});
