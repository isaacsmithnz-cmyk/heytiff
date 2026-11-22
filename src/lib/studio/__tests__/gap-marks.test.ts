import type { ReadOpening, SheetReading, WallGap } from "../reading";
import { facingFrom, marksInGaps } from "../gap-marks";
import { itemsOf, taggedFromWords } from "../schedule";

/* a sheet at 10 mm to the pixel: a 4 m by 3 m lounge whose north wall (y 0)
   has a 1 m gap and a 3.4 m gap, and a hall beside it through a 1.5 m gap */
const MM = 10;
const lounge = { name: "Lounge", named: true, kind: "room" as const, outline: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }], written: "", existing: false, openTo: "", stair: "" };
const hall = { ...lounge, name: "Hall", outline: [{ x: 400, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 400, y: 300 }] };
const gaps: WallGap[] = [
  { a: { x: 20, y: 0 }, b: { x: 120, y: 0 }, t: 20 },
  { a: { x: 150, y: 0 }, b: { x: 390, y: 0 }, t: 20 },
  { a: { x: 400, y: 100 }, b: { x: 400, y: 250 }, t: 20 },
  /* a sliver between two wall pieces */
  { a: { x: 395, y: 0 }, b: { x: 398, y: 0 }, t: 20 },
];
const sheet = (openings: ReadOpening[] = []): SheetReading => ({
  sheetId: "p10",
  spaces: [lounge, hall],
  openings,
  marks: [],
  furniture: [],
  checklist: [],
  flags: [],
  planUp: "N",
  walled: { grid: { x: [], y: [] }, rounds: 0, look: [], walls: [], gaps },
});
const items = itemsOf(
  {
    items: [
      { mark: "GW.01", type: "W.01", kind: "window", width_mm: 1000, height_mm: 1800, sill_mm: 900 },
      { mark: "GW.14", type: "W.04", kind: "window", width_mm: 700, height_mm: 2100, sill_mm: 600 },
      { mark: "GW.15", type: "W.04", kind: "window", width_mm: 700, height_mm: 2100, sill_mm: 600 },
      { mark: "GW.16", type: "W.04", kind: "window", width_mm: 700, height_mm: 2100, sill_mm: 600 },
      { mark: "GD.04", type: "03", kind: "door", width_mm: 1500, height_mm: 3000, sill_mm: 0 },
      { mark: "GD.01", type: "01", kind: "door", width_mm: 2750, height_mm: 3300, sill_mm: 0 },
    ],
  },
  25,
);
const word = (text: string, x: number, y: number) => ({ text, at: { x, y } });
const door = (a: { x: number; y: number }, b: { x: number; y: number }, extra: Partial<ReadOpening> = {}): ReadOpening => ({ kind: "door", tag: "", a, b, widthMm: 820, room: "Hall", external: false, facing: "", ...extra });

describe("the marks in the gaps", () => {
  it("puts a mark printed beside a gap in it, jamb to jamb, at its schedule's size", () => {
    const { sheet: s, placed } = marksInGaps(sheet(), [word("GW.01", 70, -70)], items, MM);
    expect(placed).toBe(1);
    expect(s.openings).toEqual([
      { kind: "window", tag: "GW.01", a: { x: 20, y: 0 }, b: { x: 120, y: 0 }, widthMm: 1000, room: "Lounge", external: true, facing: "N", heightMm: 1800, sillMm: 900, inGap: true },
    ]);
  });

  it("makes a gap with three marks along it three windows, side by side where the marks are", () => {
    const { sheet: s } = marksInGaps(sheet(), [word("GW.16", 300, -60), word("GW.14", 180, -60), word("GW.15", 250, -60)], items, MM);
    const w = s.openings.map((o) => [o.tag, o.a.x, o.b.x]);
    expect(w.map((x) => x[0])).toEqual(["GW.14", "GW.15", "GW.16"]);
    for (const [, a, b] of w) {
      expect(b as number).toBeGreaterThan(a as number);
      expect(a as number).toBeGreaterThanOrEqual(150);
      expect(b as number).toBeLessThanOrEqual(390);
    }
    /* no two overlap, each its 700 mm */
    expect((w[1][1] as number) >= (w[0][2] as number) && (w[2][1] as number) >= (w[1][2] as number)).toBe(true);
    expect(s.openings.every((o) => o.widthMm === 700 && o.heightMm === 2100 && o.inGap)).toBe(true);
  });

  it("takes the place of what the read put there, and keeps its room", () => {
    const misread: ReadOpening = { kind: "window", tag: "GW 01 W.01", a: { x: 250, y: -2 }, b: { x: 290, y: -2 }, widthMm: 900, room: "Lounge area", external: true, facing: "NE" };
    const untagged = door({ x: 400, y: 100 }, { x: 400, y: 250 }, { room: "Entry hall", inGap: true });
    const kept = door({ x: 500, y: 300 }, { x: 560, y: 300 });
    const { sheet: s } = marksInGaps(sheet([misread, untagged, kept]), [word("GW.01", 70, -70), word("GD.04", 440, 175)], items, MM);
    expect(s.openings).toContainEqual(kept);
    const byTag = new Map(s.openings.map((o) => [o.tag, o]));
    expect(byTag.get("GW.01")).toMatchObject({ a: { x: 20, y: 0 }, room: "Lounge area", facing: "NE" });
    expect(byTag.get("GD.04")).toMatchObject({ kind: "door", a: { x: 400, y: 100 }, b: { x: 400, y: 250 }, widthMm: 1500, heightMm: 3000, room: "Entry hall" });
    expect(s.openings).toHaveLength(3);
  });

  it("names a door between two rooms by the side it's read on, inside", () => {
    const { sheet: s } = marksInGaps(sheet(), [word("GD.04", 380, 175)], items, MM);
    expect(s.openings[0]).toMatchObject({ tag: "GD.04", external: false, facing: "" });
  });

  it("leaves a mark over 2 m from every gap as it is, and never puts one in a gap too narrow for it", () => {
    const far = marksInGaps(sheet(), [word("GW.01", 70, 260)], items, MM);
    expect(far.placed).toBe(0);
    const sliver = marksInGaps(sheet(), [word("GD.01", 396, -40)], items, MM);
    expect(sliver.sheet.openings.some((o) => o.a.x === 395)).toBe(false);
  });

  it("changes nothing on a floor whose file draws no walls", () => {
    const flat = { ...sheet([door({ x: 0, y: 0 }, { x: 10, y: 0 })]), walled: undefined };
    expect(marksInGaps(flat, [word("GW.01", 0, 0)], items, MM).sheet).toBe(flat);
  });

  it("turns the way out on the sheet into a compass way by plan-up", () => {
    expect(facingFrom({ x: 0, y: -1 }, "N")).toBe("N");
    expect(facingFrom({ x: 1, y: 0 }, "N")).toBe("E");
    expect(facingFrom({ x: 0, y: 1 }, "E")).toBe("W");
    expect(facingFrom({ x: -1, y: -1 }, "N")).toBe("NW");
    expect(facingFrom({ x: 0, y: -1 }, "")).toBe("");
  });

  it("doesn't give a mark an opening carries to a second, untagged one", () => {
    const s = sheet([
      { kind: "window", tag: "GW.01", a: { x: 20, y: 0 }, b: { x: 120, y: 0 }, widthMm: 1000, room: "Lounge", external: true, facing: "N" },
      door({ x: 60, y: 10 }, { x: 80, y: 10 }),
    ]);
    expect(taggedFromWords(s, [word("GW.01", 70, 5)], items, 90).openings[1].tag).toBe("");
  });

  /* a set that marks its windows by type: W1 printed at each of six */
  const W1 = itemsOf({ items: [{ mark: "W1", type: "", kind: "window", width_mm: 900, height_mm: 1200, sill_mm: 900 }] }, 25);
  const six: WallGap[] = Array.from({ length: 6 }, (_, i) => ({ a: { x: i * 200, y: 0 }, b: { x: i * 200 + 90, y: 0 }, t: 20 }));
  const onSix = (openings: ReadOpening[]): SheetReading => ({ ...sheet(openings), walled: { ...sheet().walled!, gaps: six } });

  it("puts a mark printed at each of several windows in each one's gap, each keeping its read room", () => {
    const read = six.map((g): ReadOpening => ({ kind: "window", tag: "W1", a: g.a, b: g.b, widthMm: 900, room: "Bed 1", external: true, facing: "N" }));
    const { sheet: s, placed } = marksInGaps(onSix(read), six.map((g) => word("W1", g.a.x + 45, -50)), W1, MM);
    expect(placed).toBe(6);
    expect(s.openings.map((o) => o.a.x)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(s.openings.every((o) => o.tag === "W1" && o.widthMm === 900 && o.room === "Bed 1" && o.inGap)).toBe(true);
  });

  it("takes a mark printed twice over itself as one, and one listed under a type as one opening", () => {
    const long: WallGap[] = [{ a: { x: 0, y: 0 }, b: { x: 240, y: 0 }, t: 20 }];
    const s = { ...sheet(), walled: { ...sheet().walled!, gaps: long } };
    expect(marksInGaps(s, [word("W1", 120, -50), word("W1", 121, -50)], W1, MM).placed).toBe(1);
    /* and a read GW.01 gives way to it, whichever print it sits by */
    const read: ReadOpening = { kind: "window", tag: "GW.01", a: { x: 20, y: 0 }, b: { x: 120, y: 0 }, widthMm: 1000, room: "Lounge", external: true, facing: "N" };
    const twice = marksInGaps(sheet([read]), [word("GW.01", 70, -70), word("GW.01", 270, -60)], items, MM);
    expect([twice.placed, twice.sheet.openings.length]).toEqual([1, 1]);
  });

  it("lends a misread's room to what went in its gap, not to the mark it was misread as", () => {
    /* read as GW.14 in the first gap, where the plan prints GW.01; GW.14 is printed by the second */
    const misread: ReadOpening = { kind: "window", tag: "GW.14", a: { x: 30, y: 0 }, b: { x: 110, y: 0 }, widthMm: 700, room: "Study", external: true, facing: "N" };
    const { sheet: s } = marksInGaps(sheet([misread]), [word("GW.01", 70, -70), word("GW.14", 370, -60)], items, MM);
    const byTag = new Map(s.openings.map((o) => [o.tag, o]));
    expect(byTag.get("GW.01")).toMatchObject({ room: "Study", a: { x: 20, y: 0 } });
    expect(byTag.get("GW.14")).toMatchObject({ room: "Lounge" });
    expect(s.openings).toHaveLength(2);
  });

  it("puts nothing in a gap for a mark the schedule lists at two sizes", () => {
    const twice = itemsOf({ items: [...W1.map((i) => ({ mark: i.mark, type: "", kind: "window", width_mm: 600, height_mm: 1200, sill_mm: 900 })), { mark: "W1", type: "", kind: "window", width_mm: 900, height_mm: 1200, sill_mm: 900 }] }, 25);
    expect(marksInGaps(sheet(), [word("W1", 70, -70)], twice, MM).placed).toBe(0);
  });
});
