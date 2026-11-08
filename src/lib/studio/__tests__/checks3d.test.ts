import { clashesOf, distanceWords, roofSpaceOf, roomFor } from "../checks3d";
import { framingOf, type RoofRect } from "../roof3d";
import type { Scene3D } from "../scene3d";

/* One room, 10 by 6, ceiling at 2.4, under a 22.5° gable across it. */
const roof: RoofRect & { floorId: string } = {
  x0: 0,
  x1: 10,
  z0: 0,
  z1: 6,
  base: 2.4,
  part: { form: "gable", ridge: "across", fallsTo: "", pitchDeg: 22.5, overhangMm: 450 },
  floorId: "gf",
};
const scene = (over: Partial<Scene3D> = {}) =>
  ({
    floors: [],
    ceilings: [{ floorId: "gf", flat: [{ pts: [[0, 0], [10, 0], [10, 6], [0, 6]], y: 2.4 }], raked: [], tops: [] }],
    roofRects: [roof],
    framing: framingOf(roof).map((m) => ({ ...m, floorId: "gf" })),
    ducts: [],
    pipes: [],
    ...over,
  }) as unknown as Scene3D;

describe("the roof space over each room", () => {
  const cells = roofSpaceOf(scene());

  it("covers the room in half-metre patches", () => {
    expect(cells).toHaveLength(20 * 12);
    expect(cells.every((c) => c.y === 2.52)).toBe(true);
  });

  it("is tight at the eaves and roomy under the ridge", () => {
    const at = (z: number) => cells.find((c) => c.x0 === 5 && c.z0 === z)!.clear;
    expect(at(0)).toBeLessThan(0.3);
    expect(at(2.5)).toBeGreaterThan(at(0));
    expect(roomFor(at(0))).toBe("none");
    expect(roomFor(at(2.5))).toBe("fits");
  });

  it("leaves out a room with no roof over it", () => {
    expect(roofSpaceOf(scene({ roofRects: [] }))).toHaveLength(0);
  });
});

describe("a duct or pipe through the framing", () => {
  it("is marked where a duct runs through the rafters near the eaves", () => {
    const clashes = clashesOf(scene({ ducts: [{ floorId: "gf", pts: [[0.2, 2.7, 0.5], [9.8, 2.7, 0.5]], r: 0.1, flex: true, body: "", edge: "", rib: "" }] }));
    expect(clashes.length).toBeGreaterThan(3);
    expect(clashes.every((c) => c.what === "duct" && c.through === "rafter")).toBe(true);
  });

  it("isn't marked for a duct lying on top of the joists under the ridge", () => {
    expect(clashesOf(scene({ ducts: [{ floorId: "gf", pts: [[0.6, 2.75, 3.1], [9.4, 2.75, 3.1]], r: 0.1, flex: true, body: "", edge: "", rib: "" }] }))).toHaveLength(0);
  });
});

it("says a distance as a builder does", () => {
  expect(distanceWords([0, 0, 0], [2.345, 0, 0])).toBe("2.35 m");
  expect(distanceWords([0, 0, 0], [0, 0.85, 0])).toBe("850 mm");
});
