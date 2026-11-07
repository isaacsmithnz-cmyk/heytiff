import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { clearKeeping, clearList } from "../clear-design";
import { ductLines } from "../duct-materials";
import { calloutContent } from "../callouts";
import { indoorHeight } from "../scene3d";
import { isUnderFloor, planeOfWhere, underFloorFit, unitWhere } from "../unit-where";
import type { DataPack } from "../packs/schema";

const obj = (id: string, type: string, extra: Partial<DesignObject> = {}): DesignObject => ({
  id,
  type,
  systemId: "s1",
  floorId: "f",
  plane: "room",
  geometry: { kind: "point", at: { x: 0, y: 0 } },
  props: {},
  ...extra,
});

function design(): DesignDocument {
  const d = createDesign({ name: "t", mode: "plan" });
  return {
    ...d,
    floors: [{ id: "f", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: 0, northPos: null, plans: [] }],
    systems: [{ id: "s1", name: "System 1", type: "ducted", brand: "b", colour: "#000", settings: {} } as DesignDocument["systems"][number]],
    objects: [
      obj("r", "room", { systemId: null, geometry: { kind: "polygon", points: [] } }),
      obj("u", "unit", { props: { role: "idu", model: "PEA" } }),
      obj("d", "duct-run", { geometry: { kind: "polyline", points: [] } }),
    ],
  };
}

describe("Clear design", () => {
  test("says what comes off and what stays, in real counts", () => {
    const { off, stays } = clearList(design());
    expect(off).toEqual(["1 system and its 1 unit", "1 duct run"]);
    expect(stays).toEqual(["1 floor and its plans", "Scale and north", "1 room and its load"]);
  });

  test("keeps the version beside the cleared one, the cleared one under the design's own id", () => {
    const d = design();
    const { cleared, kept, roster } = clearKeeping(d, "kept", "2026-10-30T00:00:00.000Z");
    expect(cleared.id).toBe(d.id);
    expect(cleared.objects.map((o) => o.id)).toEqual(["r"]);
    expect(cleared.systems).toEqual([]);
    expect(kept.id).toBe("kept");
    expect(kept.objects).toHaveLength(3);
    expect(roster).toEqual([
      { id: "kept", label: "Option 1" },
      { id: d.id, label: "Option 2" },
    ]);
    expect(cleared.meta.variantLabel).toBe("Option 2");
  });
});

describe("a unit under the floor", () => {
  const under = obj("u", "unit", { plane: planeOfWhere("under-floor"), props: { role: "idu", model: "PEA", widthMm: 1405, depthMm: 900 } });

  test("where it sits is its plane, or its kind where nobody has said", () => {
    expect(unitWhere(under, "ducted")).toBe("under-floor");
    expect(unitWhere(obj("a", "unit"), "ducted")).toBe("ceiling");
    expect(unitWhere(obj("a", "unit"), "wall")).toBe("room");
    expect(isUnderFloor(under)).toBe(true);
  });

  test("its callout says so", () => {
    expect(calloutContent(under, null).lines).toContain("Under floor");
    expect(calloutContent(obj("a", "unit"), null).lines).not.toContain("Under floor");
  });

  test("it needs its height and its hangers", () => {
    expect(underFloorFit(380, 600)).toEqual({ needMm: 450, fits: true });
    expect(underFloorFit(380, 400).fits).toBe(false);
  });

  test("a hatch goes on the job, one a unit", () => {
    const d = design();
    const pack = { indoor_units: [] } as unknown as DataPack;
    const off = ductLines({ ...d, objects: [obj("u", "unit")] }, pack, d.systems[0]);
    expect(off.some((l) => l.name.includes("hatch"))).toBe(false);
    const on = ductLines({ ...d, objects: [under] }, pack, d.systems[0]);
    expect(on.find((l) => l.name === "Floor access hatch 600 × 600")?.qty).toBe("1");
  });
});

describe("3D: a unit sits where its own kind sits", () => {
  const y = (form: string, under = false) => indoorHeight(form, under, 3, 2.7, 0.3);
  test("each kind", () => {
    expect(y("ducted")).toBeCloseTo(5.72);
    expect(y("bulkhead")).toBeCloseTo(5.72);
    expect(y("wall")).toBeCloseTo(3 + 2.1 - 0.3);
    expect(y("cassette-4way")).toBeCloseTo(5.7);
    expect(y("floor-console")).toBe(3);
    expect(y("under-ceiling")).toBeCloseTo(5.4);
    expect(y("ducted", true)).toBeCloseTo(3 - 0.32);
  });
  test("a wall head under a low ceiling keeps 150 clear of it", () => {
    expect(indoorHeight("wall", false, 0, 2.1, 0.3)).toBeCloseTo(2.1 - 0.15 - 0.3);
  });
});
