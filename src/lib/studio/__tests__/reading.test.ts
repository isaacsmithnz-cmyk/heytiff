import { labelFlags, parseWritten, readingSummary, withChecks, writtenAgrees, type PlanReading, type ReadSpace } from "../reading";

const box = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const space = (name: string, outline = box(0, 0, 100, 100), kind: ReadSpace["kind"] = "room"): ReadSpace => ({
  name,
  named: true,
  kind,
  outline,
  written: "",
  existing: false,
  openTo: "",
  stair: "",
});

describe("the plan's own labels, against the spaces she read", () => {
  it("a WC written inside the bathroom she drew is flagged, so it can be split out", () => {
    const flags = labelFlags([space("Bathroom", box(0, 0, 300, 200))], [{ text: "WC", at: { x: 250, y: 150 } }]);
    expect(flags).toEqual([{ kind: "label_inside", text: "WC", at: { x: 250, y: 150 }, room: "Bathroom" }]);
  });

  it("a label in no space at all is flagged", () => {
    expect(labelFlags([space("Living")], [{ text: "Linen", at: { x: 500, y: 500 } }])[0]).toMatchObject({ kind: "label_no_room", text: "Linen" });
  });

  it("a label in the space that bears its name, or the same space by another word, is fine", () => {
    const spaces = [space("Bed 4", box(0, 0, 300, 300)), space("WIR / Robe", box(400, 0, 100, 100)), space("En-suite", box(600, 0, 100, 100))];
    const words = [
      { text: "Bed 4", at: { x: 100, y: 100 } },
      { text: "Robe", at: { x: 450, y: 50 } },
      { text: "ENS", at: { x: 650, y: 50 } },
    ];
    expect(labelFlags(spaces, words)).toEqual([]);
  });

  it("the smallest space round a label is the one it names", () => {
    const spaces = [space("Living / Dining / Kitchen", box(0, 0, 1000, 600)), space("Pantry", box(800, 400, 150, 150), "cupboard")];
    expect(labelFlags(spaces, [{ text: "Pantry", at: { x: 870, y: 470 } }])).toEqual([]);
  });

  it("notes, numbers and dimensions are not labels", () => {
    expect(labelFlags([], [{ text: "A/C Over", at: { x: 1, y: 1 } }, { text: "2800", at: { x: 2, y: 2 } }, { text: "RL 7.580", at: { x: 3, y: 3 } }])).toEqual([]);
  });
});

describe("a size written in a room counts only if it agrees with the room", () => {
  it("reads metres and millimetres, longer side first", () => {
    expect(parseWritten("4.1m x 2.7m")).toEqual([4.1, 2.7]);
    expect(parseWritten("2700 x 4100")).toEqual([4.1, 2.7]);
    expect(parseWritten("Dining table 2.4 x 0.9m")).toEqual([2.4, 0.9]);
    expect(parseWritten("FFL 7.58")).toBeNull();
  });

  it("the dining table's 2.4 x 0.9 in a big living room is not the room's size", () => {
    const living = box(0, 0, 500, 600); // 7.2 m x 8.7 m at 14.4 mm a pixel
    expect(writtenAgrees("2.4 x 0.9m", living, 14.4)).toBe(false);
    expect(writtenAgrees("8.7 x 7.2", living, 14.4)).toBe(true);
  });

  it("can't judge without a scale or a size", () => {
    expect(writtenAgrees("4.1m x 2.7m", box(0, 0, 10, 10), null)).toBeNull();
    expect(writtenAgrees("", box(0, 0, 10, 10), 14.4)).toBeNull();
  });
});

const READING: PlanReading = {
  at: "2026-10-20T01:00:00Z",
  model: "claude-opus-5-5",
  failed: [],
  floors: {
    f1: [
      {
        sheetId: "s1",
        planUp: "N",
        spaces: [
          { ...space("Bathroom", box(100, 100, 300, 200), "wet") },
          { ...space("Living", box(500, 100, 500, 600)), written: "Dining table 2.4 x 0.9m" },
          { ...space("Stair", box(0, 0, 100, 300), "stair"), stair: "risers 19, treads 18, bottom Hall, top Landing" },
        ],
        openings: [{ kind: "window", tag: "W3", a: { x: 0, y: 0 }, b: { x: 80, y: 0 }, widthMm: 1200, room: "Living", external: true, facing: "N" }],
        marks: [{ item: "ac_note", text: "A/C Over", room: "Robe", outline: [{ x: 1, y: 1 }] }],
        furniture: [{ kind: "bed", room: "Bed 4", outline: box(0, 0, 10, 10) }],
        checklist: [
          { item: "fans", found: false, count: 0, note: "No fan symbols in any room" },
          { item: "rooms", found: true, count: 3, note: "" },
        ],
        flags: [],
      },
    ],
  },
};

describe("the reading kept on the design", () => {
  it("is checked against the words of the page its sheet came from, inside the sheet's crop", () => {
    const doc = {
      floors: [{ id: "f1", plans: [{ id: "s1", imageRef: "org/o/p6.png", crop: { x: 0, y: 0, w: 1200, h: 800 } }] }],
      planImport: {
        placed: { 5: "org/o/p6.png" },
        words: {
          5: [
            { text: "WC", at: { x: 350, y: 250 } },
            { text: "Kitchen", at: { x: 5000, y: 5000 } }, // outside this sheet's crop: another piece's
          ],
        },
      },
    };
    const checked = withChecks(READING, doc);
    expect(checked.floors.f1[0].flags).toEqual([{ kind: "label_inside", text: "WC", at: { x: 350, y: 250 }, room: "Bathroom" }]);
  });

  it("reads back for Tiff with areas once the floor is scaled, and the table's size left out", () => {
    const sum = readingSummary([{ id: "f1", name: "Ground floor", level: 0, scaleMmPerUnit: 14.4 }], READING);
    if (!sum.read) throw new Error("expected a reading");
    const [floor] = sum.floors;
    expect(floor.rooms.map((r) => [r.name, r.area_m2])).toEqual([
      ["Bathroom", 12.4],
      ["Living", 62.2],
    ]);
    expect(floor.rooms[1]).not.toHaveProperty("size_written");
    expect(floor.stairs).toEqual(["risers 19, treads 18, bottom Hall, top Landing"]);
    expect(floor.windows).toEqual([{ tag: "W3", room: "Living", facing: "N", width_mm: 1200 }]);
    expect(floor.ac_notes).toEqual(["A/C Over (Robe)"]);
    expect(floor.furniture).toEqual(["bed (Bed 4)"]);
    expect(floor.looked_for_not_found).toEqual(["fans: No fan symbols in any room"]);
  });

  it("without a scale there are no areas, and says so by leaving them null", () => {
    const sum = readingSummary([{ id: "f1", name: "Ground floor", level: 0, scaleMmPerUnit: null }], READING);
    if (!sum.read) throw new Error("expected a reading");
    expect(sum.floors[0].scale_set).toBe(false);
    expect(sum.floors[0].rooms[0].area_m2).toBeNull();
  });

  it("a design never read says so", () => {
    expect(readingSummary([], null)).toEqual({ read: false, said: "Tiff hasn't read this design's plans." });
  });
});
