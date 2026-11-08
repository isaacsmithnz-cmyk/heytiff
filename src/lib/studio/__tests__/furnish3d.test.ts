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

  it("counts 180 mm risers when the drawing doesn't number them", () => {
    const stair: Space3D = { ...room("Stairs", rect(0, 0, 1, 3), "stair"), stair: "risers not numbered" };
    const ground = floor("g", 0, [stair]);
    const upper = floor("u", 2.9, [room("Stair", rect(0, 0, 1, 3), "stair")]);
    flightsOf([ground, upper]);
    expect(ground.stairs[0].risers).toBe(16);
  });

  /* 90 O'Brien St and 27 Milroy Ave (9 November 2026): the hall at the stair's
     foot below and the landing at its head above are at the same end. Drawn
     straight, it rose into the outside wall. */
  it("turns back on itself when its foot and its head are at the same end: up one half, a landing, back along the other", () => {
    const stair: Space3D = { ...room("Stair", rect(4, 0, 6, 4), "stair"), stair: "risers 18, treads 17, bottom Hall, top Landing" };
    const hall = room("Hall", rect(0, 4, 8, 5.5), "circulation");
    /* her outline fills only the west half at the foot: the first flight goes up there */
    stair.pts = [
      [4, 0],
      [6, 0],
      [6, 2],
      [5, 2],
      [5, 4],
      [4, 4],
    ];
    const ground = floor("g", 0, [stair, hall]);
    const well = room("Stair", rect(4, 0, 6, 4), "stair");
    const upper = floor("u", 3, [well, room("Landing", rect(0, 4, 8, 5.5), "circulation")]);
    flightsOf([ground, upper]);
    expect(ground.stairs).toHaveLength(2);
    const [up1, up2] = ground.stairs;
    /* up the west half from the hall, northwards, to a landing a flight wide */
    expect(up1.from).toEqual([4.5, 4]);
    expect(up1.to[0]).toBeCloseTo(4.5);
    expect(up1.to[1]).toBeCloseTo(1);
    expect(up1.risers).toBe(9);
    expect(up1.rise).toBeCloseTo(1.5);
    expect(up1.landing?.y).toBeCloseTo(1.5);
    /* and back down the east half to the landing above, at the hall's end */
    expect(up2.from[0]).toBeCloseTo(5.5);
    expect(up2.to).toEqual([5.5, 4]);
    expect(up2.y0).toBeCloseTo(1.5);
    expect(up2.y0 + up2.rise).toBeCloseTo(3);
    /* open at the foot on the west half, and above on the east half it arrives by */
    expect(ground.open).toEqual([
      [
        [4, 4],
        [5, 4],
      ],
    ]);
    expect(upper.open).toEqual([
      [
        [5, 4],
        [6, 4],
      ],
    ]);
  });

  describe("with no stair over or under it", () => {
    const lone = (said: string, others: Space3D[] = []) => {
      const s: Space3D = { ...room("Stair", rect(0, 0, 1, 3), "stair"), stair: said };
      const f = floor("f", 0, [s, ...others]);
      flightsOf([f]);
      return { f, s };
    };

    it("is a stairwell down from the room at its top, when the floor below isn't in the design (125 Homer St)", () => {
      const { f, s } = lone("risers 20, treads 19, bottom ground floor (below), top Living", [room("Living", rect(0, -3, 4, 0))]);
      expect(s.well).toBe(true);
      const [flight] = f.stairs;
      expect(flight.risers).toBe(20);
      /* down from the Living's end, a storey */
      expect(flight.to).toEqual([0.5, 0]);
      expect(flight.y0 + flight.rise).toBeCloseTo(0);
      expect(flight.y0).toBeCloseTo(-3);
      expect(f.open).toEqual([
        [
          [0, 0],
          [1, 0],
        ],
      ]);
    });

    it("is a flight going up out of its room, standing free, when the floor above isn't (14 Rosemont Ave)", () => {
      const { f, s } = lone("risers not numbered, bottom Living, top First floor hallway", [room("Living", rect(-4, 3, 4, 6))]);
      expect(s.bare).toBe(true);
      const [flight] = f.stairs;
      expect(flight.from).toEqual([0.5, 3]);
      expect(flight.y0).toBe(0);
      expect(flight.rise).toBeCloseTo(3);
    });

    it("is its steps between two places on the floor, down from a room's floor to the garden (7 Cutler Rd)", () => {
      const { f, s } = lone("risers 10, treads 9, bottom Garden, top Family Room", [room("Family Room", rect(-4, 3, 4, 6)), room("Garden", rect(-4, -3, 4, 0), "outdoor")]);
      expect(s.bare).toBe(true);
      const [flight] = f.stairs;
      expect(flight.risers).toBe(10);
      expect(flight.from).toEqual([0.5, 0]);
      expect(flight.to).toEqual([0.5, 3]);
      expect(flight.y0).toBeCloseTo(-1.75);
      expect(flight.y0 + flight.rise).toBeCloseTo(0);
    });

    it("goes up a storey when nothing was read at its ends", () => {
      const { f, s } = lone("");
      expect(s.bare).toBe(true);
      expect(f.stairs[0].rise).toBeCloseTo(3);
    });
  });
});
