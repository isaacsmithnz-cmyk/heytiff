import { createDesign, type DesignDocument, type DesignObject } from "../document";
import type { ReadOpening, SheetReading } from "../reading";
import { canJoin, foundOn, insertCorner, joinRooms, keepFound, readyFromPlans, removeCorner, shapeAfterEdit, wallsAfterInsert, wallsAfterRemove, wallsWithOpenings } from "../room-edit";
import { glassM2, suggestionsFor } from "../rooms-from-reading";

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const opening = (kind: ReadOpening["kind"], room: string, a: [number, number], b: [number, number], widthMm: number, facing = "N", external = true): ReadOpening => ({
  kind,
  tag: "",
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  widthMm,
  room,
  external,
  facing,
});
const space = (name: string, kind: SheetReading["spaces"][number]["kind"], outline: { x: number; y: number }[]) => ({
  name,
  named: true,
  kind,
  outline,
  written: "",
  existing: false,
  openTo: "",
  stair: "",
});

/* 10 mm a unit: a 4 m by 3 m bedroom with a window on its top wall and a
   2.4 m slider on its left; a living room beside it, and a garage with a
   roller door */
const sheet: SheetReading = {
  sheetId: "s1",
  planUp: "N",
  spaces: [
    space("Bedroom", "room", rect(0, 0, 400, 300)),
    space("Living", "room", rect(410, 0, 500, 300)),
    space("Garage", "garage", rect(0, 400, 600, 600)),
  ],
  openings: [
    opening("window", "Bedroom", [100, -10], [220, -10], 1200, "N"),
    opening("door", "Bedroom", [-10, 50], [-10, 290], 2400, "W"),
    opening("door", "Bedroom", [400, 100], [400, 180], 820, "", false),
    opening("door", "Garage", [100, 1000], [550, 1000], 4800, "S"),
  ],
  marks: [],
  furniture: [],
  checklist: [],
  flags: [],
};

function design(): DesignDocument {
  const d = createDesign({ name: "t", mode: "plan" });
  return {
    ...d,
    floors: [
      {
        id: "gf",
        name: "Ground",
        level: 0,
        scaleMmPerUnit: 10,
        northDeg: 0,
        northPos: null,
        plans: [{ id: "s1", imageRef: "r", pageNumber: 1, name: "p", width: 1000, height: 1100, x: 100, y: 50 }],
      },
    ],
    reading: { at: "", model: "", floors: { gf: [sheet] }, failed: [] },
  };
}

describe("corners", () => {
  const sq = rect(0, 0, 100, 100);
  test("a new corner goes on the wall it was pulled from", () => {
    expect(insertCorner(sq, 1, { x: 120, y: 50 })).toEqual([sq[0], sq[1], { x: 120, y: 50 }, sq[2], sq[3]]);
    expect(insertCorner(sq, 3, { x: -5, y: 50 })).toEqual([...sq, { x: -5, y: 50 }]);
  });
  test("a corner comes off, but never below three", () => {
    expect(removeCorner(sq, 0)).toEqual([sq[1], sq[2], sq[3]]);
    expect(removeCorner(sq.slice(0, 3), 0)).toBeNull();
  });
  test("the outside walls follow a new corner: the split wall is two, the rest move up", () => {
    expect(wallsAfterInsert([0, 1, 3], 1)).toEqual([0, 1, 2, 4]);
    expect(wallsAfterInsert([2], 3)).toEqual([2]);
  });
  test("the outside walls follow a corner coming off: the walls either side are one", () => {
    /* corner 2 of 5 off: walls 1 and 2 are one (1); wall 4 is now 3 */
    expect(wallsAfterRemove([2, 4], 2, 5)).toEqual([1, 3]);
    /* corner 0 of 5 off: walls 4 and 0 are one, now the last (3); wall 2 is now 1 */
    expect(wallsAfterRemove([0, 2], 0, 5)).toEqual([1, 3]);
    expect(wallsAfterRemove([], 1, 4)).toEqual([]);
  });
  test("an edited outline is a rectangle only while it still is one", () => {
    expect(shapeAfterEdit(sq)).toBe("rect");
    expect(shapeAfterEdit(insertCorner(sq, 1, { x: 120, y: 50 }))).toBe("poly");
  });
});

describe("Tiff's rooms, kept from the plan", () => {
  test("a wide outside door is glass; a garage's roller door is not", () => {
    const s = suggestionsFor(design().floors[0], [sheet]);
    const bed = s.find((x) => x.name === "Bedroom")!;
    expect(bed.windows.map((w) => w.kind)).toEqual(["window", "door"]);
    expect(glassM2(bed)).toBeCloseTo((1.2 + 2.4) * 1.2);
    expect(s.find((x) => x.name === "Garage")!.windows).toEqual([]);
  });

  test("keys stay the same from one ask to the next", () => {
    const a = suggestionsFor(design().floors[0], [sheet]).map((x) => x.key);
    expect(suggestionsFor(design().floors[0], [sheet]).map((x) => x.key)).toEqual(a);
    expect(a).toEqual(["s1:0", "s1:1", "s1:2"]);
  });

  test("a kept room marks the walls its outside openings sit on, and leaves the found list", () => {
    const d = keepFound(design(), "gf", ["s1:0"]);
    const room = d.objects.find((o) => o.type === "room")!;
    expect(room.props.name).toBe("Bedroom");
    expect(room.props.readKey).toBe("s1:0");
    /* the top wall (0) for the window, the left wall (3) for the slider; the
       inside door to the living room marks nothing */
    expect(room.props.externalWalls).toEqual([0, 3]);
    expect(room.props.hasExternalWalls).toBe(true);
    expect(foundOn(d, "gf").map((s) => s.name)).toEqual(["Living", "Garage"]);
  });

  test("a kept room takes its height off the sections, a raked one its middle", () => {
    const d = design();
    const read = {
      ...d,
      reading: {
        ...d.reading!,
        roof: {
          levels: [{ floorId: "gf", ceilingMm: 2780, floorZoneMm: 300, source: "section CC: GROUND FFL +60,240 to CL +63,020 = 2,780" }],
          parts: [],
          raked: [{ floorId: "gf", room: "Living", lowMm: 2700, highMm: 4100 }],
          material: "",
          roofSpace: "",
        },
      },
    };
    const kept = keepFound(read, "gf", ["s1:0", "s1:1"]).objects.filter((o) => o.type === "room");
    expect(kept.map((o) => [o.props.name, o.props.ceilingHeightM, o.props.heightFrom])).toEqual([
      ["Bedroom", 2.78, "section CC"],
      ["Living", 3.4, "raked, 2.7 to 4.1 m"],
    ]);
  });

  test("a room kept before keys counts as kept by its name", () => {
    const d = design();
    const old: DesignObject = {
      id: "r_old",
      type: "room",
      systemId: null,
      floorId: "gf",
      geometry: { kind: "polygon", points: rect(100, 50, 400, 300) },
      plane: "room",
      props: { name: "Bedroom", fromReading: true },
    };
    expect(foundOn({ ...d, objects: [old] }, "gf").map((s) => s.name)).toEqual(["Living", "Garage"]);
  });

  test("nothing is kept on a floor with no scale", () => {
    const d = design();
    const unscaled = { ...d, floors: [{ ...d.floors[0], scaleMmPerUnit: null }] };
    expect(keepFound(unscaled, "gf", ["s1:0"])).toBe(unscaled);
  });
});

describe("a design as it opens from a job's plans", () => {
  test("the rooms inside the house are marked, the garage left found", () => {
    const d = readyFromPlans(design());
    expect(d.objects.filter((o) => o.type === "room").map((o) => o.props.name)).toEqual(["Bedroom", "Living"]);
    expect(foundOn(d, "gf").map((s) => s.name)).toEqual(["Garage"]);
  });

  test("wet rooms and halls are marked too, not only the rooms a unit usually serves", () => {
    const d = design();
    const more: SheetReading = { ...sheet, spaces: [...sheet.spaces, space("Bath", "wet", rect(0, 320, 200, 60)), space("Hall", "circulation", rect(210, 320, 300, 60))] };
    const out = readyFromPlans({ ...d, reading: { ...d.reading!, floors: { gf: [more] } } });
    expect(out.objects.filter((o) => o.type === "room").map((o) => o.props.name)).toEqual(["Bedroom", "Living", "Bath", "Hall"]);
  });

  test("a floor with no scale takes the one Tiff measured off its page, then its rooms", () => {
    const d = design();
    const unscaled: DesignDocument = {
      ...d,
      floors: [{ ...d.floors[0], scaleMmPerUnit: null }],
      planImport: { sources: [], placed: { 0: "r" }, chosen: [0], names: {}, measured: { 0: { from: "the 4000 mm printed on it", sure: true, mmPerPx: 10 } } },
    };
    const out = readyFromPlans(unscaled);
    expect(out.floors[0].scaleMmPerUnit).toBe(10);
    expect(out.objects.filter((o) => o.type === "room")).toHaveLength(2);
  });

  test("a scale already on the floor is left as it is", () => {
    const d = design();
    const out = readyFromPlans({
      ...d,
      planImport: { sources: [], placed: { 0: "r" }, chosen: [0], names: {}, measured: { 0: { from: "x", sure: true, mmPerPx: 25 } } },
    });
    expect(out.floors[0].scaleMmPerUnit).toBe(10);
  });

  test("with no scale to be had, the rooms stay found and the design is untouched", () => {
    const d = design();
    const unscaled = { ...d, floors: [{ ...d.floors[0], scaleMmPerUnit: null }] };
    expect(readyFromPlans(unscaled)).toBe(unscaled);
  });

  test("opening twice marks nothing twice", () => {
    const once = readyFromPlans(design());
    expect(readyFromPlans(once)).toBe(once);
  });
});

describe("join", () => {
  test("two rooms become one under the first one's name, across the wall between", () => {
    let d = keepFound(design(), "gf", ["s1:0", "s1:1"]);
    const [bed, living] = d.objects.filter((o) => o.type === "room");
    const unit: DesignObject = {
      id: "u1",
      type: "unit",
      systemId: null,
      floorId: "gf",
      geometry: { kind: "point", at: { x: 700, y: 200 } },
      plane: "room",
      props: { roomId: living.id },
    };
    d = { ...d, objects: [...d.objects, unit] };
    const j = joinRooms(d, null, [bed.id, living.id]);
    const rooms = j.objects.filter((o) => o.type === "room");
    expect(rooms).toHaveLength(1);
    expect(rooms[0].id).toBe(bed.id);
    expect(rooms[0].props.name).toBe("Bedroom");
    /* the 10-unit wall between them is closed: one rectangle, 910 by 300 */
    const pts = rooms[0].geometry.kind === "polygon" ? rooms[0].geometry.points : [];
    expect(pts).toHaveLength(4);
    expect(rooms[0].props.shape).toBe("rect");
    expect(j.objects.find((o) => o.id === "u1")!.props.roomId).toBe(bed.id);
    /* the room it took in isn't offered again */
    expect(foundOn(j, "gf").map((s) => s.name)).toEqual(["Garage"]);
  });

  test("rooms that don't meet don't join: the hall between stays a hall", () => {
    const d = keepFound(design(), "gf", ["s1:0", "s1:2"]);
    const [bed, garage] = d.objects.filter((o) => o.type === "room");
    /* the garage is 1 m below the bedroom, three walls' width */
    expect(canJoin(d, [bed.id, garage.id])).toBe(false);
    expect(joinRooms(d, null, [bed.id, garage.id])).toBe(d);
  });

  test("one room on its own is not a join", () => {
    const d = keepFound(design(), "gf", ["s1:0"]);
    const bed = d.objects.find((o) => o.type === "room")!;
    expect(joinRooms(d, null, [bed.id])).toBe(d);
  });
});

describe("walls with openings", () => {
  test("an opening further off than the reach marks nothing", () => {
    expect(wallsWithOpenings(rect(0, 0, 100, 100), [{ a: { x: 50, y: -50 }, b: { x: 50, y: -50 }, external: true }], 10)).toEqual([]);
  });
});
