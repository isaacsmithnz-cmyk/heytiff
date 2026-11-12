import { createDesign, type DesignDocument, type Floor } from "../document";
import {
  applyNorthToSet,
  applyScaleToSet,
  mmPerPxFor,
  printedScaleOf,
  proposedScale,
  setOf,
  setupNeeds,
  shareAcrossSet,
  sheetTitleOf,
} from "../plan-set";

/* the title block of 7 Cutler Rd's CD103, as its PDF's words come out */
const CUTLER_WORDS = ["GROUND FLOOR", "CD103", "SCALE:", "G", "1:50 @ A1", "CLIENT:", "JONAS & KYLIE PALMQVIST", "ADDRESS:", "1:100 TO RWO"].map(
  (text) => ({ text, at: { x: 0, y: 0 } }),
);

const sheet = (id: string, page: number, w = 2400, h = 1695) => ({
  id: `sht_${id}`,
  imageRef: `org/o/${id}.png`,
  pageNumber: page,
  name: `Page ${page}`,
  width: w,
  height: h,
  x: 0,
  y: 0,
  crop: { x: 2, y: 19, w: w - 14, h: h - 31 },
});

function cutler(): DesignDocument {
  const d = createDesign({ name: "7 Cutler Rd", mode: "plan" });
  const floor = (id: string, level: number, page: number, w?: number, h?: number): Floor => ({
    id,
    name: id,
    level,
    scaleMmPerUnit: null,
    northDeg: null,
    northPos: null,
    plans: [sheet(id, page, w, h)],
  });
  return {
    ...d,
    floors: [floor("gf", 0, 2), floor("l1", 1, 3), floor("photo", 2, 1, 4000, 3000)],
    planImport: {
      sources: [{ ref: "org/o/set.pdf", kind: "pdf" }],
      placed: { 1: "org/o/gf.png", 2: "org/o/l1.png" },
      chosen: [1, 2],
      names: {},
      words: { 1: CUTLER_WORDS },
    },
  };
}

describe("the printed scale", () => {
  test("reads 1:50 at A1 off the title block, not a note's 1:100", () => {
    expect(printedScaleOf(CUTLER_WORDS)).toEqual({ ratio: 50, paper: "A1", text: "1:50 @ A1" });
  });

  test("reads a scale split across words", () => {
    const words = ["SCALE", "1:100", "@", "A3"].map((text) => ({ text }));
    expect(printedScaleOf(words)).toMatchObject({ ratio: 100, paper: "A3" });
  });

  test("finds nothing without a paper size", () => {
    expect(printedScaleOf([{ text: "1:100 TO RWO" }])).toBeNull();
    expect(printedScaleOf(undefined)).toBeNull();
  });

  test("A1 at 2,400 pixels is 17.52 mm a pixel at 1:50, against the 17.53 Isaac measured", () => {
    const mm = mmPerPxFor({ ratio: 50, paper: "A1", text: "" }, { width: 2400, height: 1695 })!;
    expect(mm).toBeCloseTo(17.521, 2);
    expect(Math.abs(mm - 17.532315) / 17.532315).toBeLessThan(0.001);
  });

  test("a raster that isn't the paper's shape can't take the printed scale", () => {
    expect(mmPerPxFor({ ratio: 50, paper: "A1", text: "" }, { width: 4000, height: 3000 })).toBeNull();
  });

  test("the design proposes the scale from the floor's own page", () => {
    expect(proposedScale(cutler(), "gf")?.mmPerUnit).toBeCloseTo(17.521, 2);
    expect(proposedScale(cutler(), "photo")).toBeNull();
  });
});

describe("Tiff's measured scale", () => {
  /* 3517's plan, 13 November 2026: a marketing PNG with a 5 m scale bar and no 1:100 */
  const benelong = (sure: boolean, words = false): DesignDocument => {
    const d = createDesign({ name: "1/20d Benelong Crescent", mode: "plan" });
    return {
      ...d,
      floors: [{ id: "gf", name: "Ground floor", level: 0, scaleMmPerUnit: null, northDeg: null, northPos: null, plans: [{ ...sheet("gf", 1, 855, 1183), pageNumber: null }] }],
      planImport: {
        sources: [{ ref: "org/o/benelong.png", kind: "image" }],
        placed: { 0: "org/o/gf.png" },
        chosen: [0],
        names: {},
        ...(words ? { words: { 0: CUTLER_WORDS } } : {}),
        measured: { 0: { mmPerPx: 37.037, from: "the 5000 mm printed on it", sure } },
      },
    };
  };

  test("offers hers where the page prints no scale, saying where it came from", () => {
    expect(proposedScale(benelong(false), "gf")).toEqual({ kind: "measured", from: "the 5000 mm printed on it", sure: false, mmPerUnit: 37.037 });
    expect(proposedScale(benelong(true), "gf")).toMatchObject({ kind: "measured", sure: true });
  });

  test("never sets it on its own", () => {
    expect(benelong(true).floors[0].scaleMmPerUnit).toBeNull();
  });

  test("a printed scale that fits the raster comes first; one that doesn't falls to hers", () => {
    /* a 1044 x 1015 photo isn't A1's shape, so the 1:50 can't be trusted there */
    const d = benelong(true, true);
    const photo = { ...d, floors: d.floors.map((f) => ({ ...f, plans: f.plans.map((p) => ({ ...p, width: 1044, height: 1015 })) })) };
    expect(proposedScale(photo, "gf")).toMatchObject({ kind: "measured" });
    expect(proposedScale(cutler(), "gf")).toMatchObject({ kind: "printed", scale: { ratio: 50, paper: "A1" } });
  });

  test("a design with none offers nothing", () => {
    expect(proposedScale(cutler(), "photo")).toBeNull();
  });
});

describe("the sheet's title", () => {
  test("GROUND FLOOR beside CD103", () => {
    expect(sheetTitleOf(CUTLER_WORDS)).toEqual({ title: "Ground floor", number: "CD103" });
  });
});

describe("one set, one scale and north", () => {
  test("pages of the same size from one upload are a set; a photo is not", () => {
    expect(setOf(cutler(), "gf")).toEqual(["gf", "l1"]);
    expect(setOf(cutler(), "photo")).toEqual(["photo"]);
  });

  test("a scale set on one floor reaches the rest of its set", () => {
    const d = applyScaleToSet(cutler(), "gf", 17.52);
    expect(d.floors.map((f) => f.scaleMmPerUnit)).toEqual([17.52, 17.52, null]);
  });

  test("north set on one floor reaches the rest of its set, each with an arrow", () => {
    const d = applyNorthToSet(cutler(), "l1", 0);
    expect(d.floors.map((f) => f.northDeg)).toEqual([0, 0, null]);
    expect(d.floors[0].northPos).not.toBeNull();
  });

  test("a calibration on the first floor answers the second: nothing left to ask", () => {
    const prev = cutler();
    const measured = { ...prev, floors: prev.floors.map((f) => (f.id === "gf" ? { ...f, scaleMmPerUnit: 17.49 } : f)) };
    const turned = { ...measured, floors: measured.floors.map((f) => (f.id === "gf" ? { ...f, northDeg: 12 } : f)) };
    const out = shareAcrossSet(prev, turned);
    expect(out.floors.find((f) => f.id === "l1")).toMatchObject({ scaleMmPerUnit: 17.49, northDeg: 12 });
    expect(setupNeeds(out)).toEqual({ scale: ["photo"], north: ["photo"] });
  });
});
