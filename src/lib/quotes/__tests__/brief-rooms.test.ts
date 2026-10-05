import { checkRooms, countIn, kitRows, nearestKw, sizeRoom, withSwap, type ReadBrief, type ReadRoom } from "../brief-rooms";

/* Isaac, 2026-10-04: "What if I said the room is 30m2?" */

const room0 = (r: Partial<ReadRoom>): ReadRoom => ({
  name: "Room",
  said: "",
  areaM2: null,
  sidesM: null,
  unitKw: null,
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
const read = (rooms: ReadRoom[]): ReadBrief => ({
  rooms,
  buildingType: "residential",
  zone: { zone: 5, town: "Riverview" },
  ducted: null,
  vrf: false,
  vrfHeads: null,
  swap: { replacing: null, replacingSaid: null, keepPipe: null, keepPipeSaid: null },
});

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

  /* Isaac's walk, 2026-10-05: "6kw Kitchen, 2.5kw x 2" read as no rooms */
  it("is kept on the unit size its words name, as many as the words count, each its own name", () => {
    const named = "3 x Head Multi Outdoor\n* 6kw Kitchen\n* 2.5kw x 2\n* 3 combi pump";
    const { rooms, dropped } = checkRooms(
      read([
        room0({ name: "Kitchen", said: "6kw Kitchen", unitKw: 6 }),
        room0({ name: "Head", said: "2.5kw x 2", unitKw: 2.5 }),
        room0({ name: "Head", said: "2.5kw x 2", unitKw: 2.5 }),
        room0({ name: "Head", said: "2.5kw x 2", unitKw: 2.5 }),
        room0({ name: "Lounge", said: "6kw Kitchen", unitKw: 7 }),
      ]),
      named
    );
    expect(rooms.map((r) => [r.name, r.unitKw, r.areaM2])).toEqual([
      ["Kitchen", 6, null],
      ["Head", 2.5, null],
      ["Head 2", 2.5, null],
    ]);
    /* a third head the words don't count, and a size they don't hold */
    expect(dropped).toEqual(["Head", "Lounge"]);
  });

  it("counts the rooms a clause holds", () => {
    expect(countIn("2.5kw x 2")).toBe(2);
    expect(countIn("2 x 2.5kw high walls")).toBe(2);
    expect(countIn("6kw Kitchen")).toBe(1);
    expect(countIn("max 2 heads")).toBe(1);
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

  it("takes the pack's pairs nearest a unit size the brief names, with no load to ask about", () => {
    const s = sizeRoom(room0({ name: "Living", said: "5.2kw to living", unitKw: 5.2 }), 0, "residential", pack);
    expect(s.statedKw).toBe(5.2);
    expect(s.areaM2).toBeNull();
    expect(s.options.map((o) => o.indoor)).toEqual(["MSZ-AP50VGD2", "MSZ-EF50VGW"]);
    expect(s.assumed).toEqual(["the style of unit (counted as a wall split)", "the pipe run", "where the outdoor sits"]);
    expect(sizeRoom(room0({ name: "Kitchen", said: "6kw Kitchen", unitKw: 6, style: "wall" }), 0, "residential", pack).options.map((o) => o.indoor)).toEqual(["MSZ-AP60VGD2"]);
    expect(nearestKw([2.5, 7.1, 8], 7)).toBe(7.1);
    expect(nearestKw([5, 6], 5.5)).toBe(6);
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
  statedKw: null,
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

  /* Isaac's walk, 2026-10-05, job 3347: "3 x Head Multi Outdoor, 6kw Kitchen, 2.5kw x 2" */
  it("puts heads the brief names on at their sizes, and the smallest outdoor the table takes them on", () => {
    const named = (name: string, kw: number): SizedRoom => ({ ...sized(name, kw), areaM2: null, statedKw: kw });
    const p = sizeMulti([named("Kitchen", 6), named("Head", 2.5), named("Head 2", 2.5)], pack);
    if (!p?.ok) throw new Error("no multi");
    expect(p.multi.heads.map((h) => [h.room, h.indoor])).toEqual([
      ["Kitchen", "MSZ-AP60VGD2"],
      ["Head", "MSZ-AP25VGD2"],
      ["Head 2", "MSZ-AP25VGD2"],
    ]);
    /* named heads bring no load to cover: diversity is normal on a multi */
    expect(p.multi.outdoor).toBe("MXZ-4F71VGD");
  });

  it("says when no multi takes the rooms, and none for a single room", () => {
    expect(sizeMulti([sized("Hall", 30), sized("Bed", 2)], pack)).toEqual({ ok: false, why: "No multi head of that style in the data pack covers Hall's 30 kW" });
    expect(sizeMulti([sized("Only", 2)], pack)).toBeNull();
  });
});

describe("a swap, on any kit", () => {
  const rows = [
    { name: "MSZ-AP50VGD2", sub: "Wall indoor unit, Living", qty: "1" },
    { name: "MUZ-AP50VG2", sub: "Outdoor unit, Living", qty: "1" },
    { name: "ø6.35 / ø12.7 pair coil", sub: "liquid / gas mm, Living", qty: "7 m" },
    { name: "Isolator", sub: "Living", qty: "1" },
    { name: "Pipe cover", sub: "along the run, Living", qty: "7 m" },
  ];
  it("flushes the kept pipe in place of new coil and cover, and recovers and removes the old system", () => {
    expect(withSwap(rows, { replacing: true, keepPipe: true }, "Living").map((r) => r.name)).toEqual([
      "MSZ-AP50VGD2",
      "MUZ-AP50VG2",
      "Pipe flush",
      "Recovery and removal",
      "Isolator",
    ]);
    expect(withSwap(rows, { replacing: true, keepPipe: false }, "Living").map((r) => r.name)).toContain("ø6.35 / ø12.7 pair coil");
    expect(withSwap(rows, { replacing: false, keepPipe: false }, "Living")).toEqual(rows);
  });
});

/* ── the rooms on a VRF or PUMY, on the shipped pack ── */
import { sizeVrf, vrfKitRows } from "../brief-vrf";

describe("the rooms on a VRF", () => {
  const pack = shipped();
  const five = ["Bed 1", "Bed 2", "Bed 3", "Bed 4", "Study"].map((n) => sized(n, 2.0, 8));

  it("puts every head on branch boxes, or every head a City Multi head on joints — never a mix", () => {
    const box = sizeVrf(five, pack, "box");
    const joint = sizeVrf(five, pack, "joint");
    expect(box?.ok && joint?.ok).toBe(true);
    if (!box?.ok || !joint?.ok) return;
    expect(box.vrf.outdoor).toMatch(/^PUMY/);
    expect(box.vrf.fittings.map((f) => f.kind)).toEqual(expect.arrayContaining(["box"]));
    expect(box.vrf.heads.every((h) => /^M[SLF]Z|^S[LE]Z|^PEAD/.test(h.indoor))).toBe(true);
    expect(joint.vrf.fittings.every((f) => f.kind !== "box")).toBe(true);
    expect(joint.vrf.sections.filter((s) => s.room).map((s) => s.room).sort()).toEqual(["Bed 1", "Bed 2", "Bed 3", "Bed 4", "Study"]);
  });

  it("puts on the outdoor once, each head, each fitting by its part, each section at its size — a head's own run, the main asked", () => {
    const p = sizeVrf(five, pack, "box");
    if (!p?.ok) throw new Error("no vrf");
    const rows = vrfKitRows(p.vrf, five, { runs: Object.fromEntries(five.map((r) => [r.name, 8])), outdoorAt: "ground" });
    expect(rows.filter((r) => /indoor unit/.test(r.sub))).toHaveLength(5);
    expect(rows.filter((r) => r.name === "Ground mount")).toHaveLength(1);
    expect(rows.filter((r) => /main line/.test(r.sub)).every((r) => r.qty === "Run to ask")).toBe(true);
    expect(rows.filter((r) => /pair coil|copper/.test(r.name) && / Bed 1$/.test(r.sub)).map((r) => r.qty)).toEqual(["8 m"]);
    for (const f of p.vrf.fittings) if (f.part) expect(rows.map((r) => r.name)).toContain(f.part);
  });
});
