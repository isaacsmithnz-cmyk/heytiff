import { levelOfName, marksCount, printedCeiling, printedLevels, rlOf, type BoxedWord } from "../printed-levels";
import { joinRoof } from "../roof-join";
import type { ReadRoofPart, RoofHeights, RoofShape } from "../reading";

/* a mark over its value, as 3570's sections print them: the value 7.8 pt under, left edges in line */
const mark = (label: string, value: string, x = 100, y = 400): BoxedWord[] => [
  { text: label, x, y, w: 20 },
  { text: value, x, y: y + 7.8, w: 41 },
];

describe("the levels a set prints", () => {
  it("reads an RL however it is printed, and nothing else", () => {
    expect(rlOf("RL 194000 mm")).toBe(194);
    expect(rlOf("RL 193.950")).toBe(193.95);
    expect(rlOf("194.000")).toBe(194);
    expect(rlOf("2400")).toBeNull();
    expect(rlOf("12.5")).toBeNull();
    expect(rlOf("NGL RL 193.501")).toBeNull();
  });

  it("knows a floor by how sets and reads name it", () => {
    expect([levelOfName("GF"), levelOfName("Ground floor"), levelOfName("1F"), levelOfName("Level 1"), levelOfName("Lower ground"), levelOfName("FIRST FLOOR PLAN")]).toEqual([0, 0, 1, 1, -1, 1]);
    expect(levelOfName("Guest ensuite")).toBeNull();
    expect(levelOfName("Garage")).toBeNull();
  });

  it("takes each floor's FFL and FCL off the value printed under its mark, left or right edges in line, and the ridge", () => {
    const right: BoxedWord[] = [
      { text: "1F FCL", x: 2220, y: 369, w: 20 },
      { text: "RL 200400 mm", x: 2199, y: 376.8, w: 41 },
    ];
    const p = printedLevels([
      { n: 16, words: [...mark("GF FFL", "RL 194000 mm"), ...mark("GF FCL", "RL 197200 mm", 100, 300), ...mark("1F FFL", "RL 197700 mm", 100, 280), ...right] },
      { n: 19, words: [...mark("RIDGE", "RL 203420 mm", 100, 100), ...mark("GF FFL", "RL 194000 mm", 300)] },
    ]);
    expect(p).toEqual({
      floors: [
        { level: 0, ffl: 194, fcl: 197.2, pages: [16, 19] },
        { level: 1, ffl: 197.7, fcl: 200.4, pages: [16] },
      ],
      ridges: [203.42],
    });
    expect(printedCeiling(p, 0)).toEqual({ ceilingMm: 3200, floorZoneMm: 500, source: "printed: FFL RL 194.000, FCL RL 197.200 (pages 16, 19)" });
    expect(printedCeiling(p, 1)).toMatchObject({ ceilingMm: 2700, floorZoneMm: 0 });
  });

  it("leaves out a mark printed two ways, one that names no floor, and a value that isn't in line or under it", () => {
    const p = printedLevels([
      { n: 1, words: [...mark("GF FFL", "RL 194000 mm"), ...mark("GUEST ENSUITE FFL", "RL 196530 mm", 100, 200), ...mark("FFL", "RL 193.100", 100, 100)] },
      { n: 2, words: [...mark("GF FFL", "RL 194500 mm"), { text: "1F FCL", x: 100, y: 50, w: 20 }, { text: "RL 200400 mm", x: 160, y: 57.8, w: 41 }] },
    ]);
    expect(p).toEqual({ floors: [], ridges: [] });
  });

  it("takes a value printed in the mark's own word", () => {
    expect(printedLevels([{ n: 3, words: [{ text: "GF FFL RL 194.000", x: 0, y: 0, w: 60 }] }]).floors).toEqual([{ level: 0, ffl: 194, pages: [3] }]);
  });

  it("counts a schedule's column of marks with no RL under them as none", () => {
    const column: BoxedWord[] = Array.from({ length: 30 }, (_, i) => ({ text: "GF FFL", x: 100, y: 40 * i, w: 20 }));
    expect(marksCount(column)).toBe(0);
    expect(marksCount([...mark("GF FFL", "RL 194000 mm"), ...mark("RIDGE", "RL 203420 mm", 100, 100)])).toBe(2);
  });
});

describe("the roof's slices put together", () => {
  const floors = [
    { floorId: "p10", name: "Ground floor" },
    { floorId: "p11", name: "Level 1" },
  ];
  const part = (over: Partial<ReadRoofPart> = {}): ReadRoofPart => ({
    floorId: "p11",
    sheetId: "p11",
    form: "hip",
    outline: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    ridge: "across",
    fallsTo: "",
    pitchDeg: 40,
    eaveMm: 0,
    overhangMm: 450,
    existing: false,
    source: "A104",
    ...over,
  });
  const heights = (over: Partial<RoofHeights> = {}): RoofHeights => ({ levels: [{ floorId: "p10", ceilingMm: 2700, floorZoneMm: 0, source: "A301 section" }], raked: [], roofSpace: "", pitches: [40], ...over });
  const printed = printedLevels([{ n: 16, words: [...mark("GF FFL", "RL 194000 mm"), ...mark("GF FCL", "RL 197200 mm", 100, 300), ...mark("1F FFL", "RL 197700 mm", 100, 200), ...mark("1F FCL", "RL 200400 mm", 100, 100), ...mark("RIDGE", "RL 203420 mm", 100, 20)] }]);

  it("stands a floor's printed levels over what the read took, and keeps them on the roof", () => {
    const roof = joinRoof({ parts: [], material: "" }, heights(), printed, floors);
    expect(roof.levels).toEqual([
      { floorId: "p10", ceilingMm: 3200, floorZoneMm: 500, source: "printed: FFL RL 194.000, FCL RL 197.200 (page 16)" },
      { floorId: "p11", ceilingMm: 2700, floorZoneMm: 0, source: "printed: FFL RL 197.700, FCL RL 200.400 (page 16)" },
    ]);
    expect(roof.printed).toEqual({ floors: [{ floorId: "p10", ffl: 194, fcl: 197.2 }, { floorId: "p11", ffl: 197.7, fcl: 200.4 }], ridges: [203.42] });
  });

  it("sits a part the roof plans give no eave on its floor's ceiling, and gives one with no pitch the set's one pitch", () => {
    const roof = joinRoof({ parts: [part({ pitchDeg: 0 })], material: "metal" }, heights(), printed, floors);
    expect(roof.parts).toEqual([expect.objectContaining({ eaveMm: 2700, pitchDeg: 40, source: "A104; its eave at its floor's ceiling; the set's one pitch, 40°" })]);
    expect(roof.material).toBe("metal");
  });

  it("leaves out a part with no pitch when the set writes two, and one whose floor's ceiling isn't known", () => {
    expect(joinRoof({ parts: [part({ pitchDeg: 0 })], material: "" }, heights({ pitches: [40, 20] }), printed, floors).parts).toEqual([]);
    expect(joinRoof({ parts: [part()], material: "" }, heights(), null, floors).parts).toEqual([]);
  });

  it("gives no floor the printed levels when two floors are named for one level", () => {
    const roof = joinRoof(null, heights(), printed, [...floors, { floorId: "p9", name: "Ground floor" }]);
    expect(roof.levels.find((l) => l.floorId === "p10")?.source).toBe("A301 section");
    expect(roof.levels.find((l) => l.floorId === "p11")?.ceilingMm).toBe(2700);
  });

  it("joins a roof with one slice missing from what the other gave", () => {
    const shape: RoofShape = { parts: [part({ eaveMm: 2600 })], material: "tile" };
    expect(joinRoof(shape, null, null, floors)).toMatchObject({ levels: [], parts: [expect.objectContaining({ eaveMm: 2600 })], material: "tile", raked: [], roofSpace: "" });
  });
});
