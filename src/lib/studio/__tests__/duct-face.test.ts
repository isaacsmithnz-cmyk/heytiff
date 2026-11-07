import type { DesignObject } from "../document";
import { reconcileAttachedRuns } from "../attach";
import { attachOf } from "../graph";
import { layoutPlanLabels } from "../plan-labels";
import { ductFaceSpot } from "../duct-face";

const base = { at: { x: 100, y: 100 }, rotation: 0, w: 140, h: 90, flip: false, dia: 25 };

describe("a duct comes off the unit's face", () => {
  test("supply leaves one long face, return the other, in line with where it goes", () => {
    const s = ductFaceSpot({ ...base, stream: "supply", toward: { x: 120, y: 300 } });
    expect(s.point).toEqual({ x: 120, y: 145 });
    const r = ductFaceSpot({ ...base, stream: "return", toward: { x: 120, y: -300 } });
    expect(r.point).toEqual({ x: 120, y: 55 });
  });

  test("it stays on the casing however far along it is going", () => {
    const s = ductFaceSpot({ ...base, stream: "supply", toward: { x: 900, y: 300 } });
    expect(s.point.x).toBe(100 + 70 - 12.5);
  });

  test("a flipped unit swaps its faces", () => {
    expect(ductFaceSpot({ ...base, flip: true, stream: "supply", toward: { x: 100, y: 300 } }).point.y).toBe(55);
  });

  test("the spot turns and moves with the unit", () => {
    const { off } = ductFaceSpot({ ...base, stream: "supply", toward: { x: 100, y: 300 } });
    const unit = (x: number, rotation: number): DesignObject => ({
      id: "u",
      type: "unit",
      systemId: "s",
      floorId: "f",
      plane: "room",
      geometry: { kind: "point", at: { x, y: 100 }, rotation },
      props: {},
    });
    const run: DesignObject = {
      id: "r",
      type: "duct-run",
      systemId: "s",
      floorId: "f",
      plane: "room",
      geometry: { kind: "polyline", points: [{ x: 100, y: 145 }, { x: 100, y: 300 }] },
      props: { startAttach: { kind: "unit", id: "u", off } },
    };
    expect(attachOf(run.props.startAttach)?.off).toEqual(off);
    const moved = reconcileAttachedRuns([unit(200, 90), run]);
    const pts = (moved[1].geometry as { points: { x: number; y: number }[] }).points;
    expect(pts[0].x).toBeCloseTo(155);
    expect(pts[0].y).toBeCloseTo(100);
  });
});

describe("a short run's words", () => {
  const input = {
    px: 1,
    rooms: [],
    /* 20 long, its words 100+ wide, and a controller's plate on the only spots beside it */
    runs: [{ id: "r", points: [{ x: 500, y: 500 }, { x: 500, y: 520 }], text: "2.96 m, Ø250 supply", size: 11 }],
    solids: [{ x0: 340, y0: 470, x1: 660, y1: 550 }],
  };
  test("sit on the run when nothing asks for a leader, as today", () => {
    expect(layoutPlanLabels(input).runs.get("r")?.leader).toBeUndefined();
  });
  test("move to a clear spot on a leader back to the run", () => {
    const got = layoutPlanLabels({ ...input, leadersWithin: { x0: 0, y0: 0, x1: 1000, y1: 1000 } }).runs.get("r")!;
    expect(got.leader).toBeDefined();
    expect(got.leader![1]).toEqual({ x: 500, y: 510 });
    const meets = got.box.x0 < 660 && got.box.x1 > 340 && got.box.y0 < 550 && got.box.y1 > 470;
    expect(meets).toBe(false);
  });
});
