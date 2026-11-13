jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { parseOutline, readScale, siteSchema, toDimensions, toSheet, toSite } from "../reading-server";

describe("Tiff's read, back on the sheet", () => {
  it("reads an outline written as x,y pairs", () => {
    expect(parseOutline("10,20 30.5,40 -5,7")).toEqual([
      { x: 10, y: 20 },
      { x: 30.5, y: 40 },
      { x: -5, y: 7 },
    ]);
    expect(parseOutline("")).toEqual([]);
  });

  it("puts every point back in the sheet's own pixels: scaled up, moved by the crop's corner", () => {
    const r = toSheet(
      {
        plan_up_faces: "N",
        spaces: [{ name: "Bed 4", name_written_on_plan: true, kind: "room", polygon: "0,0 100,0 100,50 0,50", dimensions_written: "", existing_to_remain: false, open_to: "", stair: "" }],
        openings: [{ kind: "window", tag: "W1", x1: 10, y1: 0, x2: 30, y2: 0, width_mm: 900, room: "Bed 4", external: true, facing: "W" }],
        marks: [],
        checklist: [{ item: "fans", status: "looked_not_found", count: 0, note: "none" }, { item: "nonsense", status: "found", count: 1, note: "" }],
      },
      { furniture: [{ kind: "bed", room: "Bed 4", polygon: "10,10 20,10 20,20 10,20" }] },
      "s1",
      0.5,
      200,
      100,
    );
    expect(r.spaces[0].outline).toEqual([{ x: 200, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 200 }, { x: 200, y: 200 }]);
    expect(r.openings[0].a).toEqual({ x: 220, y: 100 });
    expect(r.furniture[0].outline[0]).toEqual({ x: 220, y: 120 });
    expect(r.checklist).toEqual([{ item: "fans", found: false, count: 0, note: "none" }]);
  });
});

describe("the site round the house, as she reads it", () => {
  const at = { floorId: "gf", sheetId: "s1", k: 2, left: 100, top: 50 };

  it("comes back in the sheet's own pixels, its street with a width, a neighbour with its storeys", () => {
    const site = toSite(
      {
        has_site_plan: true,
        boundary: "0,0 200,0 200,300 0,300",
        surfaces: [{ kind: "driveway", outline: "150,0 190,0 190,300 150,300", finish: "exposed aggregate" }, { kind: "moat", outline: "0,0 10,0 10,10", finish: "" }],
        street: [{ name: "Hope St", kerb: "0,320 200,320", width_mm: 0 }],
        neighbours: [{ outline: "-120,0 -10,0 -10,140 -120,140", storeys: 2, attached: true, note: "adjoining semi" }],
        fences: [{ line: "0,0 200,0", height_mm: 1800 }],
      },
      at,
    )!;
    expect(site.boundary[1]).toEqual({ x: 200, y: 50 });
    expect(site.surfaces.map((x) => x.kind)).toEqual(["driveway", "paving"]);
    expect(site.street).toEqual({ name: "Hope St", kerb: [{ x: 100, y: 210 }, { x: 200, y: 210 }], widthMm: 7000 });
    expect(site.neighbours[0]).toMatchObject({ storeys: 2, attached: true });
  });

  it("is nothing when the set has no site plan", () => {
    expect(toSite({ has_site_plan: false, boundary: "", surfaces: [], street: [], neighbours: [], fences: [] }, at)).toBeNull();
  });

  it("asks for no nullable field", () => {
    expect(JSON.stringify(siteSchema())).not.toMatch(/null/);
  });
});

describe("the dimensions printed on a sheet, as she reads them", () => {
  it("come back in the sheet's own pixels, six at most, none without a figure", () => {
    const raw = { dimensions: [{ mm: 7440, what: "along the bottom", x1: 406, y1: 400, x2: 558, y2: 400 }, { mm: 0, what: "unread", x1: 0, y1: 0, x2: 10, y2: 0 }] };
    expect(toDimensions(raw, 0.5, 100, 20)).toEqual([{ mm: 7440, what: "along the bottom", a: { x: 912, y: 820 }, b: { x: 1216, y: 820 } }]);
    expect(toDimensions({}, 1, 0, 0)).toEqual([]);
  });
});

describe("readScale", () => {
  it("reads a photo at 1568 across, and a drawing sheet at the full size", () => {
    /* 3465's photo, 4000 × 2252 */
    expect(Math.round(4000 * readScale(4000, 2252, true))).toBe(1568);
    expect(Math.round(4000 * readScale(4000, 2252))).toBe(2529);
  });
  it("keeps a square photo under its pixel cap", () => {
    const k = readScale(3000, 3000, true);
    expect(3000 * k * 3000 * k).toBeLessThanOrEqual(1.4e6 + 1);
  });
  it("never grows a small one", () => {
    expect(readScale(800, 600, true)).toBe(1);
    expect(readScale(800, 600)).toBe(1);
  });
});
