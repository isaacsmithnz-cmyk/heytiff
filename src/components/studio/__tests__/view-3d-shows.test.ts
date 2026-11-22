import { ALL_FLOORS, flipFloor, shows, type Look3D } from "../view-3d";

const look = (l: Partial<Look3D>): Look3D => ({ floor: ALL_FLOORS, apart: false, labels: true, layer: "roof", ...l });

describe("which floors the 3D draws", () => {
  it("draws every floor, as before, with none switched off", () => {
    expect(shows(look({}), "g")).toBe(true);
  });
  it("leaves out the floors switched off in the phone's View menu", () => {
    const l = look({ hide: ["l1"] });
    expect(shows(l, "l1")).toBe(false);
    expect(shows(l, "g")).toBe(true);
  });
  it("draws the one floor picked, whatever is switched off", () => {
    const l = look({ floor: "g", hide: ["g"] });
    expect(shows(l, "g")).toBe(true);
    expect(shows(l, "l1")).toBe(false);
  });
});

describe("a floor's switch in the web's View panel", () => {
  const ids = ["lg", "g", "l1"];
  it("leaves one floor out and keeps the rest standing", () => {
    expect(flipFloor(look({}), ids, "l1")).toMatchObject({ floor: ALL_FLOORS, hide: ["l1"] });
  });
  it("shows a floor alone, not lifted apart, once it's the only one on", () => {
    expect(flipFloor(look({ hide: ["l1"], apart: true }), ids, "lg")).toMatchObject({ floor: "g", hide: undefined, apart: false });
  });
  it("goes back to every floor once the last one off is on again", () => {
    expect(flipFloor(look({ hide: ["l1"] }), ids, "l1")).toMatchObject({ floor: ALL_FLOORS, hide: undefined });
  });
  it("turns a floor back on beside the one shown alone", () => {
    expect(flipFloor(look({ floor: "g" }), ids, "l1")).toMatchObject({ floor: ALL_FLOORS, hide: ["lg"] });
  });
  it("won't switch off the last floor on", () => {
    expect(flipFloor(look({ floor: "g" }), ids, "g")).toBeNull();
  });
});
