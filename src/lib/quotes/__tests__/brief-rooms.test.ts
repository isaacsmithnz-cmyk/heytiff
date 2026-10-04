import { checkRooms, kitRows, sizeRoom, type ReadBrief, type ReadRoom } from "../brief-rooms";

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
  runM: null,
  runSaid: null,
  ...r,
});
const read = (rooms: ReadRoom[]): ReadBrief => ({ rooms, buildingType: "residential", zone: { zone: 5, town: "Riverview" } });

const brief = "Living room is 30m2, west facing with lots of glass. Pipe run about 7m. Bed 2 is about 4 x 3.5. Bed 3 to match.";

describe("a room read from the brief", () => {
  it("is kept only when its words are the brief's and its size is in them", () => {
    const { rooms, dropped } = checkRooms(
      read([
        room({ name: "Living", said: "Living room is 30m2", areaM2: 30, facing: "W", glazing: "high", runM: 7, runSaid: "Pipe run about 7m" }),
        room({ name: "Bed 2", said: "Bed 2 is about 4 x 3.5", sidesM: [4, 3.5], runM: 12, runSaid: "run of 12m" }),
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
    /* a run in the brief's words is kept; one that isn't, isn't */
    expect(rooms.map((r) => r.runM)).toEqual([7, null]);
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
    { idu_model: "MSZ-AP42VGD2", odu_model: "MUZ-AP42VG2", rated_cool_kw: 4.2, rated_heat_kw: 5.4, pipe_liquid_mm: 6.35, pipe_gas_mm: 12.7 },
    { idu_model: "MSZ-AP50VGD2", odu_model: "MUZ-AP50VG2", rated_cool_kw: 5.0, rated_heat_kw: 6.0, pipe_liquid_mm: 6.35, pipe_gas_mm: 12.7 },
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
      "the pipe run",
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

describe("a pair on the job", () => {
  it("goes on with its pair coil at the pack's sizes and an isolator; the run is the brief's, else to ask", () => {
    const o = { indoor: "MSZ-AP50VGD2", outdoor: "MUZ-AP50VG2", style: "Wall", coolKw: 5, heatKw: 6, liquidMm: 6.35, gasMm: 12.7 };
    expect(kitRows({ name: "Living", runM: 7 }, o)).toEqual([
      { name: "MSZ-AP50VGD2", sub: "Wall indoor unit, Living", qty: "1" },
      { name: "MUZ-AP50VG2", sub: "Outdoor unit, Living", qty: "1" },
      { name: "ø6.35 / ø12.7 pair coil", sub: "liquid / gas mm, Living", qty: "7 m" },
      { name: "Isolator", sub: "Living", qty: "1" },
    ]);
    expect(kitRows({ name: "Bed 2", runM: null }, o)[2]!.qty).toBe("Run to ask");
  });
});
