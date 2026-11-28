import { createDesign, type DesignDocument, type DesignObject, type Floor, type PlanSheet } from "../document";
import { addBuilding, addFloorTo, apartOn, keepApart, buildingsOf, floorWord, levelWords, makeBuilding, moveZones, nameForApart, tidyBuildings } from "../buildings";
import { floorBasesM } from "../graph";
import { foundOn } from "../room-edit";

/* THE JOB'S BUILDINGS IN THE DESIGN (join 2; the mock
   https://claude.ai/artifact/6xDKm8xV6f2PGZJKVo6M46). Shapes as 3570's
   Level 1 has them: a suite of five zones drawn 7 m clear of the house's
   bedrooms, over the garage the ground floor's sheet names. */

const sheet = (id: string, ref: string): PlanSheet => ({ id, imageRef: ref, pageNumber: null, name: id, width: 2400, height: 1700, x: 0, y: 0 });
const rect = (id: string, floorId: string, name: string, x0: number, y0: number, x1: number, y1: number, props: Record<string, unknown> = {}): DesignObject => ({
  id,
  type: "room",
  systemId: null,
  floorId,
  plane: "room",
  geometry: { kind: "polygon", points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] },
  props: { name, ...props },
});

function design(): DesignDocument {
  const d = createDesign({ name: "t", mode: "plan" });
  const floor = (id: string, name: string, level: number, s: PlanSheet, heightM?: number): Floor => ({
    id,
    name,
    level,
    scaleMmPerUnit: 35,
    northDeg: 0,
    northPos: null,
    plans: [s],
    ...(heightM ? { heightM } : {}),
  });
  return {
    ...d,
    floors: [floor("gf", "Ground floor", 0, sheet("s-gf", "gf.png"), 3.7), floor("l1", "Level 1", 1, sheet("s-l1", "l1.png"), 3)],
    objects: [
      rect("b8", "l1", "BED 8", 576, 204, 746, 324),
      rect("b8e", "l1", "Bed 8 ensuite", 642, 328, 746, 409),
      rect("b8h", "l1", "Bed 8 hall", 576, 414, 715, 494),
      rect("b8c", "l1", "Bed 8 cupboard", 718, 414, 746, 494),
      rect("b8s", "l1", "Bed 8 stair landing", 650, 499, 746, 550),
      rect("b4", "l1", "BED 4", 999, 727, 1162, 827),
      rect("b5", "l1", "BED 5", 999, 831, 1162, 943),
      rect("b1", "l1", "BED 1", 1166, 727, 1543, 858),
      rect("hall", "gf", "Grand Hall", 900, 700, 1500, 1000),
      { id: "u1", type: "unit", systemId: "sys1", floorId: "l1", plane: "room", geometry: { kind: "point", at: { x: 600, y: 230 } }, props: { roomId: "b8", model: "P20" } },
      { id: "g1", type: "grille", systemId: null, floorId: "l1", plane: "room", geometry: { kind: "point", at: { x: 700, y: 450 } }, props: {} },
      { id: "u4", type: "unit", systemId: "sys1", floorId: "l1", plane: "room", geometry: { kind: "point", at: { x: 1050, y: 760 } }, props: { roomId: "b4", model: "P25" } },
    ],
    reading: {
      at: "2026-11-20T00:00:00Z",
      model: "m",
      failed: [],
      floors: {
        gf: [{ sheetId: "s-gf", spaces: [{ name: "GARAGE", named: true, kind: "garage", outline: [{ x: 540, y: 180 }, { x: 780, y: 180 }, { x: 780, y: 580 }, { x: 540, y: 580 }], written: "", existing: false, openTo: "", stair: "" }], openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "" }],
        l1: [{ sheetId: "s-l1", spaces: [{ name: "BED 8", named: true, kind: "bedroom", outline: [{ x: 576, y: 204 }, { x: 746, y: 204 }, { x: 746, y: 324 }, { x: 576, y: 324 }], written: "", existing: false, openTo: "", stair: "" }], openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "" }],
      },
    } as unknown as DesignDocument["reading"],
  };
}

describe("what Tiff finds", () => {
  it("finds the suite standing 7 m clear of the rest of Level 1, over the garage", () => {
    const [find, ...more] = apartOn(design());
    expect(more).toEqual([]);
    expect(find.floorId).toBe("l1");
    expect(find.names).toEqual(["BED 8", "Bed 8 hall", "Bed 8 ensuite", "Bed 8 stair landing", "Bed 8 cupboard"]);
    expect(find.apartM).toBeGreaterThan(7);
    expect(find.under).toBe("Garage");
    expect(nameForApart(find)).toBe("Over the garage");
  });

  it("doesn't ask again of a part kept where it is", () => {
    const d = design();
    expect(apartOn(keepApart(d, apartOn(d)[0].zoneIds))).toEqual([]);
  });

  it("finds nothing where every zone touches the next", () => {
    const d = design();
    expect(apartOn({ ...d, objects: d.objects.filter((o) => !o.id.startsWith("b8")) })).toEqual([]);
  });
});

describe("making it a building", () => {
  const made = () => {
    const d = design();
    const find = apartOn(d)[0];
    return makeBuilding(d, "Guest wing", find.zoneIds, find.under)!;
  };

  it("moves its zones, their units and what's inside them, and leaves the rest", () => {
    const { doc, floorId } = made();
    const on = (id: string) => doc.objects.find((o) => o.id === id)!.floorId;
    expect(["b8", "b8e", "b8h", "b8c", "b8s", "u1", "g1"].map(on)).toEqual(Array(7).fill(floorId));
    expect(["b4", "b5", "b1", "u4"].map(on)).toEqual(Array(4).fill("l1"));
  });

  it("draws them where they stood, on Level 1's sheet cut down to them", () => {
    const { doc, floorId } = made();
    const f = doc.floors.find((x) => x.id === floorId)!;
    expect(f.buildingId).toBeTruthy();
    expect(f.plans).toHaveLength(1);
    expect(f.plans[0]).toMatchObject({ imageRef: "l1.png", x: 0, y: 0 });
    const pad = 2000 / 35;
    expect(f.plans[0].crop!.x).toBeCloseTo(576 - pad);
    expect(f.plans[0].crop!.w).toBeCloseTo(746 - 576 + 2 * pad);
    const bed8 = doc.objects.find((o) => o.id === "b8")!;
    expect(bed8.geometry).toEqual(design().objects.find((o) => o.id === "b8")!.geometry);
    expect(f.scaleMmPerUnit).toBe(35);
  });

  it("stands where Level 1 stood against the house until it's set, the garage under it", () => {
    const { doc, id } = made();
    expect(doc.buildings).toEqual([{ id, name: "Guest wing", floorMm: 3700, under: "Garage" }]);
    expect(levelWords(3700)).toBe("3.7 m up");
    expect(levelWords(-900)).toBe("0.9 m down");
    expect(levelWords(null)).toBe("Level with the house");
  });

  it("stays the zones she read: Level 1 doesn't offer them again", () => {
    const d = design();
    const kept = { ...d, objects: d.objects.map((o) => (o.id === "b8" ? { ...o, props: { ...o.props, fromReading: true, readKey: "s-l1:0" } } : o)) };
    expect(foundOn(kept, "l1")).toEqual([]);
    const { doc } = makeBuilding(kept, "Guest wing", apartOn(kept)[0].zoneIds)!;
    expect(foundOn(doc, "l1")).toEqual([]);
  });

  it("is listed after the house, and the floor button says which", () => {
    const { doc, id, floorId } = made();
    const list = buildingsOf(doc);
    expect(list.map((b) => [b.name, b.floors.length, b.zones.length])).toEqual([
      ["House", 2, 4],
      ["Guest wing", 1, 5],
    ]);
    expect(list[1].id).toBe(id);
    expect(floorWord(doc, doc.floors.find((f) => f.id === "gf")!)).toBe("House, GF");
    expect(floorWord(doc, doc.floors.find((f) => f.id === floorId)!)).toBe("Guest wing");
    expect(floorWord(design(), design().floors[0])).toBe("GF");
  });
});

describe("its height", () => {
  it("stacks on its own, its ground floor where it's set against the house's", () => {
    const { doc, id, floorId } = (() => {
      const d = design();
      return makeBuilding(d, "Guest wing", apartOn(d)[0].zoneIds)!;
    })();
    const at = floorBasesM(doc.floors, [{ id, floorMm: 2530 }]);
    expect(at.get("gf")).toBe(0);
    expect(at.get("l1")).toBe(3.7);
    expect(at.get(floorId)).toBeCloseTo(2.53);
    /* a second floor of it sits on its first */
    const two = addFloorTo(doc, id);
    const up = floorBasesM(two.doc.floors, [{ id, floorMm: 2530 }]);
    expect(up.get(two.floorId)).toBeCloseTo(2.53 + 3);
    /* the house's levels don't take its floors' heights */
    const tall = { ...two.doc, floors: two.doc.floors.map((f) => (f.id === floorId ? { ...f, heightM: 9 } : f)) };
    expect(floorBasesM(tall.floors, [{ id, floorMm: 0 }]).get("l1")).toBe(3.7);
  });

  it("sits level with the house when nothing says where", () => {
    const { doc, floorId } = addBuilding(design(), "Cabana");
    expect(floorBasesM(doc.floors, doc.buildings).get(floorId)).toBe(0);
    expect(doc.floors.find((f) => f.id === floorId)).toMatchObject({ name: "Cabana", level: 0, scaleMmPerUnit: 35, plans: [] });
  });
});

describe("moving zones between buildings", () => {
  it("moves zones onto a floor already carrying their sheet, widening its cut", () => {
    const d = design();
    const { doc, floorId } = makeBuilding(d, "Guest wing", ["b8"])!;
    const before = doc.floors.find((f) => f.id === floorId)!.plans[0].crop!;
    const next = moveZones(doc, ["b8s"], floorId)!;
    const after = next.floors.find((f) => f.id === floorId)!.plans;
    expect(after).toHaveLength(1);
    expect(after[0].crop!.y + after[0].crop!.h).toBeGreaterThan(before.y + before.h);
  });

  it("puts a sheet the floor hasn't beside its own, and the zones with it", () => {
    const d = design();
    const { doc, floorId } = addBuilding(d, "Cabana");
    const withSheet = { ...doc, floors: doc.floors.map((f) => (f.id === floorId ? { ...f, plans: [sheet("s-c", "c.png")] } : f)) };
    const next = moveZones(withSheet, ["b4"], floorId)!;
    const f = next.floors.find((x) => x.id === floorId)!;
    expect(f.plans.map((s) => s.imageRef)).toEqual(["c.png", "l1.png"]);
    const moved = next.objects.find((o) => o.id === "b4")!;
    expect(moved.geometry.kind === "polygon" && moved.geometry.points[0].x).toBe(999 + 2400 + 200);
  });

  it("won't move zones of two floors at once, or onto their own floor", () => {
    const d = design();
    expect(moveZones(d, ["b8", "hall"], "gf")).toBeNull();
    expect(moveZones(d, ["b8"], "l1")).toBeNull();
  });

  it("drops a building once its floors are gone", () => {
    const { doc, floorId } = addBuilding(design(), "Cabana");
    const gone = tidyBuildings({ ...doc, floors: doc.floors.filter((f) => f.id !== floorId) });
    expect(gone.buildings).toBeUndefined();
  });
});
