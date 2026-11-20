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
