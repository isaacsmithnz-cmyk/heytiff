import { dressOf, frameOf, furnish, within, type Piece3D } from "../furnish3d";
import { flightsOf, type Floor3D, type Opening3D, type Space3D, type XZ } from "../scene3d";

const rect = (x0: number, z0: number, x1: number, z1: number): XZ[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
const room = (name: string, pts: XZ[], kind: Space3D["kind"] = "room"): Space3D => ({ name, kind, pts, existing: false });
const door = (a: XZ, b: XZ): Opening3D => ({ kind: "door", a, b, external: false, sill: 0, head: 2.1 });
const none = { furniture: [], joinery: [] };
const corners = (p: Piece3D): XZ[] => {
  const s: XZ = [-p.facing[1], p.facing[0]];
  return [1, -1].flatMap((i) => [1, -1].map((j): XZ => [p.at[0] + (s[0] * i * p.w) / 2 + (p.facing[0] * j * p.d) / 2, p.at[1] + (s[1] * i * p.w) / 2 + (p.facing[1] * j * p.d) / 2]));
};

describe("a room furnished by its name", () => {
  const bedroom = room("Bed 2", rect(0, 0, 4, 3.6));
  /* its door in the wall along z = 0 */
  const pieces = furnish([bedroom], [door([0.3, 0], [1.1, 0])], none);
  const bed = pieces.find((p) => p.kind === "bed")!;

  it("gets a queen bed, wholly in the room, its head on a wall without the door", () => {
    expect(bed).toBeDefined();
    expect([bed.w, bed.d]).toEqual([1.53, 2.03]);
    for (const c of corners(bed)) expect(within(c, bedroom.pts)).toBe(true);
    /* its head is to the back: not the wall the door is in */
    const head: XZ = [bed.at[0] - (bed.facing[0] * bed.d) / 2, bed.at[1] - (bed.facing[1] * bed.d) / 2];
    expect(head[1]).toBeGreaterThan(0.2);
  });

  it("gives the bed a table each side", () => {
    expect(pieces.filter((p) => p.kind === "bedside")).toHaveLength(2);
  });

  it("keeps the door's swing clear", () => {
    for (const p of pieces) for (const c of corners(p)) expect(c[0] > 1.25 || c[1] > 0.95).toBe(true);
  });
});

describe("what she read off the drawing", () => {
  const living = room("Living", rect(0, 0, 6, 5));
  it("stands a sofa with its back to the nearer wall", () => {
    const [sofa] = furnish([living], [], { furniture: [{ kind: "sofa", room: "Living", pts: rect(2, 0.2, 4.2, 1.1) }], joinery: [] });
    expect(sofa.kind).toBe("sofa");
    expect(sofa.read).toBe(true);
    expect(sofa.facing).toEqual([0, 1]);
    expect(sofa.w).toBeCloseTo(2.2);
  });

  it("knows joinery by its words", () => {
    const kitchen = room("Kitchen", rect(0, 0, 5, 4));
    const pieces = furnish([kitchen], [], {
      furniture: [],
      joinery: [
        { kind: "Kitchen island", room: "Kitchen", pts: rect(2, 2, 3.6, 2.9) },
        { kind: "ROBE", room: "Kitchen", pts: rect(0, 3.4, 1.8, 4) },
        { kind: "Vanity", room: "Kitchen", pts: rect(4.4, 0, 5, 1.2) },
      ],
    });
    expect(pieces.map((p) => [p.kind, p.h])).toEqual([
      ["island", 0.9],
      ["tall", 2.1],
      ["vanity", 0.85],
    ]);
  });

  it("leaves a room it furnished from the drawing as drawn", () => {
    const pieces = furnish([room("Bed 1", rect(0, 0, 3.4, 3.4))], [], { furniture: [{ kind: "bed", room: "Bed 1", pts: rect(1, 1.3, 2.5, 3.3) }], joinery: [] });
    expect(pieces.filter((p) => p.kind === "bed")).toHaveLength(1);
    expect(pieces[0].read).toBe(true);
  });
});

describe("which rooms get what", () => {
  it("parks one car in a single garage and two in a double", () => {
    const cars = (pts: XZ[]) => furnish([room("Garage", pts, "garage")], [], none).filter((p) => p.kind === "car").length;
    expect(cars(rect(0, 0, 6, 3))).toBe(1);
    expect(cars(rect(0, 0, 6, 6))).toBe(2);
  });

  it("reads a room's name", () => {
    expect(dressOf(room("Ensuite", rect(0, 0, 2, 2), "wet"))).toEqual(["toilet"]);
    expect(dressOf(room("BATH", rect(0, 0, 3, 3), "wet"))).toEqual(["bath", "toilet"]);
    expect(dressOf(room("Kitchen / Living / Dining", rect(0, 0, 9, 9)))).toEqual(["dining", "living"]);
    expect(dressOf(room("Ex. Master Bed", rect(0, 0, 4, 4)))).toEqual(["bed"]);
    expect(dressOf(room("Hall", rect(0, 0, 4, 1), "circulation"))).toEqual([]);
    expect(dressOf(room("Rear deck", rect(0, 0, 4, 4), "outdoor"))).toEqual(["outdoor"]);
  });

  it("finds a shape's long way", () => {
    const f = frameOf(rect(0, 0, 2, 5));
    expect(f.lu).toBeCloseTo(5);
    expect(f.lv).toBeCloseTo(2);
    expect(Math.abs(f.u[1])).toBeCloseTo(1);
  });
});

describe("the stairs as steps", () => {
  const floor = (id: string, y0: number, spaces: Space3D[]): Floor3D => ({ id, name: id, level: y0 / 3, y0, ceiling: 2.7, spaces, openings: [], read: true, tiles: [], pieces: [], stairs: [] });

  it("rises from the end by the room she read at its bottom, as many risers as she counted, into the well above", () => {
    const stair: Space3D = { ...room("Stairs", rect(4, 0, 5, 3), "stair"), stair: "risers 16, treads 15, bottom Hall, top Landing" };
    const hall = room("Hall", rect(0, 2.5, 4, 5), "circulation");
    const well = room("Stair", rect(4, 0, 5, 3), "stair");
    const ground = floor("g", 0, [stair, hall]);
    const upper = floor("u", 3, [well]);
    flightsOf([upper, ground]);
    expect(ground.stairs).toHaveLength(1);
    const [flight] = ground.stairs;
    expect(flight.risers).toBe(16);
    expect(flight.rise).toBe(3);
    /* the Hall is at the high z end, so that is the bottom */
    expect(flight.from[1]).toBeCloseTo(3);
    expect(flight.to[1]).toBeCloseTo(0);
    expect(well.well).toBe(true);
    expect(upper.stairs).toHaveLength(0);
    /* open at its foot to the Hall, and at its well's head to the landing */
    expect(ground.open).toEqual([
      [
        [5, 3],
        [4, 3],
      ],
    ]);
    expect(upper.open).toEqual([
      [
        [4, 0],
        [5, 0],
      ],
    ]);
  });

  it("narrows its treads where the stair's shape does", () => {
    /* two metres wide for its first metre, then one */
    const stair: Space3D = {
      ...room("Stairs", [
        [0, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 4],
        [0, 4],
      ], "stair"),
      stair: "risers 17, bottom Lounge",
    };
    const ground = floor("g", 0, [stair, room("Lounge", rect(0, -4, 4, 0))]);
    flightsOf([ground, floor("u", 3, [room("Stair", rect(0, 0, 2, 4), "stair")])]);
    const [flight] = ground.stairs;
    const spans = flight.spans!;
    expect(spans).toHaveLength(16);
    const width = ([lo, hi]: [number, number]) => hi - lo;
    expect(width(spans[0])).toBeCloseTo(2);
    expect(width(spans[15])).toBeCloseTo(1);
  });

  it("counts 180 mm risers when the drawing doesn't number them, and leaves a stair with none over it alone", () => {
    const stair: Space3D = { ...room("Stairs", rect(0, 0, 1, 3), "stair"), stair: "risers not numbered" };
    const ground = floor("g", 0, [stair]);
    const upper = floor("u", 2.9, [room("Stair", rect(0, 0, 1, 3), "stair")]);
    flightsOf([ground, upper]);
    expect(ground.stairs[0].risers).toBe(16);
    const lone = floor("l", 0, [{ ...room("Stairs", rect(0, 0, 1, 3), "stair") }]);
    flightsOf([lone]);
    expect(lone.stairs).toHaveLength(0);
  });
});
