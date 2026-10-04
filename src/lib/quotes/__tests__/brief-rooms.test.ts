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

/* ── one multi for the rooms, on the shipped pack ── */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { multiKitRows, multiPipeWords, sizeMulti, type SizedRoom } from "../brief-rooms";

const SEED = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
const shipped = (): DataPack => {
  const meta = JSON.parse(readFileSync(join(SEED, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
};

const sized = (name: string, loadKw: number, runM: number | null = null): SizedRoom => ({
  name,
  said: name,
  areaM2: 1,
  loadKw,
  assumed: [],
  style: "wall",
  runM,
  outdoorAt: null,
  drain: null,
  newCircuit: null,
  options: [],
});

describe("one multi for the rooms", () => {
  const pack = shipped();

  it("sizes a head per room and the smallest outdoor the combination table takes them on that covers their loads together", () => {
    const p = sizeMulti([sized("Main", 2.6, 8), sized("Bed 2", 2.0, 12), sized("Bed 3", 2.0, 14)], pack);
    expect(p?.ok).toBe(true);
    if (!p?.ok) return;
    expect(p.multi.heads.map((h) => h.room)).toEqual(["Main", "Bed 2", "Bed 3"]);
    /* 2.6 + 2.0 + 2.0 = 6.6 kW: past the 3F54's 5.4, so the 4F71 */
    expect(p.multi.outdoor).toBe("MXZ-4F71VGD");
    expect(multiPipeWords(p.multi, [{ room: "Main", runM: 8 }, { room: "Bed 2", runM: 12 }, { room: "Bed 3", runM: 14 }])).toEqual([
      `34 m of pipe, of the ${p.multi.maxTotalM} m it takes`,
    ]);
    expect(multiPipeWords(p.multi, [{ room: "Main", runM: 30 }, { room: "Bed 2", runM: null }, { room: "Bed 3", runM: 5 }])).toEqual([
      `Main's 30 m is over the ${p.multi.maxBranchM} m a branch takes`,
    ]);
  });

  it("puts the outdoor on once and each head with its own coil, cover, drain and consumables", () => {
    const p = sizeMulti([sized("Main", 2.6), sized("Bed 2", 2.0)], pack);
    if (!p?.ok) throw new Error("no multi");
    const rows = multiKitRows(p.multi, [sized("Main", 2.6), { ...sized("Bed 2", 2.0), drain: "pump" as const }], { runs: { Main: 8, "Bed 2": null }, outdoorAt: "wall" });
    const names = rows.map((r) => r.name);
    expect(names.filter((n) => n === "Wall bracket")).toHaveLength(1);
    expect(names.filter((n) => n === "Isolator")).toHaveLength(1);
    expect(names.filter((n) => n === "Consumables")).toHaveLength(2);
    expect(names).toContain("Condensate pump");
    expect(rows.filter((r) => /pair coil/.test(r.name)).map((r) => r.qty)).toEqual(["8 m", "Run to ask"]);
  });

  it("says when no multi takes the rooms, and none for a single room", () => {
    expect(sizeMulti([sized("Hall", 30), sized("Bed", 2)], pack)).toEqual({ ok: false, why: "No multi head of that style in the data pack covers Hall's 30 kW" });
    expect(sizeMulti([sized("Only", 2)], pack)).toBeNull();
  });
});
