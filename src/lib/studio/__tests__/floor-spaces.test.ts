import { createDesign, type DesignDocument, type Floor, type Point } from "../document";
import type { PlanReading, SheetReading } from "../reading";
import {
  addSpace,
  areaM2,
  canAdd,
  fitWords,
  floorOutline,
  outlineOf,
  patchSpace,
  removeSpace,
  spaceOf,
  standsOver,
  traceOutline,
} from "../floor-spaces";

/* UNDER THE HOUSE AND IN THE ROOF (floor-spaces.ts): a subfloor off the
   lowest floor and a roof space off the top one, each following its floor's
   outline until drawn by hand, with a fit check for what goes in it. */

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const floor = (id: string, level: number): Floor => ({
  id,
  name: level === 0 ? "Ground floor" : `Level ${level}`,
  level,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  plans: [{ id: `sht_${id}`, x: 100, y: 50, width: 2000, height: 1400, imageRef: "org/o/p.png", name: "Page 1" } as Floor["plans"][number]],
});

const sheet = (id: string, spaces: SheetReading["spaces"]): SheetReading => ({
  sheetId: id,
  spaces,
  openings: [],
  marks: [],
  furniture: [],
  flags: [],
  checklist: [],
  planUp: "N",
} as unknown as SheetReading);

const space = (name: string, kind: SheetReading["spaces"][number]["kind"], outline: Point[]) => ({ name, named: true, kind, outline, written: "", existing: false, openTo: "", stair: "" });

function design(): DesignDocument {
  const d = createDesign({ name: "7 Cutler Rd", mode: "residential" as never });
  /* two rooms with a 200 mm wall between them (20 units at 10 mm), a balcony off one, a garage and a garden */
  const reading: PlanReading = {
    at: "2026-11-15T00:00:00Z",
    model: "test",
    floors: {
      gf: [
        sheet("sht_gf", [
          space("Living", "room", rect(0, 0, 500, 400)),
          space("Bed 1", "room", rect(520, 0, 400, 400)),
          space("Balcony", "outdoor", rect(0, 400, 300, 200)),
          space("Garage", "garage", rect(940, 0, 400, 400)),
          space("Garden", "outdoor", rect(0, 700, 900, 300)),
        ]),
      ],
    },
    failed: [],
  };
  return { ...d, floors: [floor("gf", 0), floor("l1", 1)], reading };
}

describe("what stands over a subfloor", () => {
  it("is the rooms and a balcony or deck, not the garden, the garage or a stair", () => {
    expect(standsOver({ kind: "room", name: "Living" })).toBe(true);
    expect(standsOver({ kind: "outdoor", name: "Lower Balcony" })).toBe(true);
    expect(standsOver({ kind: "outdoor", name: "Timber deck" })).toBe(true);
    expect(standsOver({ kind: "outdoor", name: "Pool terrace" })).toBe(false);
    expect(standsOver({ kind: "garage", name: "Garage" })).toBe(false);
    expect(standsOver({ kind: "stair", name: "Stair 06" })).toBe(false);
  });
});

describe("the floor's outline", () => {
  it("is one outline round rooms with a wall between them", () => {
    const out = traceOutline([rect(0, 0, 500, 400), rect(520, 0, 400, 400)], 10)!;
    expect(out).not.toBeNull();
    /* the wall is closed over: one rectangle about 920 by 400 */
    const a = areaM2(out, 10)!;
    expect(a).toBeGreaterThan(35);
    expect(a).toBeLessThan(38.5);
    expect(out.length).toBeLessThanOrEqual(6);
  });

  it("keeps an L its shape", () => {
    const out = traceOutline([rect(0, 0, 600, 300), rect(0, 300, 300, 300)], 10)!;
    expect(out.length).toBeGreaterThanOrEqual(6);
    expect(out.length).toBeLessThanOrEqual(8);
    expect(areaM2(out, 10)!).toBeCloseTo(27, 0);
  });

  it("follows Tiff's rooms on the floor, the balcony in and the garage and garden out, at the sheet's place", () => {
    const d = design();
    const out = floorOutline(d, d.floors[0])!;
    const xs = out.map((p) => p.x);
    const ys = out.map((p) => p.y);
    /* the sheet sits at (100, 50) */
    expect(Math.min(...xs)).toBeCloseTo(100, -1);
    expect(Math.max(...xs)).toBeLessThan(100 + 940);
    expect(Math.max(...ys)).toBeCloseTo(50 + 600, -1);
  });

  it("follows the rooms drawn when nothing was read", () => {
    const d = { ...design(), reading: null, objects: [{ id: "r1", type: "room", floorId: "gf", systemId: null, plane: "room", geometry: { kind: "polygon", points: rect(0, 0, 300, 300) }, props: {} }] } as unknown as DesignDocument;
    expect(areaM2(floorOutline(d, d.floors[0])!, 10)!).toBeCloseTo(9, 0);
  });
});

describe("adding one", () => {
  it("puts the subfloor under the lowest floor and the roof space over the top, once each", () => {
    let d = design();
    expect(canAdd(d, "under")).toBe(true);
    d = addSpace(d, "under");
    expect(spaceOf(d, "under")?.floor.id).toBe("gf");
    expect(canAdd(d, "under")).toBe(false);
    d = addSpace(d, "over");
    expect(spaceOf(d, "over")?.floor.id).toBe("l1");
    expect(d.floors[0].under).toEqual({ heightMm: null, outline: null, from: "hand" });
  });

  it("offers no roof space where Tiff read the roof", () => {
    const d = design();
    d.reading = { ...d.reading!, roof: { levels: [], parts: [{} as never], raked: [], material: "", roofSpace: "" } };
    expect(canAdd(d, "over")).toBe(false);
    expect(canAdd(d, "under")).toBe(true);
  });

  it("takes a height, an outline by hand and back to the floor's, and goes", () => {
    let d = addSpace(design(), "under");
    d = patchSpace(d, "under", { heightMm: 1400 });
    expect(d.floors[0].under?.heightMm).toBe(1400);
    const hand = rect(0, 0, 100, 100);
    d = patchSpace(d, "under", { outline: hand });
    expect(outlineOf(d, d.floors[0], d.floors[0].under!)).toBe(hand);
    d = patchSpace(d, "under", { outline: null });
    expect(outlineOf(d, d.floors[0], d.floors[0].under!)!.length).toBeGreaterThan(3);
    d = removeSpace(d, "under");
    expect(d.floors[0].under).toBeUndefined();
  });
});

describe("what fits in it", () => {
  it("says an outdoor unit's height against the subfloor's, in the mock's words", () => {
    expect(fitWords("under", 981, 1400)).toEqual({ text: "Fits, 981 mm tall in 1400 mm", good: true });
    expect(fitWords("under", 981, 900)).toEqual({ text: "Needs 981 mm, the subfloor is 900", good: false });
  });

  it("counts an indoor unit's hangers", () => {
    expect(fitWords("under", 380, 400, 70)).toEqual({ text: "Needs 450 mm, the subfloor is 400", good: false });
    expect(fitWords("over", 380, 900, 70).good).toBe(true);
  });

  it("says so when the height isn't set", () => {
    expect(fitWords("under", 981, null)).toEqual({ text: "The subfloor's height isn't set", good: null });
  });
});
