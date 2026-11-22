import { ALL_FLOORS, shows, type Look3D } from "../view-3d";

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
