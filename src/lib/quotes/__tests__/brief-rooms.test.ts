import { checkRooms, kitRows, sizeRoom, type ReadBrief, type ReadRoom } from "../brief-rooms";

/* Isaac, 2026-10-04: "What if I said the room is 30m2?" */

const room0 = (r: Partial<ReadRoom>): ReadRoom => ({
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
  outdoorAt: null,
  outdoorSaid: null,
  drain: null,
  drainSaid: null,
  newCircuit: null,
  circuitSaid: null,
  ...r,
});
const read = (rooms: ReadRoom[]): ReadBrief => ({ rooms, buildingType: "residential", zone: { zone: 5, town: "Riverview" } });

const brief = "Living room is 30m2, west facing with lots of glass. Pipe run about 7m. Bed 2 is about 4 x 3.5. Bed 3 to match.";

describe("a room read from the brief", () => {
  it("is kept only when its words are the brief's and its size is in them", () => {
    const { rooms, dropped } = checkRooms(
      read([
        room0({ name: "Living", said: "Living room is 30m2", areaM2: 30, facing: "W", glazing: "high", runM: 7, runSaid: "Pipe run about 7m" }),
        room0({ name: "Bed 2", said: "Bed 2 is about 4 x 3.5", sidesM: [4, 3.5], runM: 12, runSaid: "run of 12m" }),
        room0({ name: "Bed 3", said: "Bed 3 to match", areaM2: 14 }),
        room0({ name: "Study", said: "Study is 9m2", areaM2: 9 }),
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
    const s = sizeRoom({ ...room0({ name: "Living", said: "Living room is 30m2" }), areaM2: 30 }, 5, "residential", pack);
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
      "where the outdoor sits",
    ]);
  });

  it("counts what the brief said: west and a lot of glass load it up", () => {
    const s = sizeRoom({ ...room0({ name: "Living", said: "x", facing: "W", glazing: "high", style: "wall" }), areaM2: 30 }, 5, "residential", pack);
    expect(s.loadKw).toBe(7);
    expect(s.options).toEqual([]);
    expect(s.assumed).not.toContain("which way it faces");
  });

  it("keeps to the style the brief names", () => {
    const s = sizeRoom({ ...room0({ name: "Living", said: "x", style: "ducted" }), areaM2: 30 }, 5, "residential", pack);
    expect(s.options.map((o) => o.indoor)).toEqual(["PEAD-M50JAA"]);
  });
});

describe("a pair on the job", () => {
  const o = {
    indoor: "MSZ-AP50VGD2",
    outdoor: "MUZ-AP50VG2",
    style: "Wall",
    coolKw: 5,
    heatKw: 6,
    liquidMm: 6.35,
    gasMm: 12.7,
    outdoorWidthMm: 840,
    outdoorWeightKg: 53,
    outdoorAmps: 16,
  };
  const room = { name: "Living", drain: null, newCircuit: null } as const;

  it("goes on with its whole kit: coil at the pack's sizes, mount and isolator for the outdoor, cover and drain along the run, consumables", () => {
    expect(kitRows(room, o, { runM: 7, outdoorAt: "ground" })).toEqual([
      { name: "MSZ-AP50VGD2", sub: "Wall indoor unit, Living", qty: "1" },
      { name: "MUZ-AP50VG2", sub: "Outdoor unit, Living", qty: "1" },
      { name: "ø6.35 / ø12.7 pair coil", sub: "liquid / gas mm, Living", qty: "7 m" },
      { name: "Ground mount", sub: "for the outdoor's 840 mm, 53 kg, Living", qty: "1" },
      { name: "Isolator", sub: "for the outdoor's 16 A, Living", qty: "1" },
      { name: "Pipe cover", sub: "along the run, Living", qty: "7 m" },
      { name: "Drain hose", sub: "along the run, Living", qty: "7 m" },
      { name: "Consumables", sub: "a head, Living", qty: "1" },
    ]);
  });

  it("asks what isn't known, and adds a pump or a circuit only when the brief says", () => {
    const rows = kitRows({ name: "Bed 2", drain: "pump", newCircuit: true }, o, { runM: null, outdoorAt: null });
    expect(rows.find((r) => r.name === "ø6.35 / ø12.7 pair coil")!.qty).toBe("Run to ask");
    expect(rows.find((r) => r.name === "Outdoor mount")!.qty).toBe("Where it sits: ask");
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(["Condensate pump", "New circuit"]));
    expect(kitRows(room, o, { runM: 7, outdoorAt: "wall" }).map((r) => r.name)).toContain("Wall bracket");
    expect(kitRows(room, o, { runM: 7, outdoorAt: "ground" }).map((r) => r.name)).not.toEqual(expect.arrayContaining(["Condensate pump", "New circuit"]));
  });

  it("keeps where the outdoor sits, the drain and a circuit only when their words are the brief's", () => {
    const brief = "Living room is 30m2, outdoor on the balcony, new circuit needed.";
    const { rooms } = checkRooms(
      read([
        room0({ name: "Living", said: "Living room is 30m2", areaM2: 30, outdoorAt: "ground", outdoorSaid: "outdoor on the balcony", newCircuit: true, circuitSaid: "new circuit needed", drain: "pump", drainSaid: "needs a pump" }),
      ]),
      brief
    );
    expect(rooms[0]).toMatchObject({ outdoorAt: "ground", newCircuit: true, drain: null });
  });
});
