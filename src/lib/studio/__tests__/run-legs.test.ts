import { distToSmoothed, polylineLength, smoothedLength, smoothPathD, unitsToMeters } from "../geometry";
import { deleteJoint, jointOnRun } from "../joints";
import { paperRunText } from "../paper-labels";
import {
  ductFreeEnds,
  ductJunctions,
  isCurvedRun,
  legsJoined,
  legsOfCut,
  legsProp,
  legsWithoutDot,
  nextDot,
  runLengthUnits,
  straightLegsOf,
} from "../run-legs";
import type { DesignDocument, DesignObject, Floor, Point } from "../document";

const dots: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 200, y: 80 },
  { x: 300, y: 80 },
];

/** the control points of a path's nth bezier */
const bezier = (d: string, n: number) =>
  [...d.matchAll(/C ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+)/g)][n].slice(1).map(Number);

describe("drawing a line", () => {
  const prev = { x: 10, y: 10 };
  const w = { x: 110, y: 40 };
  it("goes where the dot is put without Shift", () => {
    expect(nextDot(prev, w, false)).toEqual(w);
  });
  it("goes straight and square with Shift", () => {
    expect(nextDot(prev, w, true)).toEqual({ x: 110, y: 10 });
    expect(nextDot(prev, { x: 20, y: 90 }, true)).toEqual({ x: 10, y: 90 });
  });
});

describe("a curve with a straight leg", () => {
  it("draws that leg as a straight line", () => {
    const [c1x, c1y, c2x, c2y] = bezier(smoothPathD(dots, [0]), 0);
    expect(c1y).toBeCloseTo(0, 9);
    expect(c2y).toBeCloseTo(0, 9);
    expect(c1x).toBeCloseTo(100 / 3, 9);
    expect(c2x).toBeCloseTo(200 / 3, 9);
  });

  it("bends it without the list: the same dots bow off the line", () => {
    const [, c1y, , c2y] = bezier(smoothPathD(dots), 0);
    expect(c2y).not.toBeCloseTo(0, 3);
    expect(c1y).toBeCloseTo(0, 9);
  });

  it("leaves along the straight leg, with no kink where they meet", () => {
    const [c1x, c1y] = bezier(smoothPathD(dots, [0]), 1);
    expect(c1x).toBeGreaterThan(100);
    expect(c1y).toBeCloseTo(0, 9);
  });

  it("comes into a straight leg along it", () => {
    const [, , c2x, c2y] = bezier(smoothPathD(dots, [2]), 1);
    expect(c2x).toBeLessThan(200);
    expect(c2y).toBeCloseTo(80, 9);
  });

  it("two straight legs together meet at a corner", () => {
    const corner = [dots[0], dots[1], { x: 100, y: 100 }];
    expect(smoothedLength(corner, [0, 1])).toBeCloseTo(polylineLength(corner), 6);
  });

  it("is measured and hit where it is drawn", () => {
    const straight = smoothedLength(dots, [0, 1, 2]);
    expect(straight).toBeCloseTo(polylineLength(dots), 6);
    expect(smoothedLength(dots, [0])).toBeGreaterThan(straight);
    expect(distToSmoothed({ x: 50, y: 0 }, dots, [0])).toBeLessThan(0.01);
  });
});

describe("what a run stores", () => {
  it("nothing when no leg is straight", () => {
    expect(legsProp([], 4)).toEqual({});
  });
  it("only the legs it has, in order, once each", () => {
    expect(legsProp([2, 0, 2, 3], 3)).toEqual({ straight: [0] });
    expect(legsProp([2, 0, 2], 4)).toEqual({ straight: [0, 2] });
  });
  it("reads none from a run that has none", () => {
    expect(straightLegsOf({})).toBeUndefined();
    expect(straightLegsOf({ straight: [] })).toBeUndefined();
    expect(straightLegsOf({ straight: [1] })).toEqual([1]);
  });
});

describe("the legs follow the dots", () => {
  it("a dot taken out joins the two legs beside it into a curve", () => {
    expect(legsWithoutDot([0, 1, 2, 3], 2)).toEqual([0, 2]);
    expect(legsWithoutDot([3], 1)).toEqual([2]);
  });
  it("the last dot taken out takes the last leg", () => {
    expect(legsWithoutDot([0, 2], 3)).toEqual([0]);
  });
  it("a cut leaves both pieces of the leg straight", () => {
    expect(legsOfCut([0, 2, 3], 2)).toEqual({ first: [0, 2], second: [0, 1] });
  });
  it("two pieces joined number on from the first", () => {
    expect(legsJoined([0], 3, [0, 1])).toEqual([0, 2, 3]);
  });
});

const run = (props: Record<string, unknown>, type = "duct-run"): DesignObject =>
  ({ id: "r", type, systemId: "s", floorId: "f", plane: "room", geometry: { kind: "polyline", points: dots }, props }) as DesignObject;

describe("lengths", () => {
  it("every curved kind is curved, and rigid is not", () => {
    expect(isCurvedRun(run({ form: "flex" }))).toBe(true);
    expect(isCurvedRun(run({ form: "rigid" }))).toBe(false);
    expect(isCurvedRun(run({ form: "soft" }, "pipe-run"))).toBe(true);
    expect(isCurvedRun(run({}, "cable-run"))).toBe(true);
    expect(isCurvedRun(run({}, "drain-run"))).toBe(false);
  });

  it("a flex duct reads the same on paper as in its length", () => {
    const flex = run({ form: "flex", diaMm: 300, stream: "supply", straight: [0] }) as DesignObject & {
      geometry: { kind: "polyline"; points: Point[] };
    };
    const floor = { id: "f", scaleMmPerUnit: 10 } as Floor;
    expect(paperRunText(flex, floor)).toBe(`Ø300, ${unitsToMeters(runLengthUnits(flex, dots), 10).toFixed(1)} m`);
    expect(runLengthUnits(flex, dots)).toBeGreaterThan(polylineLength(dots));
  });
});

describe("a joint on a curve with straight legs", () => {
  const doc = {
    objects: [run({ form: "soft", straight: [0, 2] }, "pipe-run")],
  } as DesignDocument;
  const legsOf = (d: DesignDocument) =>
    d.objects.filter((o) => o.type === "pipe-run").map((o) => o.props.straight);

  it("cuts the legs with the run, and puts them back when it goes", () => {
    const cut = jointOnRun(doc, "r", 0, { x: 50, y: 0 }, "j")!;
    expect(legsOf(cut.doc)).toEqual([[0], [0, 2]]);
    const whole = deleteJoint(cut.doc, "j");
    expect(whole.objects.filter((o) => o.type === "pipe-run")).toHaveLength(1);
    /* the cut leg is two straight legs in line, and the far one has moved on by its extra dot */
    expect(legsOf(whole)).toEqual([[0, 1, 3]]);
  });
});

describe("where ducts meet", () => {
  const J = { x: 50, y: 50 };
  const duct = (dia: number, points: Point[], props: Record<string, unknown> = {}, stream = "supply") =>
    ({ type: "duct-run", floorId: "f", props: { form: "flex", diaMm: dia, stream, ...props }, geometry: { kind: "polyline", points } });
  const A = { x: 0, y: 50 };
  const B = { x: 100, y: 50 };
  const C = { x: 50, y: 100 };

  it("is a fitting at three free ends, its sizes biggest first", () => {
    const js = ductJunctions([duct(300, [J, B]), duct(400, [A, J], { startAttach: { kind: "unit", id: "u" } }), duct(350, [J, C])]);
    expect(js).toHaveLength(1);
    expect(js[0]).toMatchObject({ at: J, stream: "supply", diasMm: [400, 350, 300] });
  });

  it("is a fitting at two free ends, a duct dropped on the circle", () => {
    expect(ductJunctions([duct(300, [A, J]), duct(250, [J, B])])[0].diasMm).toEqual([300, 250]);
  });

  it("is a free end, the circle, when a duct ends on its own", () => {
    const ends = ductFreeEnds([duct(300, [A, J], { startAttach: { kind: "unit", id: "u" } })]);
    expect(ends.map((e) => e.at)).toEqual([J]);
    expect(ductJunctions([duct(300, [A, J])])).toEqual([]);
  });

  it("gives each end the duct as drawn, from that end", () => {
    const [j] = ductJunctions([duct(300, [A, J], { form: "rigid" }), duct(300, [J, B], { form: "rigid" })]);
    expect(j.ends.map((e) => e.path)).toEqual([[J, A], [J, B]]);
  });

  it("is nothing for an end attached to something", () => {
    expect(ductJunctions([duct(300, [A, J], { endAttach: { kind: "grille", id: "g" } }), duct(300, [J, B])])).toEqual([]);
  });

  it("does not join supply to return, or one floor to another", () => {
    expect(ductJunctions([duct(300, [A, J]), duct(300, [J, C], {}, "return")])).toEqual([]);
    expect(ductJunctions([duct(300, [A, J]), { ...duct(300, [J, C]), floorId: "g" }])).toEqual([]);
  });

  it("leaves ducts drawn before the next flow alone", () => {
    const old = (points: Point[]) => {
      const { form: _f, ...props } = duct(300, points).props;
      void _f;
      return { ...duct(300, points), props };
    };
    expect(ductJunctions([old([A, J]), old([J, B]), old([J, C])])).toEqual([]);
  });
});
