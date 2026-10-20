import { framingOf, roofHeightAt, roofMesh, type RoofRect } from "../roof3d";

/* The roof and its framing (lib/studio/roof3d): heights where they should
   be, and timber at its standard spacings. */

const rect = (part: Partial<RoofRect["part"]>, over: Partial<RoofRect> = {}): RoofRect => ({
  x0: 0,
  x1: 10,
  z0: 0,
  z1: 6,
  base: 2.4,
  part: { form: "gable", ridge: "across", fallsTo: "", pitchDeg: 22.5, overhangMm: 450, ...part },
  ...over,
});
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 2);

describe("the roof's height", () => {
  it("a gable rises from the walls to its ridge in the middle, the ridge along x", () => {
    const r = rect({});
    close(roofHeightAt(r, 5, 0), 2.4);
    close(roofHeightAt(r, 5, 3), 2.4 + 3 * tan(22.5));
    close(roofHeightAt(r, 0.5, 3), 2.4 + 3 * tan(22.5));
    expect(roofHeightAt(r, 11, 3)).toBe(-Infinity);
  });

  it("a hip falls to its ends as well as its sides", () => {
    const r = rect({ form: "hip" });
    close(roofHeightAt(r, 5, 3), 2.4 + 3 * tan(22.5));
    close(roofHeightAt(r, 1, 3), 2.4 + 1 * tan(22.5));
  });

  it("a skillion climbs away from the side it falls to", () => {
    const right = rect({ form: "skillion", ridge: "down", fallsTo: "right", pitchDeg: 6 });
    close(roofHeightAt(right, 10, 3), 2.4);
    close(roofHeightAt(right, 0, 3), 2.4 + 10 * tan(6));
    const left = rect({ form: "skillion", ridge: "down", fallsTo: "left", pitchDeg: 6 });
    close(roofHeightAt(left, 0, 3), 2.4);
  });
});

describe("the roof's sheets", () => {
  it("a gable is two slopes past the eaves and two gable ends", () => {
    const { faces, fills } = roofMesh(rect({}));
    expect(faces.tris).toHaveLength(12);
    expect(fills.tris).toHaveLength(6);
    // the eaves stand out past the walls, a little lower
    const zs = faces.verts.map((v) => v[2]);
    expect(Math.min(...zs)).toBeCloseTo(-0.45, 3);
    expect(Math.min(...faces.verts.map((v) => v[1]))).toBeCloseTo(2.4 - 0.45 * tan(22.5), 2);
  });

  it("a skillion is one slope, with its high wall and the ends climbing to it", () => {
    const { faces, fills } = roofMesh(rect({ form: "skillion", ridge: "down", fallsTo: "right", pitchDeg: 6 }));
    expect(faces.tris).toHaveLength(6);
    expect(fills.tris).toHaveLength(12);
  });
});

describe("the framing", () => {
  it("rafters at 600 both sides of the ridge, a ridge board, joists at 450 across the short way", () => {
    const m = framingOf(rect({}));
    const count = (k: string) => m.filter((x) => x.k === k).length;
    expect(count("ridge")).toBe(1);
    // 9.9 m of ridge at 600: 16 whole bays, 17 pairs, centred
    expect(count("rafter")).toBe(34);
    expect(count("joist")).toBe(22);
    // the joists span z, the short way
    const j = m.find((x) => x.k === "joist")!;
    expect(j.a[0]).toBe(j.b[0]);
  });

  it("leaves the joists out over a raked ceiling", () => {
    const all = framingOf(rect({})).filter((x) => x.k === "joist").length;
    const some = framingOf(rect({}), (x) => x < 4).filter((x) => x.k === "joist").length;
    expect(some).toBeLessThan(all);
  });

  it("a hip has its four hip rafters, and a skillion one run of rafters", () => {
    expect(framingOf(rect({ form: "hip" })).filter((x) => x.k === "hip")).toHaveLength(4);
    const sk = framingOf(rect({ form: "skillion", ridge: "down", fallsTo: "right", pitchDeg: 6 }));
    expect(sk.filter((x) => x.k === "ridge")).toHaveLength(0);
    expect(sk.filter((x) => x.k === "rafter").length).toBeGreaterThan(5);
  });
});
