import { checkRooms, sizeRoom, type ReadBrief, type ReadRoom } from "../brief-rooms";

/* Isaac, 2026-10-04: "What if I said the room is 30m2?" */

const room = (r: Partial<ReadRoom>): ReadRoom => ({
  name: "Room",
  said: "",
  areaM2: null,
  sidesM: null,
  ceilingM: null,
  glazing: null,
  insulation: null,
  facing: null,
  roomAbove: null,
  style: null,
  ...r,
});
const read = (rooms: ReadRoom[]): ReadBrief => ({ rooms, buildingType: "residential", zone: { zone: 5, town: "Riverview" } });

const brief = "Living room is 30m2, west facing with lots of glass. Bed 2 is about 4 x 3.5. Bed 3 to match.";

describe("a room read from the brief", () => {
  it("is kept only when its words are the brief's and its size is in them", () => {
    const { rooms, dropped } = checkRooms(
      read([
        room({ name: "Living", said: "Living room is 30m2", areaM2: 30, facing: "W", glazing: "high" }),
        room({ name: "Bed 2", said: "Bed 2 is about 4 x 3.5", sidesM: [4, 3.5] }),
        room({ name: "Bed 3", said: "Bed 3 to match", areaM2: 14 }),
        room({ name: "Study", said: "Study is 9m2", areaM2: 9 }),
      ]),
      brief
    );
    expect(rooms.map((r) => [r.name, r.areaM2])).toEqual([
      ["Living", 30],
      ["Bed 2", 14],
    ]);
    expect(dropped).toEqual(["Bed 3", "Study"]);
  });
});

const pack = {
  indoor_units: [
    { model: "MSZ-AP42VGD2", form_factor: "wall" },
    { model: "MSZ-AP50VGD2", form_factor: "wall" },
    { model: "MSZ-EF50VGW", form_factor: "wall" },
    { model: "MSZ-AP60VGD2", form_factor: "wall" },
    { model: "PEAD-M50JAA", form_factor: "ducted" },
  ],
  pair_tables: [
    { idu_model: "MSZ-AP42VGD2", odu_model: "MUZ-AP42VG2", rated_cool_kw: 4.2, rated_heat_kw: 5.4 },
    { idu_model: "MSZ-AP50VGD2", odu_model: "MUZ-AP50VG2", rated_cool_kw: 5.0, rated_heat_kw: 6.0 },
    { idu_model: "MSZ-EF50VGW", odu_model: "MUZ-EF50VG", rated_cool_kw: 5.0, rated_heat_kw: 5.8 },
    { idu_model: "MSZ-AP60VGD2", odu_model: "MUZ-AP60VG2", rated_cool_kw: 6.0, rated_heat_kw: 6.8 },
    { idu_model: "PEAD-M50JAA", odu_model: "SUZ-M50VA", rated_cool_kw: 5.0, rated_heat_kw: 6.0 },
  ],
} as unknown as Parameters<typeof sizeRoom>[3];

describe("a room sized", () => {
  it("takes the zone's watts a square metre, and offers the smallest pairs that cover it, one per series", () => {
    const s = sizeRoom({ ...room({ name: "Living", said: "Living room is 30m2" }), areaM2: 30 }, 5, "residential", pack);
    /* 30 m² × 145 W/m², all standard */
    expect(s.loadKw).toBe(4.4);
    expect(s.options.map((o) => o.indoor)).toEqual(["MSZ-AP50VGD2", "MSZ-EF50VGW"]);
    expect(s.assumed).toEqual([
      "how much glass",
      "how well it's insulated",
      "the ceiling height",
      "which way it faces",
      "whether there's a floor above",
      "the style of unit (counted as a wall split)",
    ]);
  });

  it("counts what the brief said: west and a lot of glass load it up", () => {
    const s = sizeRoom({ ...room({ name: "Living", said: "x", facing: "W", glazing: "high", style: "wall" }), areaM2: 30 }, 5, "residential", pack);
    expect(s.loadKw).toBe(7);
    expect(s.options).toEqual([]);
    expect(s.assumed).not.toContain("which way it faces");
  });

  it("keeps to the style the brief names", () => {
    const s = sizeRoom({ ...room({ name: "Living", said: "x", style: "ducted" }), areaM2: 30 }, 5, "residential", pack);
    expect(s.options.map((o) => o.indoor)).toEqual(["PEAD-M50JAA"]);
  });
});
