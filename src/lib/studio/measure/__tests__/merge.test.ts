import type { ReadSpace, SheetReading } from "../../reading";
import { onGaps, setAside, withMeasured } from "../merge";

const sq = (name: string, x: number, y: number, kind: ReadSpace["kind"] = "room"): ReadSpace => ({
  name,
  named: true,
  kind,
  outline: [
    { x, y },
    { x: x + 100, y },
    { x: x + 100, y: y + 100 },
    { x, y: y + 100 },
  ],
  written: "",
  existing: false,
  openTo: "",
  stair: "",
});
const picture = (spaces: ReadSpace[]): SheetReading => ({
  sheetId: "p2",
  spaces,
  openings: [{ kind: "door", tag: "D1", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, widthMm: 820, room: "Lounge", external: false, facing: "" }],
  marks: [],
  furniture: [],
  checklist: [],
  flags: [],
  planUp: "N",
});
const measured = (spaces: ReadSpace[]) => ({ spaces, look: [], grid: { x: [0, 100], y: [0, 100] }, rounds: 1 });

describe("the measured rooms into a sheet's reading", () => {
  it("are its rooms, with the picture read's doors, notes and north kept", () => {
    const out = withMeasured(picture([sq("Lounge", 5, 5)]), measured([sq("Lounge", 0, 0)]), "p2");
    expect(out.spaces[0].outline[0]).toEqual({ x: 0, y: 0 });
    expect(out.openings).toHaveLength(1);
    expect(out.planUp).toBe("N");
    expect(out.walled).toEqual({ grid: { x: [0, 100], y: [0, 100] }, rounds: 1, look: [] });
  });
  it("say a walled room only the picture read found, once, and not a hall or a terrace", () => {
    const pic = picture([sq("Lounge", 5, 5), sq("Ensuite", 300, 0, "wet"), sq("Ensuite", 600, 0, "wet"), sq("Hall", 900, 0, "circulation"), sq("Deck", 0, 400, "outdoor")]);
    const out = withMeasured(pic, measured([sq("Lounge", 0, 0)]), "p2");
    expect(out.walled!.look).toEqual([{ kind: "readers", room: "Ensuite", said: "Ensuite: a second read of the plan found this room and the measured one didn't. Check it isn't missing." }]);
  });
  it("say a room the two reads name differently, when the plan writes both names", () => {
    const out = withMeasured(picture([sq("Grand Hall", 5, 5), sq("Store", 300, 0, "cupboard")]), measured([sq("Washroom", 0, 0, "wet"), { ...sq("Cupboard", 300, 0, "cupboard"), named: false }]), "p2");
    expect(out.walled!.look).toEqual([{ kind: "readers", room: "Washroom", said: "Washroom: a second read of the plan calls this room Grand Hall. Check which it is." }]);
  });
  it("a measured room with no name takes the name of the picture's room that is plainly it, not of one it sits inside", () => {
    /* a robe the picture read drew inside Bed 2, and Bed 2 itself: both unnamed by measure */
    const robe: ReadSpace = { ...sq("Unnamed", 0, 0, "cupboard"), named: false, outline: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }] };
    const bed: ReadSpace = { ...sq("Unnamed", 0, 0), named: false };
    const out = withMeasured(picture([sq("Bed 2", 0, 0)]), measured([robe, bed]), "p2");
    expect(out.spaces.map((s) => [s.name, s.kind])).toEqual([
      ["Unnamed", "cupboard"],
      ["Bed 2", "room"],
    ]);
  });
  it("stand alone when the picture read failed", () => {
    const out = withMeasured(null, measured([sq("Lounge", 0, 0)]), "p2");
    expect(out).toMatchObject({ sheetId: "p2", openings: [], planUp: "" });
    expect(out.spaces).toHaveLength(1);
  });
  it("are set aside, and the picture's rooms kept, when they plainly came out worse", () => {
    const pic = picture([sq("Lounge", 0, 0), sq("Bed 1", 200, 0), sq("Bed 2", 400, 0), sq("Bath", 600, 0, "wet"), sq("Robe", 800, 0, "cupboard")]);
    /* two rooms where the picture found five */
    const few = measured([sq("Lounge", 0, 0), sq("Bed 1", 200, 0)]);
    expect(setAside(pic, few)).toBe("it found 2 walled rooms where the read by picture found 5");
    const out = withMeasured(pic, few, "p2");
    expect(out.spaces).toHaveLength(5);
    expect(out.walled!.look).toEqual([{ kind: "readers", room: "", said: "The rooms were also measured off the walls, and that read was set aside: it found 2 walled rooms where the read by picture found 5." }]);
    /* or a pile of rooms that overlap or sit on no wall */
    const messy = { ...measured([sq("A", 0, 0), sq("B", 200, 0), sq("C", 400, 0), sq("D", 600, 0), sq("E", 800, 0)]), look: ["A", "B", "C"].map((room) => ({ kind: "overlap" as const, room, said: "" })) };
    expect(setAside(pic, messy)).toBe("3 of its 5 rooms overlapped or sat on no wall");
    /* a couple of things to look at on a big floor is no reason */
    expect(setAside(pic, { ...messy, look: messy.look.slice(0, 2) })).toBeNull();
  });
});

describe("what the picture read found, moved onto the measured rooms", () => {
  /* the picture saw one big kitchen-family room; measuring found two rooms
     there, named differently. A window on each, a fan and a sofa */
  const pic: SheetReading = {
    ...picture([sq("KITCHEN / FAMILY", 0, 0), sq("BED 1", 300, 0)]),
    spaces: [{ ...sq("KITCHEN / FAMILY", 0, 0), outline: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }] }, sq("BED 1", 300, 0)],
    openings: [
      { kind: "window", tag: "W1", a: { x: 20, y: -4 }, b: { x: 60, y: -4 }, widthMm: 1200, room: "KITCHEN / FAMILY", external: true, facing: "N" },
      { kind: "window", tag: "W2", a: { x: 140, y: -4 }, b: { x: 180, y: -4 }, widthMm: 1200, room: "KITCHEN / FAMILY", external: true, facing: "N" },
      { kind: "window", tag: "W3", a: { x: 330, y: -4 }, b: { x: 370, y: -4 }, widthMm: 900, room: "BED 1", external: true, facing: "N" },
      { kind: "door", tag: "D9", a: { x: 0, y: 900 }, b: { x: 10, y: 900 }, widthMm: 820, room: "Shed", external: true, facing: "" },
    ],
    marks: [{ item: "fan", text: "EF", room: "KITCHEN / FAMILY", outline: [{ x: 150, y: 40 }, { x: 160, y: 40 }, { x: 160, y: 50 }] }],
    furniture: [{ kind: "sofa", room: "KITCHEN / FAMILY", outline: [{ x: 120, y: 60 }, { x: 180, y: 60 }, { x: 180, y: 90 }] }],
  };
  const mine = measured([sq("Kitchen", 0, 0), sq("Family Room", 100, 0), sq("Bed 1", 300, 0)]);
  const out = withMeasured(pic, mine, "p2");
  it("names each window for the room it sits on, not the picture's room", () => {
    expect(out.openings.map((o) => o.room)).toEqual(["Kitchen", "Family Room", "Bed 1", "Shed"]);
  });
  it("and each fan, note and piece of furniture for the room it is in", () => {
    expect(out.marks[0].room).toBe("Family Room");
    expect(out.furniture[0].room).toBe("Family Room");
  });
  it("a door between two rooms goes to the one standing where its picture room stood", () => {
    const two: SheetReading = { ...picture([sq("LOUNGE", 0, 0), sq("HALL", 100, 0, "circulation")]), openings: [{ kind: "door", tag: "D1", a: { x: 100, y: 40 }, b: { x: 100, y: 60 }, widthMm: 820, room: "HALL", external: false, facing: "" }] };
    const got = withMeasured(two, measured([sq("Lounge", 0, 0), sq("Entry Hall", 100, 0, "circulation")]), "p2");
    expect(got.openings[0].room).toBe("Entry Hall");
  });
  it("leaves alone a name the measured read already has", () => {
    const got = withMeasured(picture([sq("Lounge", 5, 5)]), measured([sq("Lounge", 0, 0)]), "p2");
    expect(got.openings[0].room).toBe("Lounge");
  });
});

describe("rooms outside the part of the sheet that was measured", () => {
  const frame = { left: 250, top: 0, width: 400, height: 200 };
  it("are kept as the picture read drew them, said once, and not called missed", () => {
    /* only the garage's walls were found: the house lay left of her picture */
    const pic = picture([sq("Bed 4", 0, 0), sq("Lounge", 100, 0), sq("Garage", 300, 0, "garage")]);
    const out = withMeasured(pic, { ...measured([sq("Garage", 300, 0, "garage")]), frame }, "p2");
    expect(out.spaces.map((s) => s.name)).toEqual(["Garage", "Bed 4", "Lounge"]);
    expect(out.walled!.look).toEqual([{ kind: "readers", room: "", said: "Bed 4, Lounge: outside the part of the sheet that was measured, so they are as the read by picture drew them." }]);
  });
  it("a room inside it that only the picture found is still one to check, not added", () => {
    const pic = picture([sq("Garage", 300, 0, "garage"), sq("Store", 450, 0, "cupboard")]);
    const out = withMeasured(pic, { ...measured([sq("Garage", 300, 0, "garage")]), frame }, "p2");
    expect(out.spaces.map((s) => s.name)).toEqual(["Garage"]);
    expect(out.walled!.look.map((l) => l.room)).toEqual(["Store"]);
  });
});

it("says why the measured rooms are doubted when there is no picture read to fall back on", () => {
  const bad = { ...measured([sq("Lounge", 0, 0), sq("Bed 1", 0, 0)]), look: [1, 2, 3].map(() => ({ kind: "overlap" as const, room: "Lounge", said: "Lounge and Bed 1 overlap." })) };
  const out = withMeasured(null, bad, "p2");
  expect(out.spaces).toHaveLength(2);
  expect(out.walled!.look.at(-1)!.said).toBe("The measured rooms are doubtful (3 of its 2 rooms overlapped or sat on no wall), and the read by picture failed, so there was nothing to check them against.");
});

describe("rooms read from the drawing file, the picture read leading", () => {
  const unnamed = (x: number, y: number, kind: ReadSpace["kind"] = "room"): ReadSpace => ({ ...sq("Unnamed space", x, y, kind), named: false });
  const file = (spaces: ReadSpace[]) => ({ ...measured(spaces), from: "file" as const });
  it("each picture room takes the outline of the file's space that is plainly the same room, keeping its name", () => {
    /* the file's Lounge 4 px off the picture's: the same room; its Bed 120 px off: not */
    const out = withMeasured(picture([sq("Lounge", 5, 5), sq("Bed 1", 300, 0)]), file([unnamed(1, 1), sq("Bed", 420, 0)]), "p2");
    expect(out.spaces.map((s) => [s.name, s.outline[0]])).toEqual([
      ["Lounge", { x: 1, y: 1 }],
      ["Bed 1", { x: 300, y: 0 }],
      ["Bed", { x: 420, y: 0 }],
    ]);
  });
  it("a space only the file found is added when it has a name, never when it hasn't", () => {
    const out = withMeasured(picture([sq("Lounge", 5, 5)]), file([sq("Lounge", 0, 0), sq("WC", 600, 0, "wet"), unnamed(900, 0)]), "p2");
    expect(out.spaces.map((s) => s.name)).toEqual(["Lounge", "WC"]);
  });
  it("the picture's terrace, stair and hall stay as it drew them", () => {
    const pic = picture([sq("Lounge", 5, 5), sq("Terrace", 0, 300, "outdoor"), sq("Stair", 10, 10, "stair"), sq("Hall", 600, 0, "circulation")]);
    const out = withMeasured(pic, file([sq("Lounge", 0, 0)]), "p2");
    expect(out.spaces.map((s) => s.name)).toEqual(["Lounge", "Terrace", "Stair", "Hall"]);
    expect(out.openings).toHaveLength(1);
  });
});

describe("a named room the file offers as one with the unnamed space past its nibs", () => {
  const rect = (name: string, x0: number, y0: number, x1: number, y1: number, kind: ReadSpace["kind"] = "room"): ReadSpace => ({
    ...sq(name, 0, 0, kind),
    outline: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  });
  /* the file's Living, 100 across, and a space 40 across with no name past a nib each side 4 thick; a window in Living's bottom wall, and the gap between the nibs */
  const window = { a: { x: 30, y: 100 }, b: { x: 60, y: 100 }, t: 4 };
  const between = { a: { x: 102, y: 20 }, b: { x: 102, y: 80 }, t: 4 };
  const file = {
    ...measured([rect("Living", 0, 0, 100, 100), { ...rect("Unnamed space", 104, 0, 144, 100), named: false }]),
    from: "file" as const,
    walls: [[[{ x: 0, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 4 }]]],
    gaps: [window, between],
    joins: [{ into: 0, from: [1], outline: rect("", 0, 0, 144, 100).outline, gaps: [1] }],
  };
  it("are one room where the picture's room is more nearly both than the named part alone: it takes their outline, and the gap between them is no door's or window's place", () => {
    const out = withMeasured(picture([rect("Living", 1, 1, 143, 99)]), file, "p2");
    expect(out.spaces.map((s) => [s.name, s.outline])).toEqual([["Living", file.joins[0].outline]]);
    expect(out.walled!.gaps).toEqual([window]);
  });
  it("stay apart where the picture's room is the named part alone, the gap kept", () => {
    const out = withMeasured(picture([rect("Living", 1, 1, 99, 99)]), file, "p2");
    expect(out.spaces.map((s) => [s.name, s.outline])).toEqual([["Living", file.spaces[0].outline]]);
    expect(out.walled!.gaps).toEqual([window, between]);
  });
  it("stay apart where the picture read has a room of its own in the part with no name", () => {
    const out = withMeasured(picture([rect("Living", 1, 1, 143, 99), rect("Robe", 106, 2, 142, 98, "cupboard")]), file, "p2");
    expect(out.spaces.map((s) => [s.name, s.outline])).toEqual([
      ["Living", rect("", 1, 1, 143, 99).outline],
      ["Robe", file.spaces[1].outline],
    ]);
    expect(out.walled!.gaps).toEqual([window, between]);
  });
  it("stay apart with no read by picture to tell, and that is said", () => {
    const out = withMeasured(null, file, "p2");
    expect(out.spaces.map((s) => [s.name, s.outline])).toEqual([["Living", file.spaces[0].outline]]);
    expect(out.walled!.look).toEqual([
      { kind: "label", room: "Living", said: "Living: it opens wider than a doorway onto a space the plan gives no name, which may be part of it. There was no read by picture to tell, so it is only the part the plan names." },
    ]);
  });
});

describe("doors and windows in the gaps their walls leave", () => {
  const op = (x: number, y: number, kind: "door" | "window" = "window") => ({ kind, tag: "", a: { x: x - 20, y }, b: { x: x + 20, y }, widthMm: 900, room: "Lounge", external: true, facing: "N" });
  const gaps = [
    { a: { x: 100, y: 50 }, b: { x: 150, y: 50 }, t: 8 },
    { a: { x: 300, y: 50 }, b: { x: 340, y: 50 }, t: 8 },
  ];
  it("each takes the nearest gap within reach, jamb to jamb, each gap once; one with none stays as read", () => {
    const out = onGaps([op(130, 60), op(120, 70), op(600, 50)], gaps);
    expect(out[0]).toMatchObject({ a: { x: 100, y: 50 }, b: { x: 150, y: 50 }, inGap: true });
    /* the same gap is taken: the second, farther, stays where it was read */
    expect(out[1]).toMatchObject({ a: { x: 100, y: 70 }, b: { x: 140, y: 70 } });
    expect(out[1].inGap).toBeUndefined();
    expect(out[2].inGap).toBeUndefined();
  });
  it("a gap far longer than the opening as read is another's, and the opening stays as read", () => {
    /* a window read 40 px across by a 150 px gap: a door's, not this one's */
    const out = onGaps([op(130, 55)], [{ a: { x: 60, y: 50 }, b: { x: 210, y: 50 }, t: 8 }]);
    expect(out[0].inGap).toBeUndefined();
    expect(out[0].a).toEqual({ x: 110, y: 55 });
  });
  it("a floor read from the file carries its walls and gaps on its reading, its openings in them", () => {
    const walls = [[[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 8 }, { x: 0, y: 8 }]]];
    const pic = { ...picture([sq("Lounge", 5, 5)]), openings: [op(125, 55)] };
    const out = withMeasured(pic, { ...measured([sq("Lounge", 0, 0)]), from: "file", walls, gaps }, "p2");
    expect(out.walled).toMatchObject({ walls, gaps });
    expect(out.openings[0]).toMatchObject({ inGap: true, a: { x: 100, y: 50 } });
  });
});
