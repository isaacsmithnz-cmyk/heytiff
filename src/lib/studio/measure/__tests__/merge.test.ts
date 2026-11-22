import type { ReadSpace, SheetReading } from "../../reading";
import { setAside, withMeasured } from "../merge";

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
