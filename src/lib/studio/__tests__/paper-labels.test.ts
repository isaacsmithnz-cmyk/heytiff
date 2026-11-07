import { calloutContent, calloutLayout } from "../callouts";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { CALLOUT_FONT_REF, planFigureBounds, sheetUnitOf } from "../figure-bounds";
import { createNote, noteLayoutOf, type NoteObject } from "../notes";
import { clearCallouts, paperFootprint } from "../paper-labels";

/* 10 mm a unit on a 10 m by 7 m sheet: a PEA under a note's words, as 7
   Cutler printed it, and a head whose callout is clear */
const unit = (id: string, at: [number, number], callout: [number, number]): DesignObject => ({
  id,
  type: "unit",
  systemId: null,
  floorId: "gf",
  geometry: { kind: "point", at: { x: at[0], y: at[1] } },
  plane: "room",
  props: { model: "PEA-M125HAA", widthMm: 1000, depthMm: 500, callout: { x: callout[0], y: callout[1] } },
});

function design(objects: DesignObject[]): DesignDocument {
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
        plans: [{ id: "s1", imageRef: "r", pageNumber: 1, name: "p", width: 1000, height: 700, x: 0, y: 0 }],
      },
    ],
    objects,
  };
}

const note = createNote({
  id: "n1",
  floorId: "gf",
  rect: { x: 700, y: 500, w: 100, h: 80 },
  leader: { x: 600, y: 200 },
  text: "Underfloor ducted for GF and study, location TBC",
  fontW: 13,
}) as NoteObject;

const boxOf = (d: DesignDocument, o: DesignObject, at: { x: number; y: number }) => {
  const floor = d.floors[0];
  const u = sheetUnitOf(d, floor)!;
  const lay = calloutLayout({
    at: o.geometry.kind === "point" ? o.geometry.at : { x: 0, y: 0 },
    footprint: paperFootprint(o, floor, u),
    offset: at,
    content: calloutContent(o, null),
    fontSize: CALLOUT_FONT_REF * u,
  });
  return lay.box;
};
const meets = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("callouts kept clear on paper", () => {
  test("a callout under a note's words moves off them, and no further than it has to", () => {
    const pea = unit("pea", [300, 300], [150, -100]);
    const d = design([pea, note]);
    expect(meets(boxOf(d, pea, { x: 150, y: -100 }), noteLayoutOf(note).box)).toBe(true);
    const at = clearCallouts(d, d.floors[0], sheetUnitOf(d, d.floors[0])!, null).get("pea")!;
    expect(meets(boxOf(d, pea, at), noteLayoutOf(note).box)).toBe(false);
    /* within a dozen lines of where it was put */
    expect(Math.hypot(at.x - 150, at.y + 100)).toBeLessThan(250);
  });

  test("a callout that is clear stays exactly where it was put", () => {
    const head = unit("head", [200, 600], [120, -60]);
    const d = design([head, note]);
    expect(clearCallouts(d, d.floors[0], sheetUnitOf(d, d.floors[0])!, null).get("head")).toEqual({ x: 120, y: -60 });
  });

  test("two callouts on one spot: the first keeps it, the second moves", () => {
    const a = unit("a", [300, 300], [150, -100]);
    const b = unit("b", [320, 330], [130, -130]);
    const d = design([a, b]);
    const got = clearCallouts(d, d.floors[0], sheetUnitOf(d, d.floors[0])!, null);
    expect(got.get("a")).toEqual({ x: 150, y: -100 });
    expect(meets(boxOf(d, a, got.get("a")!), boxOf(d, b, got.get("b")!))).toBe(false);
  });

  test("the one being dragged stays under the pointer, and the other goes round it", () => {
    const a = unit("a", [300, 300], [150, -100]);
    const b = unit("b", [320, 330], [500, 200]);
    const d = design([a, b]);
    const held = { id: "b", at: { x: 130, y: -130 } };
    const got = clearCallouts(d, d.floors[0], sheetUnitOf(d, d.floors[0])!, null, held);
    expect(got.get("b")).toEqual(held.at);
    expect(meets(boxOf(d, a, got.get("a")!), boxOf(d, b, held.at))).toBe(false);
  });

  test("a moved callout stays inside the figure", () => {
    const pea = unit("pea", [300, 300], [150, -100]);
    const d = design([pea, note]);
    const f = planFigureBounds(d, d.floors[0])!;
    const box = boxOf(d, pea, clearCallouts(d, d.floors[0], sheetUnitOf(d, d.floors[0])!, null).get("pea")!);
    expect(box.x).toBeGreaterThanOrEqual(f.x);
    expect(box.y).toBeGreaterThanOrEqual(f.y);
    expect(box.x + box.w).toBeLessThanOrEqual(f.x + f.w);
    expect(box.y + box.h).toBeLessThanOrEqual(f.y + f.h);
  });
});
