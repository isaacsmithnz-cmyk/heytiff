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
