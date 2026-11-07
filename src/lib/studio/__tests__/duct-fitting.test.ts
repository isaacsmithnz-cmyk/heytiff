import { ductLinesOn, fittingKind, fittingName, fittingShape } from "../duct-fitting";
import { riserMark } from "../duct-size";
import type { DesignObject, Point } from "../document";
import { ductJunctions } from "../run-legs";

const O = { x: 0, y: 0 };
const toward = (deg: number, far = 500): Point => ({ x: Math.cos((deg * Math.PI) / 180) * far, y: Math.sin((deg * Math.PI) / 180) * far });
const end = (diaMm: number, deg: number) => ({ diaMm, path: [O, toward(deg)] });
const widthOf = (dia: number) => dia / 10;

describe("what a fitting is called", () => {
  it.each([
    ["Joiner 14-14", [end(350, 180), end(350, 0)]],
    ["Reducer 16-12", [end(400, 180), end(300, 0)]],
    ["Y 14-12-12", [end(350, 180), end(300, -45), end(300, 45)]],
    ["Y 14-10-8", [end(350, 180), end(250, -45), end(200, 45)]],
    ["Y 14-10-10-10", [end(350, 180), end(250, -50), end(250, 0), end(250, 50)]],
    ["Y 16-10-10-10-10", [end(400, 180), end(250, -66), end(250, -22), end(250, 22), end(250, 66)]],
    ["BTO 16-16-12", [end(400, 180), end(400, 0), end(300, 90)]],
    ["Double BTO 16-14-12-12", [end(400, 180), end(350, 0), end(300, -90), end(300, 90)]],
  ])("%s", (name, ends) => {
    expect(fittingName({ ends })).toBe(name);
  });

  it("is a Y when what runs straight on is no bigger than a branch (7 Cutler's second)", () => {
    expect(fittingKind([end(400, 180), end(350, 90), end(300, 0)])).toBe("Y");
  });

  it("takes a size no list carries as readily as one they do", () => {
    expect(fittingName({ ends: [end(500, 180), end(175, -40), end(125, 40)] })).toBe("Y 20-7-5");
  });
});

describe("a fitting's shape", () => {
  const j = { at: O, ends: [end(400, 180), end(300, 0), end(200, 90)] };
  const shape = fittingShape(j, widthOf);

  it("has a hub the size of the way in and a leg for every duct", () => {
    expect(shape.hubRadius).toBe(20);
    expect(shape.legs).toHaveLength(3);
  });

  const off = (heading: Point, deg: number) => {
    const r = (deg * Math.PI) / 180;
    return { x: Math.cos(r) - heading.x, y: Math.sin(r) - heading.y };
  };

  it("keeps a BTO's trunk dead straight and its branch square, whatever angles the ducts are drawn at", () => {
    const bto = fittingShape({ at: O, ends: [end(400, 170), end(400, 6), end(300, 72)] }, widthOf);
    expect(off(bto.legs[0].heading, 180).x).toBeCloseTo(0);
    expect(off(bto.legs[1].heading, 0).x).toBeCloseTo(0);
    expect(off(bto.legs[2].heading, 90).y).toBeCloseTo(0);
    expect(off(bto.legs[2].heading, 90).x).toBeCloseTo(0);
  });

  it("sets a Y's legs a square apart, and a leg in the middle for a third", () => {
    const y = fittingShape({ at: O, ends: [end(400, 180), end(300, -30), end(300, 70)] }, widthOf);
    const dot = y.legs[1].heading.x * y.legs[2].heading.x + y.legs[1].heading.y * y.legs[2].heading.y;
    expect(dot).toBeCloseTo(0);
    const three = fittingShape({ at: O, ends: [end(350, 180), end(250, -50), end(250, 0), end(250, 50)] }, widthOf);
    expect(three.legs[2].heading.x).toBeCloseTo(1);
    expect(three.legs[2].heading.y).toBeCloseTo(0);
  });

  it("does not change with a curve past the spigot", () => {
    const curls = Array.from({ length: 40 }, (_, i) => ({ x: 20 * i, y: i < 20 ? 0 : (i - 20) ** 2 }));
    const a = fittingShape({ at: O, ends: [end(400, 180), end(400, 0), end(300, 90)] }, widthOf);
    const b = fittingShape({ at: O, ends: [end(400, 180), { diaMm: 400, path: curls }, end(300, 90)] }, widthOf);
    expect(b.legs[1].outline).toEqual(a.legs[1].outline);
  });

  it("has straight legs ending square, a spigot the size of its duct", () => {
    const { outline, mouth, heading } = shape.legs[1];
    expect(Math.hypot(mouth[0].x - mouth[1].x, mouth[0].y - mouth[1].y)).toBeCloseTo(30);
    expect((mouth[1].x - mouth[0].x) * heading.x + (mouth[1].y - mouth[0].y) * heading.y).toBeCloseTo(0);
    expect(Math.hypot(outline[0].x - outline[5].x, outline[0].y - outline[5].y)).toBeCloseTo(40);
  });

  it("makes a BTO's branch a plain tube", () => {
    const { outline } = shape.legs[2];
    expect(Math.hypot(outline[0].x - outline[5].x, outline[0].y - outline[5].y)).toBeCloseTo(20);
  });

  it("brings a duct off the spigot's end dead straight, then back to its own line", () => {
    const curving = Array.from({ length: 41 }, (_, i) => ({ x: 10 * i * Math.cos(i / 20), y: 10 * i * Math.sin(i / 20) }));
    const j = { at: O, stream: "supply" as const, diasMm: [400, 300, 300], ends: [end(400, 180), { diaMm: 300, path: curving, runId: "bent", fromEnd: "start" as const }, end(300, 90)] };
    const { legs } = fittingShape(j, widthOf);
    const line = ductLinesOn([j], widthOf).get("bent")!;
    const mouth = { x: (legs[1].mouth[0].x + legs[1].mouth[1].x) / 2, y: (legs[1].mouth[0].y + legs[1].mouth[1].y) / 2 };
    expect(line[1].x).toBeCloseTo(mouth.x);
    expect(line[1].y).toBeCloseTo(mouth.y);
    const leaving = { x: line[2].x - line[1].x, y: line[2].y - line[1].y };
    const d = Math.hypot(leaving.x, leaving.y);
    expect(leaving.x / d).toBeCloseTo(legs[1].heading.x, 1);
    expect(line[line.length - 1]).toEqual(curving[curving.length - 1]);
  });

  it("never takes more than most of a short duct", () => {
    const { mouth } = fittingShape({ at: O, ends: [end(400, 180), { diaMm: 300, path: [O, { x: 10, y: 0 }] }] }, widthOf).legs[1];
    expect(mouth[0].x).toBeCloseTo(6);
  });

  it("works from the ducts as they are drawn", () => {
    const duct = (diaMm: number, points: Point[]) => ({ type: "duct-run", floorId: "f", props: { form: "rigid", diaMm, stream: "supply" }, geometry: { kind: "polyline", points } });
    const [fit] = ductJunctions([duct(350, [toward(180), O]), duct(250, [O, toward(-50)]), duct(250, [O, toward(0)]), duct(250, [O, toward(50)])]);
    expect(fittingName(fit)).toBe("Y 14-10-10-10");
  });
});

describe("a riser's word", () => {
  const riser = (id: string, floorId: string, group = "A") =>
    ({ id, type: "riser", systemId: "s", floorId, geometry: { kind: "point", at: O }, plane: "room", props: { group } }) as DesignObject;
  const run = (type: string, on: string, diaMm = 300) =>
    ({ id: `r-${on}-${diaMm}`, type, systemId: "s", floorId: "f", geometry: { kind: "polyline", points: [O, { x: 9, y: 0 }] }, plane: "room", props: { diaMm, endAttach: { kind: "riser", id: on } } }) as DesignObject;

  it("is DR with a duct up it, at the biggest duct", () => {
    const a = riser("a", "f");
    expect(riserMark([a, run("duct-run", "a"), run("duct-run", "a", 400)], a)).toEqual({ word: "DR", diaMm: 400 });
  });
  it("is DR on the floor the duct is not on, through its pair", () => {
    const a = riser("a", "f");
    const b = riser("b", "g");
    expect(riserMark([a, b, run("duct-run", "a")], b).word).toBe("DR");
  });
  it("is PR with a pipe up it, or nothing yet", () => {
    const a = riser("a", "f");
    expect(riserMark([a, run("pipe-run", "a")], a)).toEqual({ word: "PR", diaMm: null });
    expect(riserMark([a], a).word).toBe("PR");
  });
  it("does not take another group's duct", () => {
    const a = riser("a", "f");
    const b = riser("b", "f", "B");
    expect(riserMark([a, b, run("duct-run", "b")], a).word).toBe("PR");
  });
});
