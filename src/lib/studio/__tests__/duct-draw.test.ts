import { chooseDuctStream, cutDuctAt, ductsFollowGrille, nearestOnDucts, spreadDuctStream, thinStroke, unitFaceToward } from "../duct-draw";
import type { DesignObject, Point } from "../document";
import { ductJunctions } from "../run-legs";
import { fittingName } from "../duct-fitting";

const duct = (id: string, points: Point[], props: Record<string, unknown> = {}): DesignObject =>
  ({ id, type: "duct-run", systemId: "s", floorId: "f", geometry: { kind: "polyline", points }, plane: "room", props: { form: "rigid", diaMm: 400, stream: "supply", ...props } }) as DesignObject;
const dotsOf = (o: DesignObject | undefined) => (o?.geometry.kind === "polyline" ? o.geometry.points : []);

describe("a drawn stroke", () => {
  it("comes down to few dots and keeps its corners and ends", () => {
    const stroke = [...Array.from({ length: 50 }, (_, i) => ({ x: i * 2, y: Math.sin(i) * 0.3 })), ...Array.from({ length: 50 }, (_, i) => ({ x: 100, y: i * 2 }))];
    const dots = thinStroke(stroke, 3);
    expect(dots.length).toBeLessThan(6);
    expect(dots[0]).toEqual(stroke[0]);
    expect(dots[dots.length - 1]).toEqual(stroke[stroke.length - 1]);
    expect(dots.some((p) => Math.hypot(p.x - 100, p.y) < 4)).toBe(true);
  });

  it("is a line between its ends when it never leaves one", () => {
    expect(thinStroke(Array.from({ length: 30 }, (_, i) => ({ x: i, y: 0 })), 2)).toHaveLength(2);
  });
});

describe("on a duct", () => {
  const trunk = duct("a", [{ x: 0, y: 0 }, { x: 100, y: 0 }]);

  it("finds the spot, within the duct's own reach", () => {
    expect(nearestOnDucts([trunk], { x: 40, y: 15 }, () => 20)).toEqual({ runId: "a", seg: 0, at: { x: 40, y: 0 }, stream: "supply" });
    expect(nearestOnDucts([trunk], { x: 40, y: 25 }, () => 20)).toBeNull();
  });

  it("finds it along a flex duct's curve, not the straight line between its dots", () => {
    const flex = duct("f", [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }], { form: "flex" });
    const on = nearestOnDucts([flex], { x: 50, y: 50 }, () => 5);
    expect(on?.at.y).toBeCloseTo(50, 0);
  });

  it("cuts it in two at the spot, each end keeping what it was on", () => {
    const held = duct("a", [{ x: 0, y: 0 }, { x: 100, y: 0 }], { startAttach: { kind: "unit", id: "u" }, endAttach: { kind: "grille", id: "g" } });
    const [head, tail] = cutDuctAt([held], { x: 40, y: 0 }, "b");
    expect(dotsOf(head)).toEqual([{ x: 0, y: 0 }, { x: 40, y: 0 }]);
    expect(dotsOf(tail)).toEqual([{ x: 40, y: 0 }, { x: 100, y: 0 }]);
    expect(head.props.startAttach).toBeTruthy();
    expect(head.props.endAttach).toBeUndefined();
    expect(tail.props.endAttach).toBeTruthy();
    expect(tail.props.startAttach).toBeUndefined();
    expect(tail.id).toBe("b");
  });

  it("makes the fitting with the duct dropped there, with nothing stored", () => {
    const cut = cutDuctAt([trunk], { x: 40, y: 0 }, "b");
    const branch = duct("c", [{ x: 40, y: 0 }, { x: 40, y: 80 }], { diaMm: 300 });
    const [fit] = ductJunctions([...cut, branch]);
    expect(fittingName(fit)).toBe("BTO 16-16-12");
  });

  it("does not cut on the very end", () => {
    expect(cutDuctAt([trunk], { x: 100, y: 0 }, "b")).toHaveLength(1);
  });

  it("keeps Shift's straight legs on the right pieces", () => {
    const three = duct("a", [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }], { form: "flex", straight: [0, 2] });
    const [head, tail] = cutDuctAt([three], { x: 75, y: 0 }, "b");
    expect(head.props.straight).toEqual([0]);
    expect(tail.props.straight).toEqual([1]);
  });
});

describe("a duct's stream comes from what it touches", () => {
  const grille = (stream: "supply" | "return") => ({ stream, decides: true });

  it("is a grille's first", () => {
    expect(chooseDuctStream({ stream: "supply" }, grille("return"), "supply")).toBe("return");
    expect(chooseDuctStream(grille("return"), { stream: "supply" }, null)).toBe("return");
  });
  it("then what it joins, then a unit's face", () => {
    expect(chooseDuctStream({ stream: "return" }, null, "supply")).toBe("return");
    expect(chooseDuctStream(null, null, "return")).toBe("return");
  });
  it("is supply touching nothing", () => {
    expect(chooseDuctStream(null, null, null)).toBe("supply");
  });

  it("takes the unit's face it heads for, flipped or turned", () => {
    const unit = { at: { x: 0, y: 0 }, rotation: 0, flip: false };
    expect(unitFaceToward(unit, { x: 0, y: 50 })).toBe("supply");
    expect(unitFaceToward(unit, { x: 0, y: -50 })).toBe("return");
    expect(unitFaceToward({ ...unit, flip: true }, { x: 0, y: 50 })).toBe("return");
    expect(unitFaceToward({ ...unit, rotation: 90 }, { x: -50, y: 0 })).toBe("supply");
  });

  it("spreads to everything joined, bar what a grille or unit holds", () => {
    const a = duct("a", [{ x: 0, y: 0 }, { x: 10, y: 0 }], { stream: "return" });
    const b = duct("b", [{ x: 10, y: 0 }, { x: 20, y: 0 }]);
    const c = duct("c", [{ x: 20, y: 0 }, { x: 30, y: 0 }]);
    const held = duct("h", [{ x: 20, y: 0 }, { x: 20, y: 9 }], { endAttach: { kind: "unit", id: "u" } });
    const apart = duct("z", [{ x: 500, y: 0 }, { x: 510, y: 0 }]);
    const out = spreadDuctStream([a, b, c, held, apart], "a");
    const streamOf = (id: string) => out.find((o) => o.id === id)?.props.stream;
    expect(streamOf("b")).toBe("return");
    expect(streamOf("c")).toBe("return");
    expect(streamOf("h")).toBe("supply");
    expect(streamOf("z")).toBe("supply");
  });

  it("follows a grille that changes", () => {
    const on = duct("a", [{ x: 0, y: 0 }, { x: 10, y: 0 }], { endAttach: { kind: "grille", id: "g" } });
    const next = duct("b", [{ x: 0, y: 0 }, { x: 0, y: 10 }]);
    const out = ductsFollowGrille([on, next], "g", "return");
    expect(out.map((o) => o.props.stream)).toEqual(["return", "return"]);
  });
});
