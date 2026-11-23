jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import {
  facingOf,
  FLOOR_SCHEMA,
  floorPrompt,
  openingAsPrinted,
  pagesOnly,
  parseOutline,
  readScale,
  roofSchema,
  siteSchema,
  sitePages,
  toDimensions,
  toRoof,
  toSheet,
  toSite,
  wordsShown,
} from "../reading-server";
import type { ReadSpace } from "../reading";

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
        street: [{ name: "Rumour St", kerb: "0,320 200,320", width_mm: 0 }],
        neighbours: [{ outline: "-120,0 -10,0 -10,140 -120,140", storeys: 2, attached: true, note: "adjoining semi" }],
        fences: [{ line: "0,0 200,0", height_mm: 1800 }],
      },
      at,
    )!;
    expect(site.boundary[1]).toEqual({ x: 200, y: 50 });
    expect(site.surfaces.map((x) => x.kind)).toEqual(["driveway", "paving"]);
    /* no width written: none, not a 7 m road nobody drew */
    expect(site.street).toEqual({ name: "Rumour St", kerb: [{ x: 100, y: 210 }, { x: 200, y: 210 }], widthMm: 0 });
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

/* REMOVE GUESSING WHEREVER POSSIBLE (Isaac): better to leave out than give
   wrong information. Each read below keeps only what the set writes or
   prints, and leaves the rest out. Made-up plans throughout. */

const box = (x: number, y: number, w: number, h: number) => `${x},${y} ${x + w},${y} ${x + w},${y + h} ${x},${y + h}`;
const space = (name: string, polygon: string, written = "") => ({ name, name_written_on_plan: true, kind: "room", polygon, dimensions_written: written, existing_to_remain: false, open_to: "", stair: "" });
const opening = (o: Record<string, unknown>) => ({ kind: "window", tag: "", x1: 0, y1: 0, x2: 0, y2: 0, width_mm: 0, room: "", external: true, ...o });
const floor = (o: Record<string, unknown>) => ({ plan_up_faces: "N", spaces: [], openings: [], marks: [], checklist: [], ...o });

describe("which way an outside opening faces", () => {
  const bed: ReadSpace = { name: "Bed 4", named: true, kind: "room", outline: parseOutline(box(0, 0, 100, 50)), written: "", existing: false, openTo: "", stair: "" };
  const top = { a: { x: 10, y: 0 }, b: { x: 30, y: 0 }, room: "Bed 4" };
  const bottom = { a: { x: 10, y: 50 }, b: { x: 30, y: 50 }, room: "Bed 4" };

  it("is the way out through the wall it is on, against plan-up, never her word for it", () => {
    const r = toSheet(
      floor({
        spaces: [space("Bed 4", box(0, 0, 100, 50))],
        openings: [
          { ...opening({ x1: 10, y1: 0, x2: 30, y2: 0, room: "Bed 4" }), facing: "W" },
          opening({ x1: 100, y1: 10, x2: 100, y2: 40, room: "Bed 4" }),
          opening({ kind: "skylight", x1: 40, y1: 20, x2: 60, y2: 20, room: "Bed 4" }),
          opening({ kind: "door", x1: 10, y1: 50, x2: 30, y2: 50, room: "Bed 4", external: false }),
        ],
      }),
      { furniture: [] },
      "s1",
      1,
      0,
      0,
    );
    expect(r.openings.map((o) => o.facing)).toEqual(["N", "E", "", ""]);
  });

  it("turns with plan-up, whichever way the room's outline winds", () => {
    expect(facingOf(top, [bed], "E")).toBe("E");
    expect(facingOf(bottom, [bed], "E")).toBe("W");
    expect(facingOf(bottom, [{ ...bed, outline: [...bed.outline].reverse() }], "N")).toBe("S");
  });

  it("is nothing when the plan doesn't say which way is up, or the opening is on no wall of its room", () => {
    expect(facingOf(top, [bed], "")).toBe("");
    expect(facingOf({ ...top, room: "Bed 5" }, [bed], "N")).toBe("");
    expect(facingOf({ a: { x: 300, y: 0 }, b: { x: 320, y: 0 }, room: "Bed 4" }, [bed], "N")).toBe("");
  });

  it("isn't asked of her any more, and nor is a width she would scale", () => {
    const props = (FLOOR_SCHEMA as { properties: { openings: { items: { properties: Record<string, { description?: string }> } } } }).properties.openings.items.properties;
    expect(props.facing).toBeUndefined();
    expect(props.width_mm.description).not.toMatch(/scale/);
  });
});

describe("what the plan prints, decided by its own words", () => {
  const words = [
    { text: "BED 4", at: { x: 50, y: 20 } },
    { text: "3.6 x 3.2", at: { x: 50, y: 35 } },
    { text: "KITCHEN", at: { x: 250, y: 20 } },
    { text: "W1", at: { x: 20, y: -8 } },
    { text: "GD.02", at: { x: 300, y: 25 } },
  ];
  const raw = floor({
    spaces: [space("Bed 4", box(0, 0, 100, 50), "3.6 x 3.2"), space("Linen", box(100, 0, 100, 50), "1.2 x 0.6"), space("Kitchen", box(200, 0, 100, 50), "4.1 x 2.7")],
    openings: [
      opening({ tag: "W1", x1: 10, y1: 0, x2: 30, y2: 0, width_mm: 900, room: "Bed 4" }),
      opening({ tag: "W7", x1: 210, y1: 0, x2: 240, y2: 0, width_mm: 1200, room: "Kitchen" }),
      opening({ kind: "door", tag: "GD.02 D.05", x1: 300, y1: 10, x2: 300, y2: 40, width_mm: 820, room: "Kitchen" }),
    ],
  });

  it("names a space only where its name is printed in it, and keeps a size only where that is printed in it", () => {
    const r = toSheet(raw, { furniture: [] }, "s1", 1, 0, 0, words, 20);
    expect(r.spaces.map((x) => [x.name, x.named, x.written])).toEqual([
      ["Bed 4", true, "3.6 x 3.2"],
      ["", false, ""],
      ["Kitchen", true, ""],
    ]);
  });

  it("takes the one room label printed in a space she named otherwise, and what she put in it goes with it", () => {
    const r = toSheet(
      floor({
        spaces: [space("Bedroom 4", box(0, 0, 100, 50)), space("Kitchen", box(200, 0, 100, 50))],
        openings: [opening({ x1: 10, y1: 0, x2: 30, y2: 0, room: "Bedroom 4" })],
        marks: [{ item: "fan", text: "fan", room: "Bedroom 4", polygon: "50,25" }],
      }),
      { furniture: [{ kind: "bed", room: "Bedroom 4", polygon: box(10, 10, 20, 30) }] },
      "s1",
      1,
      0,
      0,
      words,
      20,
    );
    expect(r.spaces.map((x) => [x.name, x.named])).toEqual([
      ["BED 4", true],
      ["Kitchen", true],
    ]);
    expect([r.openings[0].room, r.marks[0].room, r.furniture[0].room]).toEqual(["BED 4", "BED 4", "BED 4"]);
    /* its facing still found off the room she drew it on */
    expect(r.openings[0].facing).toBe("N");
  });

  it("keeps the parts of a mark printed beside the opening, and a width only where a figure beside it gives it", () => {
    const r = toSheet(raw, { furniture: [] }, "s1", 1, 0, 0, words, 20);
    expect(r.openings.map((o) => [o.tag, o.widthMm])).toEqual([
      ["W1", 0],
      ["", 0],
      ["GD.02", 0],
    ]);
    const near = [
      { text: "820", at: { x: 310, y: 25 } },
      { text: "FW", at: { x: 290, y: 20 } },
      { text: "03", at: { x: 296, y: 20 } },
    ];
    expect(openingAsPrinted({ a: { x: 300, y: 10 }, b: { x: 300, y: 40 }, tag: "FW 03", widthMm: 820 }, near, 20)).toEqual({ tag: "FW 03", widthMm: 820 });
    /* a mark's own figure is no width: W1.3 is not 1300 wide */
    expect(openingAsPrinted({ a: { x: 0, y: 0 }, b: { x: 30, y: 0 }, tag: "", widthMm: 1300 }, [{ text: "W1.3", at: { x: 15, y: -5 } }], 20).widthMm).toBe(0);
  });

  it("is hers as she read it where the sheet has no words, or names no room in them (a photo, a plan that draws its text)", () => {
    for (const w of [[], [words[3], words[4]]]) {
      const r = toSheet(raw, { furniture: [] }, "s1", 1, 0, 0, w, 20);
      expect(r.spaces.map((x) => x.name)).toEqual(["Bed 4", "Linen", "Kitchen"]);
      expect(r.openings.map((o) => [o.tag, o.widthMm])).toEqual([
        ["W1", 900],
        ["W7", 1200],
        ["GD.02 D.05", 820],
      ]);
    }
  });
});

describe("the words she is handed", () => {
  it("are the ones in her picture, in its pixels, cut at a whole line with what was left out counted", () => {
    const at = { k: 0.5, left: 100, top: 0, ow: 200, oh: 200 };
    const w = [
      { text: "BED 4", at: { x: 120, y: 20 } },
      { text: "TITLE BLOCK", at: { x: 900, y: 20 } },
      { text: "KITCHEN", at: { x: 140, y: 40 } },
      { text: "WC", at: { x: 160, y: 60 } },
    ];
    const shown = wordsShown(w, at, 25);
    expect(shown.words.map((x) => x.text)).toEqual(["BED 4", "KITCHEN", "WC"]);
    expect(shown.lines).toBe("BED 4 @10,10");
    /* "WC" would fit after the cut, but a list with a hole in it reads as whole */
    expect(shown.cut).toBe(2);
    expect(floorPrompt("Ground floor", 200, 200, null, shown)).toMatch(/2 more words are printed on it that aren't listed/);
    expect(floorPrompt("Ground floor", 200, 200, null)).not.toMatch(/Words:/);
  });
});

describe("the dimensions printed on a sheet, checked by its own words", () => {
  const dim = (mm: number, x1: number, y1: number, x2: number, y2: number) => ({ mm, what: "", x1, y1, x2, y2 });
  const words = [
    { text: "7440", at: { x: 300, y: 392 } },
    { text: "3,600", at: { x: 450, y: 300 } },
  ];
  it("keeps one only where a printed figure that is its length sits by its line's middle", () => {
    const raw = { dimensions: [dim(7440, 100, 400, 500, 400), dim(7400, 100, 400, 500, 400), dim(3600, 100, 100, 300, 100)] };
    expect(toDimensions(raw, 1, 0, 0, words).map((d) => d.mm)).toEqual([7440]);
    /* with no words to check by, as she read them */
    expect(toDimensions(raw, 1, 0, 0).map((d) => d.mm)).toEqual([7440, 7400, 3600]);
  });
  it("are the six longest, whatever order she gave them in", () => {
    const raw = { dimensions: [1, 2, 3, 4, 5, 6, 7].map((i) => dim(1000 * i, 0, 0, 100 * i, 0)) };
    expect(toDimensions(raw, 1, 0, 0).map((d) => d.mm)).toEqual([7000, 6000, 5000, 4000, 3000, 2000]);
  });
});

describe("the heights and the roof, as the set writes them", () => {
  const plans = [
    { floorId: "gf", floor: "Ground floor", sheetId: "s-gf", k: 1, left: 0, top: 0 },
    { floorId: "l1", floor: "Level 1", sheetId: "s-l1", k: 1, left: 0, top: 0 },
  ];
  const roof = (o: Record<string, unknown>) => toRoof({ levels: [], roof_parts: [], raked: [], material: "", roof_space: "", ...o }, plans);
  const part = (o: Record<string, unknown>) => ({ floor: "Ground floor", form: "gable", footprint: box(0, 0, 100, 50), ridge: "across", falls_to: "none", pitch_deg: 22.5, eave_mm: 2700, overhang_mm: 450, existing: false, source: "A201", ...o });

  it("keeps a floor's height only where she says where it is written, never one scaled or taken as usual", () => {
    const r = roof({
      levels: [
        { floor: "Ground floor", ceiling_mm: 2700, floor_zone_mm: 300, source: "A301 section AA: CLG 2700" },
        { floor: "Level 1", ceiling_mm: 2550, floor_zone_mm: 0, source: "scaled off section BB" },
        { floor: "Level 1", ceiling_mm: 2550, floor_zone_mm: 0, source: "measured off A302 at 1:100" },
        { floor: "Level 1", ceiling_mm: 2400, floor_zone_mm: 0, source: "typical ceiling" },
        { floor: "Level 1", ceiling_mm: 2400, floor_zone_mm: 0, source: "assumed 2400, the usual" },
        { floor: "Level 1", ceiling_mm: 2400, floor_zone_mm: 0, source: "the sections" },
        { floor: "Level 1", ceiling_mm: 0, floor_zone_mm: 0, source: "A302" },
      ],
    });
    expect(r.levels).toEqual([{ floorId: "gf", ceilingMm: 2700, floorZoneMm: 300, source: "A301 section AA: CLG 2700" }]);
    /* a sheet's own title, and heights worked out between the RLs it writes, are as written */
    const titled = roof({
      levels: [
        { floor: "Ground floor", ceiling_mm: 2700, floor_zone_mm: 0, source: "A301 Typical Section: CLG 2700" },
        { floor: "Level 1", ceiling_mm: 2550, floor_zone_mm: 0, source: "measured between the RLs on A301" },
      ],
    });
    expect(titled.levels.map((l) => [l.floorId, l.ceilingMm])).toEqual([
      ["gf", 2700],
      ["l1", 2550],
    ]);
    expect(JSON.stringify((roofSchema(["Ground floor"]) as { properties: { levels: unknown } }).properties.levels)).not.toMatch(/scaled/);
  });

  it("keeps a raked ceiling only with both its heights written, high over low, and a person under it", () => {
    const r = roof({
      raked: [
        { floor: "Ground floor", room: "Living", low_mm: 2400, high_mm: 4200 },
        { floor: "Ground floor", room: "Bed 1", low_mm: 0, high_mm: 0 },
        { floor: "Ground floor", room: "Study", low_mm: 3000, high_mm: 2400 },
        { floor: "Level 1", room: "Loft", low_mm: 1200, high_mm: 2400 },
      ],
    });
    expect(r.raked.map((x) => x.room)).toEqual(["Living"]);
  });

  it("leaves out a part whose pitch or eave the set doesn't write, or can't be, rather than flatten or ground it", () => {
    const r = roof({
      roof_parts: [part({ source: "kept" }), part({ eave_mm: 0 }), part({ pitch_deg: 0 }), part({ pitch_deg: 75 }), part({ form: "mansard" }), part({ form: "flat", pitch_deg: 0, source: "flat" })],
    });
    expect(r.parts.map((p) => [p.source, p.pitchDeg, p.eaveMm])).toEqual([
      ["kept", 22.5, 2700],
      ["flat", 0, 2700],
    ]);
  });

  it("keeps an overhang as she read it, and leaves one no eave can have out rather than cut it to 1.5 m", () => {
    const r = roof({ roof_parts: [part({ overhang_mm: 450 }), part({ overhang_mm: 2400 }), part({ overhang_mm: -300 })] });
    expect(r.parts.map((p) => p.overhangMm)).toEqual([450, 0, 0]);
    expect(JSON.stringify(roofSchema(["Ground floor"]))).toMatch(/overhang past the wall line, as written or dimensioned/);
  });

  it("keeps a skillion only when it falls to a side across its edges", () => {
    const r = roof({
      roof_parts: [
        part({ form: "skillion", ridge: "across", falls_to: "none", source: "nowhere" }),
        part({ form: "skillion", ridge: "across", falls_to: "left", source: "along" }),
        part({ form: "skillion", ridge: "across", falls_to: "down", source: "down" }),
        part({ form: "skillion", ridge: "down", falls_to: "left", source: "left" }),
      ],
    });
    expect(r.parts.map((p) => [p.source, p.fallsTo])).toEqual([
      ["down", "down"],
      ["left", "left"],
    ]);
  });

  it("puts a subfloor under no floor she didn't name", () => {
    const r = roof({ subfloor: { shown: "mentioned", floor: "Basement", outline: "", rooms: "", height_mm: 0, height_from: "", sheet: "A200", words: "subfloor ventilation" } });
    expect(r.subfloor).toBeUndefined();
  });
});

describe("the site, as the set gives it", () => {
  const at = { floorId: "gf", sheetId: "s1", k: 1, left: 0, top: 0 };
  const site = (o: Record<string, unknown>) => toSite({ has_site_plan: true, boundary: "", surfaces: [], street: [], neighbours: [], fences: [], ...o }, at)!;

  it("gives a figure it doesn't write, or one nothing can be, as 0, never a usual one", () => {
    const s = site({
      street: [{ name: "Ipsum Rd", kerb: "0,300 200,300", width_mm: 100_000 }],
      neighbours: [
        { outline: box(-120, 0, 100, 140), storeys: 0, attached: false, note: "" },
        { outline: box(220, 0, 100, 140), storeys: 2, attached: true, note: "adjoining semi" },
      ],
      fences: [
        { line: "0,0 200,0", height_mm: 0 },
        { line: "0,0 0,300", height_mm: 1500 },
      ],
    });
    expect(s.street!.widthMm).toBe(0);
    expect(s.neighbours.map((x) => x.storeys)).toEqual([0, 2]);
    expect(s.fences.map((x) => x.heightMm)).toEqual([0, 1500]);
    expect(site({ street: [{ name: "Ipsum Rd", kerb: "0,300 200,300", width_mm: 12_000 }] }).street!.widthMm).toBe(12_000);
  });

  it("is sent, when the set must be cut, the pages before its floor plans, nearest them first, then the first plan, then the pages after it", () => {
    expect(sitePages(12, 5)).toEqual([4, 3, 2, 1, 0, 5, 6, 7, 8, 9, 10, 11]);
    /* a set that starts with its plans, its roof and site plan after its floors: its front, on */
    expect(sitePages(12, 0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    /* forty at most, the far end of the pages after its plans going first */
    const many = sitePages(60, 5);
    expect(many).toHaveLength(40);
    expect(many.slice(0, 7)).toEqual([4, 3, 2, 1, 0, 5, 6]);
    expect(many[39]).toBe(39);
    expect(sitePages(0, 0)).toEqual([]);
  });

  it("is sent its own site plan pages alone, in the set's order, six at most", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const set = await PDFDocument.create();
    for (let i = 0; i < 10; i++) set.addPage([100 + i, 100]);
    const bytes = Buffer.from(await set.save());
    const cut = await PDFDocument.load(new Uint8Array((await pagesOnly(bytes, [6, 5, 22, 5]))!));
    expect(cut.getPages().map((pg) => pg.getWidth())).toEqual([105, 106]);
    const most = await PDFDocument.load(new Uint8Array((await pagesOnly(bytes, [9, 8, 7, 6, 5, 4, 3, 2]))!));
    expect(most.getPageCount()).toBe(6);
    expect(await pagesOnly(bytes, [])).toBeNull();
    expect(await pagesOnly(bytes, [40])).toBeNull();
  });
});
