jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { parseOutline, toSheet } from "../reading-server";

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
