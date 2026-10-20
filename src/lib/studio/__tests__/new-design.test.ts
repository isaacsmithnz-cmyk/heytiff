import { boxFrom, cropInto, draftsFor, floorsFrom, nextLevel, pagesWord, type FloorDraft } from "../new-design";
import type { PageImage } from "../plans";

const page = (n: number, trim?: PageImage["trim"]): PageImage => ({
  pageNumber: n,
  label: `Page ${n}`,
  thumbUrl: `blob:${n}`,
  width: 2000,
  height: 1400,
  ...(trim ? { trim } : {}),
});

describe("the floors New design opens with", () => {
  it("levels the chosen pages from the ground up, in page order", () => {
    expect(draftsFor([5, 6, 9]).map((d) => [d.page, d.level])).toEqual([
      [5, 0],
      [6, 1],
      [9, 2],
    ]);
  });

  it("a page's boxes take its place, the first on its level and the rest going up", () => {
    const drafts = draftsFor([0, 1]);
    const out = cropInto(drafts, 0, [
      { box: { x: 0, y: 0, w: 900, h: 1400 }, level: 0 },
      { box: { x: 1000, y: 0, w: 900, h: 1400 }, level: 2 },
    ]);
    expect(out.map((d) => [d.page, d.level, !!d.box])).toEqual([
      [0, 0, true],
      [0, 2, true],
      [1, 1, false],
    ]);
    // putting every box back makes the page whole again, where it was
    expect(cropInto(out, 0, []).map((d) => [d.page, !!d.box])).toEqual([
      [0, false],
      [1, false],
    ]);
  });

  it("groups by level: two plans on one level are one floor; a name typed wins, else the level's", () => {
    const drafts: FloorDraft[] = [
      { key: "a", page: 0, level: 1, name: "" },
      { key: "b", page: 1, level: 0, name: "" },
      { key: "c", page: 2, level: 1, name: "Upstairs east" },
    ];
    const floors = floorsFrom(drafts, [page(1), page(2), page(3)], { 0: "r0", 1: "r1", 2: "r2" });
    expect(floors.map((f) => [f.name, f.level, f.plans.length])).toEqual([
      ["Ground floor", 0, 1],
      ["Upstairs east", 1, 2],
    ]);
    expect(floors[0].scaleMmPerUnit).toBeNull();
  });

  it("a whole page keeps its trimmed margins as its crop; a cropped piece keeps its box", () => {
    const trim = { x: 10, y: 10, w: 1980, h: 1380 };
    const floors = floorsFrom(
      [
        { key: "a", page: 0, level: 0, name: "" },
        { key: "b", page: 1, level: 1, name: "", box: { x: 100, y: 50, w: 800, h: 600 } },
      ],
      [page(1, trim), page(2, trim)],
      { 0: "r0", 1: "r1" },
    );
    expect(floors[0].plans[0].crop).toEqual(trim);
    expect(floors[1].plans[0].crop).toEqual({ x: 100, y: 50, w: 800, h: 600 });
  });

  it("a box is drawn from either corner, kept on the page, and too small is no box", () => {
    expect(boxFrom({ x: 900, y: 700 }, { x: 100, y: 50 }, 2000, 1400)).toEqual({ x: 100, y: 50, w: 800, h: 650 });
    expect(boxFrom({ x: -50, y: -50 }, { x: 2400, y: 1500 }, 2000, 1400)).toEqual({ x: 0, y: 0, w: 2000, h: 1400 });
    expect(boxFrom({ x: 10, y: 10 }, { x: 20, y: 20 }, 2000, 1400)).toBeNull();
  });

  it("the next box goes one level up from those used", () => {
    expect(nextLevel([])).toBe(0);
    expect(nextLevel([0, 1])).toBe(2);
  });

  it("says which pages are ticked", () => {
    expect(pagesWord([])).toBe("No pages chosen");
    expect(pagesWord([6])).toBe("Page 7");
    expect(pagesWord([6, 5])).toBe("Pages 6 and 7");
    expect(pagesWord([1, 2, 8])).toBe("Pages 2, 3 and 9");
  });
});
