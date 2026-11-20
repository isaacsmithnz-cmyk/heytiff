import type { ReadSpace, SheetReading } from "../../reading";
import { withMeasured } from "../merge";

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
  it("stand alone when the picture read failed", () => {
    const out = withMeasured(null, measured([sq("Lounge", 0, 0)]), "p2");
    expect(out).toMatchObject({ sheetId: "p2", openings: [], planUp: "" });
    expect(out.spaces).toHaveLength(1);
  });
});
