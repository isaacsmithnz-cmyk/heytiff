import type { SheetReading } from "../reading";
import { isSchedulePage, itemsOf, markKey, taggedFromWords, withSchedule } from "../schedule";
import { glassM2 } from "../rooms-from-reading";

const sheet = (tags: string[]): SheetReading => ({
  sheetId: "p3",
  spaces: [],
  openings: tags.map((tag, i) => ({ kind: "window", tag, a: { x: i * 100, y: 0 }, b: { x: i * 100 + 50, y: 0 }, widthMm: 900, room: "Bed 1", external: true, facing: "N" })),
  marks: [],
  furniture: [],
  checklist: [],
  flags: [],
  planUp: "N",
});
const items = itemsOf(
  {
    items: [
      { mark: "GW.21", type: "W.05", kind: "window", width_mm: 750, height_mm: 1800, sill_mm: 300 },
      { mark: "GW.22", type: "W.05", kind: "window", width_mm: 750, height_mm: 1800, sill_mm: 0 },
      { mark: "FW.01", type: "W.06", kind: "window", width_mm: 1000, height_mm: 1500, sill_mm: 0 },
      /* a level read as a size, and a mark with no size: neither kept */
      { mark: "RL", type: "", kind: "window", width_mm: 194000, height_mm: 0, sill_mm: 0 },
      { mark: "D04", type: "", kind: "door", width_mm: 0, height_mm: 2100, sill_mm: 0 },
    ],
  },
  24,
);

describe("the door and window schedule", () => {
  it("is a page titled so, or one with a width, a height and a dozen marks", () => {
    expect(isSchedulePage([{ text: "WINDOW TYPE W.01" }])).toBe(true);
    expect(isSchedulePage([{ text: "DOOR SCHEDULE" }])).toBe(true);
    expect(isSchedulePage([{ text: "WIDTH" }, { text: "HEIGHT" }, ...Array.from({ length: 12 }, (_, i) => ({ text: `W1.${i + 1}` }))])).toBe(true);
    expect(isSchedulePage([{ text: "GROUND FLOOR PLAN" }, { text: "HEIGHT" }])).toBe(false);
  });
  it("keeps only sizes a door or a window can be", () => {
    expect(items.map((i) => [i.mark, i.widthMm, i.heightMm, i.sillMm])).toEqual([
      ["GW.21", 750, 1800, 300],
      ["GW.22", 750, 1800, 0],
      ["FW.01", 1000, 1500, 0],
    ]);
  });
  it("sizes each opening by its mark, else by the type the plan writes, and leaves the rest as read", () => {
    expect(markKey("gw 21")).toBe(markKey("GW.21"));
    const { sheet: out, matched } = withSchedule(sheet(["GW.21", "W.06", "GW.22 W.05", "X9", "", "GW 21 W.05"]), items);
    expect(matched).toBe(4);
    expect(out.openings.map((o) => [o.widthMm, o.heightMm, o.sillMm])).toEqual([
      [750, 1800, 300],
      [1000, 1500, undefined],
      [750, 1800, undefined],
      [900, undefined, undefined],
      [900, undefined, undefined],
      /* its own mark's, split by a space as read, before its type's */
      [750, 1800, 300],
    ]);
  });
  it("gives a room's glass each window's scheduled height, else 1.2 m", () => {
    const { sheet: out } = withSchedule(sheet(["GW.21", "X9"]), items);
    /* 0.75 × 1.8 + 0.9 × 1.2 */
    expect(glassM2({ windows: out.openings })).toBeCloseTo(1.35 + 1.08, 5);
  });
});

it("an untagged door takes the schedule mark printed nearest it, each mark once, and none past reach", () => {
  const doors = { ...sheet(["", "", ""]), openings: sheet(["", "", ""]).openings.map((o) => ({ ...o, kind: "door" as const })) };
  const words = [
    { text: "GW.22", at: { x: 30, y: 10 } },
    { text: "FW.01", at: { x: 120, y: 12 } },
    { text: "2400", at: { x: 220, y: 5 } },
  ];
  const out = taggedFromWords(doors, words, items, 40);
  expect(out.openings.map((o) => o.tag)).toEqual(["GW.22", "FW.01", ""]);
});
