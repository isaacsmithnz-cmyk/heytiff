import { checkDucted, ductedAirWords, ductedAsks, ductedKitRows, sizeDucted, type DuctedRead } from "../brief-ducted";
import { priceJobList } from "../job-price";

/* Isaac, 2026-10-04: "The brief will decide all of this" — read as written,
   kept only when the brief's words hold it, and asked where they don't. The
   read below is Tiff's own, from this brief. */
const brief = `Ducted for the house: living 30m2, dining 15m2, main bedroom 4.5 x 4, bed 2 3 x 3.5, bed 3 3 x 3.5.
Unit in the roof, outdoor on the side wall on brackets, run 15m.
Maybe 4 or 5 grilles, 3 mdo, 1 round and a 3m flangeless bar grille @ 150mm high.
Each room will have a 10 inch supply and 10 inch return, plus a common return in the hallway.
Single 14 off the front and split to 14/10/10/10.
ME zone controller with temperature control, wireless sensors in the bedrooms, living is the common zone, wants the app.`;

const each = "Each room will have a 10 inch supply and 10 inch return";
const tiff: DuctedRead = {
  ducted: true,
  unitAt: "roof",
  unitSaid: "Unit in the roof",
  outlets: [
    { room: "", count: 3, type: "mdo", neckMm: 250, neckSaid: each, lengthMm: null, heightMm: null, flangeless: false, said: "3 mdo" },
    { room: "", count: 1, type: "round", neckMm: 250, neckSaid: each, lengthMm: null, heightMm: null, flangeless: false, said: "1 round" },
    { room: "", count: 1, type: "bar", neckMm: null, lengthMm: 3000, heightMm: 150, flangeless: true, said: "a 3m flangeless bar grille @ 150mm high" },
    /* a size Tiff made up: no words of the brief hold it */
    { room: "", count: 2, type: "square", neckMm: 300, lengthMm: null, heightMm: null, flangeless: false, said: "2 square diffusers" },
  ],
  outletsUnsure: { min: 4, max: 5, said: "Maybe 4 or 5 grilles" },
  returns: [
    ...["living", "dining", "main bedroom", "bed 2", "bed 3"].map((room) => ({ room, common: false, neckMm: 250, widthMm: null, heightMm: null, said: each })),
    { room: "", common: true, neckMm: null, widthMm: null, heightMm: null, said: "plus a common return in the hallway" },
  ],
  layout: [
    { piece: "trunk", inMm: 350, outsMm: [], count: 1, said: "Single 14 off the front" },
    { piece: "fitting", inMm: 350, outsMm: [350, 250, 250, 250], count: 1, said: "split to 14/10/10/10" },
  ],
  zoning: {
    zones: null,
    control: "temperature",
    controller: "ME zone controller",
    sensors: ["main bedroom", "bed 2", "bed 3"].map((room) => ({ room, wireless: true })),
    commonZone: "living",
    wifi: true,
    said: "ME zone controller with temperature control, wireless sensors in the bedrooms, living is the common zone, wants the app.",
  },
  run: { m: 15, said: "run 15m" },
  outdoor: { at: "wall", said: "outdoor on the side wall on brackets" },
  drain: { how: null, said: null },
  circuit: { needed: null, said: null },
};

const pack = {
  indoor_units: [
    { model: "PEA-M125HAA", form_factor: "ducted", airflow_ls: 1000 },
    { model: "PEA-M100HAA", form_factor: "ducted", airflow_ls: 700 },
    { model: "MSZ-AP71VGD2", form_factor: "wall" },
  ],
  outdoor_units: [{ model: "PUZ-ZM125VKA2-A", width_mm: 1050, weight_kg: 114, max_amps_a: 28 }],
  pair_tables: [
    { idu_model: "PEA-M100HAA", odu_model: "PUZ-ZM100VKA2-A", rated_cool_kw: 10, rated_heat_kw: 11.2, pipe_liquid_mm: 9.52, pipe_gas_mm: 15.88 },
    { idu_model: "PEA-M125HAA", odu_model: "PUZ-ZM125VKA2-A", rated_cool_kw: 12.5, rated_heat_kw: 14, pipe_liquid_mm: 9.52, pipe_gas_mm: 15.88 },
    { idu_model: "MSZ-AP71VGD2", odu_model: "MUZ-AP71VG2", rated_cool_kw: 7.1, rated_heat_kw: 8, pipe_liquid_mm: 6.35, pipe_gas_mm: 12.7 },
  ],
} as unknown as Parameters<typeof sizeDucted>[1];

describe("a ducted system read from the brief", () => {
  const { read, dropped } = checkDucted(tiff, brief);

  it("keeps what the brief's words hold — inches as mm, a size from another sentence — and drops the rest, named", () => {
    expect(dropped).toEqual(['outlets "2 square diffusers"']);
    expect(read.outlets.map((o) => [o.type, o.count, o.neckMm, o.lengthMm, o.heightMm])).toEqual([
      ["mdo", 3, 250, null, null],
      ["round", 1, 250, null, null],
      ["bar", 1, null, 3000, 150],
    ]);
    expect(read.layout.map((p) => [p.piece, p.inMm, p.outsMm])).toEqual([
      ["trunk", 350, []],
      ["fitting", 350, [350, 250, 250, 250]],
    ]);
    expect(read.run.m).toBe(15);
    expect(read.outdoor.at).toBe("wall");
  });

  it("is one pair that covers the rooms together", () => {
    const s = sizeDucted([{ loadKw: 4.4 }, { loadKw: 2.2 }, { loadKw: 2.6 }, { loadKw: 1.5 }, { loadKw: 1.5 }], pack);
    expect(s.loadKw).toBe(12.2);
    expect(s.options.map((o) => [o.indoor, o.outdoor, o.airflowLs])).toEqual([["PEA-M125HAA", "PUZ-ZM125VKA2-A", 1000]]);
  });

  const pair = sizeDucted([{ loadKw: 12.2 }], pack).options[0]!;
  const choices = { runM: 15, outdoorAt: "wall" as const, newCircuit: null, drainPump: false };

  it("goes on as the brief has it: each outlet, each return, the ductwork piece by piece, the zoning", () => {
    expect(ductedKitRows(pair, read, choices).map((r) => `${r.name} | ${r.qty}`)).toEqual([
      "PEA-M125HAA | 1",
      "PUZ-ZM125VKA2-A | 1",
      "ø9.52 / ø15.88 pair coil | 15 m",
      "Wall bracket | 1",
      "Isolator | 1",
      "Pipe cover | 15 m",
      "Hanging kit | 1",
      "Condensate drain | Drain run to ask",
      "MDO, Ø250 neck | 3",
      "Round diffuser, Ø250 neck | 1",
      "Bar grille 3000 × 150, flangeless | 1",
      "Return grille, Ø250 spigot | 1",
      "Return grille, Ø250 spigot | 1",
      "Return grille, Ø250 spigot | 1",
      "Return grille, Ø250 spigot | 1",
      "Return grille, Ø250 spigot | 1",
      "Return grille | Size to ask",
      "Trunk Ø350 | 1",
      "Fitting Ø350 → Ø350 / Ø250 / Ø250 / Ø250 | 1",
      "Zone damper Ø250 | Count to ask",
      "Zone cable | Count to ask",
      "Zone controller: ME zone controller | 1",
      "Zone sensor, wireless | 3",
      "Wi-Fi interface | 1",
      "Consumables | 1",
    ]);
  });

  it("asks what the brief left out: the unsure count, the zones, a sensor for a zone without one, the drain", () => {
    expect(ductedAsks(read, choices, ["Living", "Dining", "Main bedroom", "Bed 2", "Bed 3"])).toEqual([
      'the outlet count ("Maybe 4 or 5 grilles")',
      "how many zones",
      "a sensor for Dining (temperature control wants one in every zone), or on/off there",
      "where the condensate drains",
    ]);
  });

  it("says the air split waits on a return's size, then splits it by size once each has one", () => {
    expect(ductedAirWords(pair, read)).toEqual(["The unit's 1000 L/s splits across the returns once the common return has a size"]);
    const sized = { returns: read.returns.map((r) => (r.common ? { ...r, neckMm: 400 } : r)) };
    expect(ductedAirWords(pair, sized)[0]).toMatch(/^The unit's 1000 L\/s through 6 returns, split by size: living: about 132 L\/s, 2\.7 m\/s;/);
  });

  it("prices its plain parts by the business's own items, and waits on the price book for the sized ones", () => {
    const { unpriced } = priceJobList(ductedKitRows(pair, read, choices).slice(8, 12), {
      priceOf: () => null,
      unitOffer: () => null,
      component: () => null,
    });
    expect(unpriced.map((u) => [u.name, u.why])).toEqual([
      ["MDO, Ø250 neck", "Priced from your range for it, once the price book has it"],
      ["Round diffuser, Ø250 neck", "Priced from your range for it, once the price book has it"],
      ["Bar grille 3000 × 150, flangeless", "Priced from your range for it, once the price book has it"],
      ["Return grille, Ø250 spigot", "Priced from your range for it, once the price book has it"],
    ]);
  });
});
