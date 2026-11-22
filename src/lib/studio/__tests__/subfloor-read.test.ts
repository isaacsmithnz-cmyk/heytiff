jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { roofSchema, toRoof } from "../reading-server";
import { createDesign, type DesignDocument, type Floor } from "../document";
import type { ReadSubfloor } from "../reading";
import { mentionWords, subfloorFromReading } from "../floor-spaces";
import { designFromPlan, subfloorLine, type JobPlan } from "@/lib/jobs/plans";

/* THE SUBFLOOR OFF THE SET (Isaac, 15 November 2026; the mock
   https://claude.ai/artifact/B2Cr5YiUkZG7eSrsLd8Uum): read with the roof,
   said on the job's plan, and under the lowest floor of a design opened from it. */

const plans = [
  { floorId: "gf", floor: "Ground floor", sheetId: "s-gf", k: 0.5, left: 100, top: 40 },
  { floorId: "l1", floor: "Level 1", sheetId: "s-l1", k: 0.5, left: 0, top: 0 },
];
const raw = (subfloor: Record<string, unknown>) => ({ levels: [], roof_parts: [], raked: [], material: "", roof_space: "", subfloor });

describe("her read of it", () => {
  it("is asked for with the roof", () => {
    const schema = roofSchema(["Ground floor", "Level 1"]) as { properties: Record<string, { properties: Record<string, unknown> }> };
    expect(Object.keys(schema.properties.subfloor.properties)).toEqual(["shown", "floor", "outline", "rooms", "height_mm", "height_from", "sheet", "words"]);
  });

  it("sets a drawn one out on the floor it is under, in that sheet's pixels", () => {
    const r = toRoof(raw({ shown: "drawn", floor: "Ground floor", outline: "0,0 200,0 200,100 0,100", rooms: "the kitchen, laundry and sitting rooms", height_mm: 200, height_from: "measured off section 1 on A401", sheet: "A401", words: "SUBFLOOR SPACE FOR AC INSULATED FLEX DUCT" }), plans);
    expect(r.subfloor).toMatchObject({ shown: "drawn", floorId: "gf", sheetId: "s-gf", heightMm: 200, sheet: "A401" });
    /* scaled up by 1/0.5 and moved by the crop's corner */
    expect(r.subfloor!.outline[2]).toEqual({ x: 500, y: 240 });
  });

  it("keeps one only named as named, with no shape and no rooms", () => {
    const r = toRoof(raw({ shown: "mentioned", floor: "Ground floor", outline: "", rooms: "", height_mm: 0, height_from: "", sheet: "A200", words: "Subfloor fan ventilation system to front part of house" }), plans);
    expect(r.subfloor).toMatchObject({ shown: "mentioned", outline: [], rooms: "", heightMm: 0, sheet: "A200" });
  });

  it("calls one drawn with no shape to set out named, and keeps no height it can't believe", () => {
    const r = toRoof(raw({ shown: "drawn", floor: "Level 1", outline: "1,1", rooms: "x", height_mm: 40, height_from: "a guess", sheet: "", words: "subfloor" }), plans);
    expect(r.subfloor).toMatchObject({ shown: "mentioned", heightMm: 0, heightFrom: "" });
  });

  it("has none where the set shows none", () => {
    expect(toRoof(raw({ shown: "none", floor: "Ground floor", outline: "", rooms: "", height_mm: 0, height_from: "", sheet: "", words: "" }), plans).subfloor).toBeUndefined();
    expect(toRoof({ levels: [], roof_parts: [], raked: [], material: "", roof_space: "" }, plans).subfloor).toBeUndefined();
  });
});

const drawn: ReadSubfloor = {
  shown: "drawn",
  floorId: "p4",
  sheetId: "",
  outline: [
    { x: 10, y: 10 },
    { x: 60, y: 10 },
    { x: 60, y: 40 },
    { x: 10, y: 40 },
  ],
  rooms: "the kitchen, laundry, hall and sitting rooms",
  heightMm: 200,
  heightFrom: "measured off section 1 on A401",
  sheet: "A401",
  words: "SUBFLOOR SPACE FOR AC INSULATED FLEX DUCT",
};

const plan = (subfloor?: ReadSubfloor): JobPlan => ({
  id: "plan1",
  jobUuid: "job1",
  documentId: "d1",
  attachmentId: null,
  name: "2507 Issue E.pdf",
  sourceRef: "org/o/plan.pdf",
  sourceKind: "pdf",
  pageCount: 11,
  pages: [{ n: 4, kind: "floor", name: "Ground floor", level: 0, ref: "org/o/p4.png", preview: null, width: 2400, height: 1695, mmPerPx: 35, scale: "1:100" } as JobPlan["pages"][number]],
  reading: { at: "2026-11-12T03:47:01Z", model: "m", floors: { p4: [] }, failed: [], roof: { levels: [], parts: [], raked: [], material: "", roofSpace: "", ...(subfloor ? { subfloor } : {}) } },
  state: "read",
  said: null,
  addedBy: null,
  addedAt: "2026-11-12T00:00:00Z",
  readAt: "2026-11-12T03:47:01Z",
});

describe("the job's line on it", () => {
  it("says where it runs and how high, about when measured", () => {
    expect(subfloorLine(plan(drawn))).toBe("Subfloor under the kitchen, laundry, hall and sitting rooms, about 200 mm, measured off section 1 on A401");
  });
  it("says who set its height, and in which design, once typed", () => {
    const set = { ...drawn, set: { heightMm: 300, by: "Isaac", design: "14 Nostrud Avenue", at: "2026-11-15T01:00:00Z" } };
    expect(subfloorLine(plan(set))).toBe("Subfloor under the kitchen, laundry, hall and sitting rooms, 300 mm, set by Isaac in 14 Nostrud Avenue on Sun 15 Nov");
  });
  it("says where the set only names one", () => {
    const named: ReadSubfloor = { ...drawn, shown: "mentioned", outline: [], rooms: "", heightMm: 0, heightFrom: "", sheet: "A200", words: "Subfloor fan ventilation system to front part of house." };
    expect(subfloorLine(plan(named))).toBe("A200 says “Subfloor fan ventilation system to front part of house”, but no plan draws a subfloor");
  });
  it("says its height isn't there when it isn't", () => {
    expect(subfloorLine(plan({ ...drawn, heightMm: 0, heightFrom: "" }))).toBe("Subfloor under the kitchen, laundry, hall and sitting rooms. Its height isn't on the plans");
  });
  it("keeps to her first note, and a short list of rooms, however long she wrote them", () => {
    const named: ReadSubfloor = { ...drawn, shown: "mentioned", outline: [], rooms: "", heightMm: 0, heightFrom: "", sheet: "A200", words: "SUBFLOOR FAN VENTILATION SYSTEM TO FRONT PART OF HOUSE; GFLOOR FAN COIL UNIT UNDER SLAB" };
    expect(subfloorLine(plan(named))).toBe("A200 says “SUBFLOOR FAN VENTILATION SYSTEM TO FRONT PART OF HOUSE”, but no plan draws a subfloor");
    expect(subfloorLine(plan({ ...drawn, rooms: "Under the kitchen and pantry (the timber-floored part; the new slab excluded)" }))).toMatch(/^Subfloor under the kitchen and pantry, about 200 mm/);
  });
  it("says nothing where there is none", () => {
    expect(subfloorLine(plan())).toBeNull();
  });
});

describe("a design opened from the job", () => {
  const open = (p: JobPlan): DesignDocument => {
    const made = designFromPlan(p);
    return subfloorFromReading({ ...createDesign({ name: "14 Nostrud Avenue", mode: "plan" }), floors: made.floors, reading: made.reading });
  };

  it("has it under the ground floor, from the plans, set out where she drew it", () => {
    const d = open(plan(drawn));
    const gf: Floor = d.floors[0];
    const sheet = gf.plans[0];
    expect(gf.under).toMatchObject({ heightMm: 200, outline: null, from: "plans", said: "measured off section 1 on A401" });
    expect(gf.under!.planOutline![0]).toEqual({ x: sheet.x + 10, y: sheet.y + 10 });
  });

  it("starts at the height typed in a design since", () => {
    const d = open(plan({ ...drawn, set: { heightMm: 300, by: "Isaac", design: "x", at: "2026-11-15T01:00:00Z" } }));
    expect(d.floors[0].under).toMatchObject({ heightMm: 300 });
    expect(d.floors[0].under!.said).toBeUndefined();
  });

  it("leaves one added by hand as it is", () => {
    const d = open(plan(drawn));
    const hand = { ...d, floors: d.floors.map((f) => ({ ...f, under: { heightMm: 900, outline: null, from: "hand" as const } })) };
    expect(subfloorFromReading(hand).floors[0].under).toEqual({ heightMm: 900, outline: null, from: "hand" });
  });

  it("only offers one the plans name, in the floor menu's words", () => {
    const d = open(plan({ ...drawn, shown: "mentioned", outline: [], sheet: "A200" }));
    expect(d.floors[0].under).toBeUndefined();
    expect(mentionWords(d)).toBe("The plans mention a subfloor, on A200");
  });
});
