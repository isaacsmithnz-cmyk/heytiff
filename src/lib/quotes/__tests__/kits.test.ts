import type { Product } from "../families";
import { breakerFor, cableFor, consumablesEstimate, expandKit, indoorFacts, isolatorFor, KITS, normaliseKitFacts, stillToSize, zoneKitOf } from "../kits";
import type { ZoningController } from "@/lib/studio/packs/schema";
import zoning from "../../../../data/packs/mitsubishi-electric@2026.1/zoning_controllers.json";

/* Kits as data (slice 1.3): what a system takes to install, picked from the
   business's own book by what each part is, never by one supplier's code.
   3375's split on its own book's items: the pair coil sold by the 20 m roll,
   cable by the 100 m roll. */

let n = 0;
const product = (name: string, cents: number, o: Partial<Product> = {}): Product => {
  const code = `C${n++}`;
  const offer = { supplierKey: "s1", supplierName: "Supplier", code, name, netCents: cents };
  return { key: `s1|${code}`, name, category: "parts" as Product["category"], offers: [offer], cheapest: offer, preferred: null, brand: null, quotes: 0, ...o };
};
const book = [
  product("PAIRED COIL 1/4+1/2X20M", 19100),
  product("PAIRED COIL 3/8+5/8X20M", 29629),
  product("INTERCONNECT 3C+E PER METRE", 180),
  product("TPS 2.5MM 2C+E 100M", 19800),
  product("TPS 4MM 2C+E 100M", 35400),
  product("RCBO 20A 30MA 1P+N", 3886),
  product("RCBO 32A 30MA 1P+N", 3770),
  product("ISOLATOR 20A 2P IP66", 2279),
  product("ISOLATOR 35A 2P IP66", 2360),
  product("ANTI VIBRATION RUBBER FEET (SET)", 1372),
  product("DRAIN HOSE 16MM PER METRE", 305),
  product("COLORBOND TRUNKING 2.4M SHALE GREY", 3030),
];
const facts = { pipe: "1/4+1/2" as const, pipeM: 20, powerM: 25, amps: 18, mount: "ground" as const, trunkingM: 0, drainM: 1 };
const at = { optionIndex: 0, system: "Split system" };

it("sizes the circuit by what the unit draws: the next standard breaker and isolator up, and its cable", () => {
  expect([breakerFor(18), isolatorFor(18), cableFor(18)]).toEqual([20, 20, "2.5"]);
  expect([breakerFor(28), isolatorFor(28), cableFor(28)]).toEqual([32, 35, "4"]);
  expect(breakerFor(99)).toBeNull();
});

it("builds 3375's split from the book: each part by what it is, a roll bought by the metre", () => {
  const lines = expandKit("split", facts, book, at);
  expect(lines.map((l) => [l.name, l.qty, l.unit, l.costCents, l.source])).toEqual([
    ["PAIRED COIL 1/4+1/2X20M", 20, "m", 955, "assumed"],
    ["INTERCONNECT 3C+E PER METRE", 20, "m", 180, "assumed"],
    ["TPS 2.5MM 2C+E 100M", 25, "m", 198, "assumed"],
    ["RCBO 20A 30MA 1P+N", 1, "", 3886, "assumed"],
    ["ISOLATOR 20A 2P IP66", 1, "", 2279, "assumed"],
    ["ANTI VIBRATION RUBBER FEET (SET)", 1, "", 1372, "assumed"],
    ["DRAIN HOSE 16MM PER METRE", 1, "m", 305, "assumed"],
  ]);
  expect(lines.every((l) => l.system === "Split system" && l.optionIndex === 0)).toBe(true);
  expect(lines[0]!.why).toBe("20 m pipe run; cheapest");
});

it("a bigger unit takes the bigger pipe, cable, breaker and isolator, and trunking in lengths", () => {
  const lines = expandKit("split", { ...facts, pipe: "3/8+5/8", amps: 28, trunkingM: 4.8 }, book, at);
  expect(lines.map((l) => l.name)).toEqual([
    "PAIRED COIL 3/8+5/8X20M",
    "INTERCONNECT 3C+E PER METRE",
    "TPS 4MM 2C+E 100M",
    "RCBO 32A 30MA 1P+N",
    "ISOLATOR 35A 2P IP66",
    "ANTI VIBRATION RUBBER FEET (SET)",
    "DRAIN HOSE 16MM PER METRE",
    "COLORBOND TRUNKING 2.4M SHALE GREY",
  ]);
  expect(lines.at(-1)).toMatchObject({ qty: 2, why: "4.8 m outside, in 2.4 m lengths; cheapest" });
});

it("a fact not given leaves its part not known yet, with nothing in it: no number nobody said", () => {
  const lines = expandKit("split", { ...facts, pipe: null, pipeM: null, amps: null }, book, at);
  expect(lines.find((l) => l.name === "Pair coil")).toMatchObject({ qty: 0, costCents: 0, source: "unknown", why: "Needs the unit's details" });
  expect(lines.find((l) => l.name === "Interconnect cable")).toMatchObject({ source: "unknown", why: "Needs the run" });
  expect(lines.find((l) => l.name === "RCBO")).toMatchObject({ source: "unknown" });
});

it("a part the book hasn't got stays on the quote, saying so", () => {
  const lines = expandKit("split", { ...facts, mount: "wall" }, book, at);
  expect(lines.find((l) => l.name === "Outdoor mount")).toMatchObject({ qty: 1, costCents: 0, source: "unknown", why: "Not in your book" });
});

it("the ducted kit adds flex and an outlet to each outlet, and a return", () => {
  expect(KITS.ducted.parts.map((p) => p.key)).toEqual([
    "pair-coil", "interconnect", "power", "breaker", "isolator", "mount", "drain", "trunking",
    "supply-plenum", "return-plenum", "flex", "outlets", "ys", "reducers", "floor-grilles", "boots", "hangers", "return", "return-box", "controller",
    "zone-interface", "zone-receiver", "zone-sensors", "zone-wifi",
  ]);
  const lines = expandKit("ducted", { ...facts, outlets: 5, outletMm: 250 }, [...book, product("VORTEX FLEX R1.0 250MM X 6M", 3045), product("CONE DIFFUSER 250MM", 1887)], at);
  expect(lines.find((l) => l.name === "VORTEX FLEX R1.0 250MM X 6M")).toMatchObject({ qty: 5, costCents: 3045 });
  expect(lines.find((l) => l.name === "CONE DIFFUSER 250MM")).toMatchObject({ qty: 5 });
  /* sized by the unit and the layout: never a guessed size */
  expect(lines.find((l) => l.name === "Supply plenum")).toMatchObject({ source: "unknown", why: "Needs the indoor unit" });
  expect(lines.find((l) => l.name === "Y branches")).toMatchObject({ source: "unknown", why: "Needs the layout: where the main duct splits" });
  expect(lines.find((l) => l.name === "Return air grille, filtered")).toMatchObject({ source: "unknown", why: "Needs its size: pick it from your range" });
  /* every hand-built ducted quote had a return box and a wall controller */
  expect(lines.find((l) => l.name === "Return air box")).toMatchObject({ qty: 1, source: "unknown" });
  expect(lines.find((l) => l.name === "Wall controller")).toMatchObject({ qty: 1, source: "unknown" });
  expect(lines.some((l) => l.name === "Floor boot")).toBe(false);
});

it("a ducted kit under the floor takes floor grilles on boots and hangs the indoor on springs (3377)", () => {
  const lines = expandKit("ducted", { ...facts, outlets: 6, outletMm: 200, underfloor: true }, [...book, product("FLOOR GRILLE 350X150 ANODISED", 3500), product("UNI BOOT 350X150 200MM", 2800), product("SPRING HANGER 15-30KG", 2286)], at);
  expect(lines.find((l) => l.name === "FLOOR GRILLE 350X150 ANODISED")).toMatchObject({ qty: 6 });
  expect(lines.find((l) => l.name === "UNI BOOT 350X150 200MM")).toMatchObject({ qty: 6 });
  expect(lines.find((l) => l.name === "SPRING HANGER 15-30KG")).toMatchObject({ qty: 4 });
  expect(lines.some((l) => /DIFFUSER/i.test(l.name ?? ""))).toBe(false);
});

/* Isaac, 2026-10-15, on 3231's "8 × Ø200 flex, 8 boots", sizes no brief
   gave: "It needs to be decided by the brief" */
it("puts a floor boot on only at the outlets' size given, and none at a size nobody said", () => {
  const boots = [product("UNI BOOT 350X150 150MM", 2500), product("UNI BOOT 350X150 200MM", 2800)];
  const sized = expandKit("ducted", { ...facts, outlets: 6, outletMm: 200, underfloor: true }, [...book, ...boots], at);
  expect(sized.find((l) => /BOOT/.test(l.name ?? ""))).toMatchObject({ name: "UNI BOOT 350X150 200MM", qty: 6 });
  const unsized = expandKit("ducted", { ...facts, outlets: 6, underfloor: true }, [...book, ...boots], at);
  expect(unsized.find((l) => /boot/i.test(l.name ?? ""))).toMatchObject({ name: "Floor boot", qty: 6, costCents: 0, source: "unknown", why: "Needs the outlets' size" });
  expect(unsized.find((l) => l.name === "Flex duct")).toMatchObject({ source: "unknown" });
});

it("reads a unit's pipe off its data pack's connections, and makes a person's facts safe", async () => {
  const { pipeFromMm, normaliseKitFacts } = await import("../kits");
  expect(pipeFromMm(9.52, 15.88)).toBe("3/8+5/8");
  expect(pipeFromMm(6.35, 12.7)).toBe("1/4+1/2");
  expect(pipeFromMm(22.22, 41.28)).toBeNull();
  expect(normaliseKitFacts({ pipe: "1/4+1/2", pipeM: "20", powerM: -3, amps: "abc", mount: "roof", outlets: 99 })).toEqual({
    pipe: "1/4+1/2",
    pipeM: 20,
    powerM: null,
    amps: null,
    mount: "ground",
    trunkingM: null,
    drainM: null,
    outlets: 40,
    outletMm: null,
    replacing: false,
    keptPipe: null,
    underfloor: false,
  });
  expect(normaliseKitFacts({ replacing: "keep", keptPipe: "3/8+5/8" })).toMatchObject({ replacing: true, keptPipe: "3/8+5/8" });
  expect(normaliseKitFacts({ replacing: "yes", keptPipe: "3/8+5/8" })).toMatchObject({ replacing: true, keptPipe: null });
});

it("prices each part at the business's example, with every item of its kind in the book under it", async () => {
  const { kitPreview } = await import("../kits");
  const book2 = [...book, product("METAL Y 400.300.300 NSW", 2906), product("METAL Y 300.200.200 NSW", 2275), product("MEA N/C 12-16kW 1330x271 - 2x400", 16254)];
  const f = { ...facts, outlets: 6, outletMm: 200, ...indoorFacts({ model: "PEA-M125HAA", air: { supply: { w: 1330, h: 271 }, ret: null, returnSpigots: true } }), takeoffs: [400, 400], fittings: [{ inMm: 400, outsMm: [300, 300], count: 1 }] };
  const p = kitPreview("ducted", f, book2, null);
  const part = (key: string) => p.parts.find((x) => x.key === key)!;
  expect(part("supply-plenum")).toMatchObject({ rule: "One on the unit's supply", sizedBy: "Fits the indoor unit: its model and its face" });
  expect(part("supply-plenum").lines[0]).toMatchObject({ name: "MEA N/C 12-16kW 1330x271 - 2x400", known: true, totalCents: 16254 });
  /* every Y in the book, ticked until the business narrows it, the one used marked */
  expect(part("ys").range!.items.map((i) => [i.words, i.ticked, i.used])).toEqual([
    ["Ø400 → Ø300 / Ø300", true, true],
    ["Ø300 → Ø200 / Ø200", true, false],
  ]);
  expect(part("ys").range!.held).toBe(false);
  /* its return takes spigots: no return plenum */
  expect(p.parts.some((x) => x.key === "return-plenum")).toBe(false);
  /* a business's range: only its items ticked */
  const ranges = new Map([["fitting" as const, [{ size: { ins: [400], outs: [300, 300] }, perUnitCents: 2906, supplierKey: "s1", code: book2.at(-3)!.offers[0]!.code, name: "METAL Y 400.300.300 NSW" }]]]);
  const held = kitPreview("ducted", f, book2, { ranges, components: {} });
  expect(held.parts.find((x) => x.key === "ys")!.range!.items.map((i) => i.ticked)).toEqual([true, false]);
});

it("adds the business's own allowances: consumables always, recovery and a flush when an old system comes out", () => {
  const allowances = { consumables: 3182, flush: null, recovery: 15000 };
  const plain = expandKit("split", facts, book, at, allowances).filter((l) => l.group === "Allowances");
  expect(plain.map((l) => [l.name, l.costCents, l.source])).toEqual([["Consumables", 3182, "assumed"]]);
  const swap = expandKit("split", { ...facts, replacing: true }, book, at, allowances).filter((l) => l.group === "Allowances");
  expect(swap.map((l) => [l.name, l.costCents, l.source, l.why])).toEqual([
    ["Consumables", 3182, "assumed", "your allowance, a head"],
    ["Refrigerant recovery and removal", 15000, "assumed", "your allowance, a system"],
    ["Pipe flush", 0, "unknown", "Not set in Quoting"],
  ]);
  expect(expandKit("split", facts, book, at).some((l) => l.group === "Allowances")).toBe(false);
});

/* SWAPS (slice 9.1): the old pipe stays only at the size the new unit's data
   pack gives; anything else is new pipe, saying why (3304's 1/2" liquid). */
describe("an old system's pipe, kept", () => {
  const allowances = { consumables: null, flush: 9000, recovery: 15000 };
  it("leaves the pipe off when it's the size the unit takes, and says so on the flush", () => {
    const lines = expandKit("split", { ...facts, replacing: true, keptPipe: "1/4+1/2" }, book, at, allowances);
    expect(lines.some((l) => /PAIRED COIL/.test(l.name ?? ""))).toBe(false);
    expect(lines.find((l) => l.name === "Pipe flush")).toMatchObject({ costCents: 9000, why: "your allowance, a system; the old 1/4 + 1/2 kept, the size the unit takes" });
  });
  it("prices new pipe when the old isn't the unit's size, saying why", () => {
    const lines = expandKit("split", { ...facts, replacing: true, keptPipe: "3/8+5/8" }, book, at, allowances);
    expect(lines[0]).toMatchObject({ name: "PAIRED COIL 1/4+1/2X20M", source: "fitted", why: "the old 3/8 + 5/8 isn't the 1/4 + 1/2 the unit takes; 20 m pipe run; cheapest" });
    expect(lines.find((l) => l.name === "Pipe flush")!.why).toBe("your allowance, a system");
    /* 3304: a 1/2" liquid line is no new split's */
    expect(expandKit("split", { ...facts, replacing: true, keptPipe: "1/2+7/8" }, book, at)[0]!.why).toMatch(/^the old 1\/2 \+ 7\/8 isn't the 1\/4 \+ 1\/2/);
  });
  it("can't check the old pipe without the unit's", () => {
    const lines = expandKit("split", { ...facts, pipe: null, replacing: true, keptPipe: "1/4+1/2" }, book, at);
    expect(lines[0]).toMatchObject({ name: "Pair coil", source: "unknown", why: "Needs the unit's details to check the old pipe" });
  });
});

/* Isaac, 2026-10-10: "I notice you've got to check consumables not known yet.
   That could be an estimate. And we can confirm that" */
describe("consumables with no allowance set: an estimate from the book", () => {
  const consumables = [
    product("NITTO DUCT TAPE GREY 48mm x 30M", 345),
    product("CABLE TIE WHITE 4.5 x 200mm PK100", 396),
    product("BOSTIK 40-317 DUCT SEALANT 280ML", 765),
    product("BOSTIK SILICONE GREY 300ML", 801),
    product("SKY BROWN TIP BRAZING ALLOY 900MM STICK", 2293),
  ];
  const allowances = { consumables: null, flush: null, recovery: null };

  it("prices what an install of its kind uses from the business's own items, saying what", () => {
    expect(consumablesEstimate("ducted", [...book, ...consumables])).toEqual({
      costCents: 2 * 345 + 396 + 765 + 801 + 2 * 2293,
      words: "duct tape x2, cable ties, duct sealant, silicone, brazing rods x2",
    });
    expect(consumablesEstimate("split", [...book, ...consumables])).toEqual({ costCents: 345 + 396 + 801, words: "duct tape, cable ties, silicone" });
    /* a book with none of them: no estimate */
    expect(consumablesEstimate("split", book)).toBeNull();
  });

  it("puts it on the kit as an estimate to confirm; a set allowance stands, and with neither it's not known yet", () => {
    const line = expandKit("split", facts, [...book, ...consumables], at, allowances).find((l) => l.name === "Consumables");
    expect(line).toMatchObject({ costCents: 1542, source: "assumed", estimate: true, why: "An estimate from your book: duct tape, cable ties, silicone" });
    expect(expandKit("split", facts, [...book, ...consumables], at, { ...allowances, consumables: 3182 }).find((l) => l.name === "Consumables")).toMatchObject({ costCents: 3182, why: "your allowance, a head" });
    expect(expandKit("split", facts, book, at, allowances).find((l) => l.name === "Consumables")).toMatchObject({ costCents: 0, source: "unknown", why: "Not set in Quoting" });
  });
});

/* Isaac, 2026-10-11, kits round 2: "the Y branches should be all of the Y
   branch combinations… supply plenum and return plenum… it depends on the
   unit. Reducer, same thing… return grille again, range of sizes". Real
   names from AAD's and Reece's books; 3377's PEA-M125HAA under the floor. */
describe("a ducted kit sized by its unit and its layout", () => {
  const ducted = [
    product("MEA N/C 10kW 1330x271 - 2x350", 16254),
    product("MEA N/C 12-16kW 1330x271 - 2x400", 16254),
    product("MEA N/C 10-12kW 1360x180 - 2x350", 10680),
    product("R/AIR PLENUM 1062 X 351 + 2 X 350 SPIGOT (EA)", 6270),
    product("METAL Y 400.300.300 NSW", 2906),
    product("METAL Y 300.200.200 NSW", 2275),
    product("AIRLOC SMARTFIT REDUCER 400 - 300", 1715),
    product("EGGCRATE HIGH STATIC FILTER 900X550 NSW", 7966),
    product("EGGCRATE HIGH STATIC FILTER 900X500 NSW", 7392),
    product("900 X 550 RETURN AIR BOX 2 X 400MM (EA)", 12582),
  ];
  const haa = {
    ...facts,
    outlets: 6,
    outletMm: 200,
    ...indoorFacts({ model: "PEA-M125HAA", air: { supply: { w: 1330, h: 271 }, ret: null, returnSpigots: true } }),
    takeoffs: [400, 400],
    fittings: [
      { inMm: 400, outsMm: [300, 300], count: 1 },
      { inMm: 300, outsMm: [200, 200], count: 3 },
    ],
    reducers: [{ fromMm: 400, toMm: 300, count: 1 }],
    returnGrille: { w: 900, h: 550 },
  };

  it("takes the plenum made for the unit's face, a Y for each split and a reducer where it steps down, each from the book at its size", () => {
    const lines = expandKit("ducted", haa, [...book, ...ducted], at);
    const by = (name: string) => lines.find((l) => l.name === name);
    expect(by("MEA N/C 12-16kW 1330x271 - 2x400")).toMatchObject({ qty: 1, costCents: 16254, why: "made for the PEA-M125HAA's 1330 × 271 supply; in your book" });
    expect(by("METAL Y 400.300.300 NSW")).toMatchObject({ qty: 1 });
    expect(by("METAL Y 300.200.200 NSW")).toMatchObject({ qty: 3, why: "where the main duct splits, Ø300 to Ø200 and Ø200; in your book" });
    expect(by("AIRLOC SMARTFIT REDUCER 400 - 300")).toMatchObject({ qty: 1 });
    /* the grille and its box at the one face, never each other */
    expect(by("EGGCRATE HIGH STATIC FILTER 900X550 NSW")).toMatchObject({ qty: 1, costCents: 7966 });
    expect(by("900 X 550 RETURN AIR BOX 2 X 400MM (EA)")).toMatchObject({ qty: 1 });
    /* its return takes duct straight on: no return plenum */
    expect(lines.some((l) => /plenum/i.test(l.name ?? "") && /r\/air|return/i.test(l.name ?? ""))).toBe(false);
  });

  it("a unit whose return has a face takes the return plenum made for it", () => {
    const lines = expandKit("ducted", { ...haa, ...indoorFacts({ model: "ARTH45KHTA", air: { supply: { w: 921, h: 304 }, ret: { w: 1062, h: 351 }, returnSpigots: false } }) }, [...book, ...ducted], at);
    expect(lines.find((l) => l.name === "R/AIR PLENUM 1062 X 351 + 2 X 350 SPIGOT (EA)")).toMatchObject({ qty: 1, why: "made for the ARTH45KHTA's 1062 × 351 return; in your book" });
    /* no supply plenum for its 921 × 304 face in this book: said, not guessed */
    expect(lines.find((l) => l.name === "Supply plenum")).toMatchObject({ source: "unknown", why: "No supply plenum for the ARTH45KHTA's 921 × 304 face with 2 × Ø400 in your book" });
  });

  it("says a size the book hasn't got, and takes the business's range before the book", () => {
    const lines = expandKit("ducted", { ...haa, fittings: [{ inMm: 350, outsMm: [250, 250], count: 2 }] }, [...book, ...ducted], at);
    expect(lines.find((l) => l.name === "Y branches Ø350 → Ø250 / Ø250")).toMatchObject({ qty: 2, source: "unknown", why: "None at Ø350 → Ø250 / Ø250 in your book" });
    const range = new Map([["fitting" as const, [{ size: { ins: [400], outs: [300, 300] }, perUnitCents: 3100, supplierKey: "s1", code: ducted[4]!.offers[0]!.code, name: "METAL Y 400.300.300 NSW" }]]]);
    const ranged = expandKit("ducted", haa, [...book, ...ducted], at, null, null, { ranges: range, components: {} });
    expect(ranged.find((l) => l.name === "METAL Y 400.300.300 NSW")?.why).toMatch(/your range$/);
  });

  /* the duct contingency is a share of the ductwork (buildup.ts), so a kit's
     ductwork has to say it's ductwork: before it did, every kit-built ducted
     quote priced the business's contingency at nothing (found mapping the
     quote page, 2026-10-15) */
  const air = [...ducted, product("VORTEX FLEX R1.0 200MM X 6M", 2489), product("CONE DIFFUSER 200MM", 1289)];
  const allowances = { consumables: 3182, flush: null, recovery: null };

  it("marks its ductwork for the duct contingency: the plenum to the grilles, never the unit's pipe, power, controls, mounting or drain", () => {
    const lines = expandKit("ducted", haa, [...book, ...air], at, allowances);
    const duct = (name: string) => lines.find((l) => l.name === name)?.duct;
    for (const name of ["MEA N/C 12-16kW 1330x271 - 2x400", "METAL Y 400.300.300 NSW", "AIRLOC SMARTFIT REDUCER 400 - 300", "VORTEX FLEX R1.0 200MM X 6M", "CONE DIFFUSER 200MM", "EGGCRATE HIGH STATIC FILTER 900X550 NSW", "900 X 550 RETURN AIR BOX 2 X 400MM (EA)"])
      expect([name, duct(name)]).toEqual([name, true]);
    for (const name of ["PAIRED COIL 1/4+1/2X20M", "INTERCONNECT 3C+E PER METRE", "TPS 2.5MM 2C+E 100M", "RCBO 20A 30MA 1P+N", "ISOLATOR 20A 2P IP66", "ANTI VIBRATION RUBBER FEET (SET)", "DRAIN HOSE 16MM PER METRE", "Wall controller", "Consumables"])
      expect([name, duct(name)]).toEqual([name, undefined]);
    /* a part not known yet is still ductwork, so it counts once it's priced */
    expect(expandKit("ducted", { ...facts, outlets: 4, outletMm: 200 }, book, at).find((l) => l.name === "Supply plenum")).toMatchObject({ source: "unknown", duct: true });
    /* under the floor: the grilles and their boots are, the springs the indoor hangs on aren't */
    const under = expandKit("ducted", { ...haa, underfloor: true }, [...book, ...air, product("FLOOR GRILLE 350X150 ANODISED", 3500), product("UNI BOOT 350X150 200MM", 2800), product("SPRING HANGER 15-30KG", 2286)], at);
    expect(under.find((l) => l.name === "FLOOR GRILLE 350X150 ANODISED")?.duct).toBe(true);
    expect(under.find((l) => l.name === "UNI BOOT 350X150 200MM")?.duct).toBe(true);
    expect(under.find((l) => l.name === "SPRING HANGER 15-30KG")?.duct).toBeUndefined();
    /* a split has no ductwork */
    expect(expandKit("split", facts, book, at, allowances).some((l) => l.duct)).toBe(false);
  });

  it("a kit-built quote carries the business's duct contingency, kept through the stored line", async () => {
    const { lineFromRow, lineRow, normaliseLine } = await import("../lines");
    const { priceLines } = await import("../lines-price");
    const kept = expandKit("ducted", haa, [...book, ...air], at, allowances).map((l, i) => lineFromRow({ ...lineRow(normaliseLine(l)!), id: `k${i}` })!);
    const settings = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: { pct: 15, hours: 2 } };
    const [o] = priceLines(kept, [], settings, { pct: null, labourCostCents: null });
    const ductwork = kept.filter((l) => l.group === "Ductwork and grilles").reduce((n, l) => n + Math.round(l.costCents * l.qty), 0);
    expect(ductwork).toBeGreaterThan(0);
    const share = Math.round((ductwork * 15) / 100);
    expect(o!.build.contingency).toEqual({ buyCents: share, sellCents: Math.round(share * 1.4), hours: 2 });
  });
});

it("takes only a sane layout: duct sizes a book sells, a split into two or more, a step down", async () => {
  const { normaliseKitFacts } = await import("../kits");
  const f = normaliseKitFacts({
    takeoffs: [400, "400", 333, 9000],
    fittings: [{ inMm: 400, outsMm: [300, 300], count: 2 }, { inMm: 400, outsMm: [300] }, { inMm: "junk", outsMm: [200, 200] }],
    reducers: [{ fromMm: 400, toMm: 300 }, { fromMm: 300, toMm: 400 }],
    returnGrille: { w: 900, h: 550 },
  });
  expect(f).toMatchObject({ takeoffs: [400, 400], fittings: [{ inMm: 400, outsMm: [300, 300], count: 2 }], reducers: [{ fromMm: 400, toMm: 300, count: 1 }], returnGrille: { w: 900, h: 550 } });
  /* none given: a kit says it needs the layout */
  expect(normaliseKitFacts({})).not.toHaveProperty("fittings");
});

it("lists what a kit left to size or price, for Tiff to settle", () => {
  const lines = expandKit("ducted", { ...facts, outlets: 4, outletMm: 200 }, book, at);
  expect(stillToSize(lines).map((x) => x.name)).toEqual(expect.arrayContaining(["Supply plenum", "Y branches", "Return air grille, filtered", "Return air box"]));
  expect(stillToSize(lines).find((x) => x.name === "Y branches")!.why).toBe("Needs the layout: where the main duct splits");
});

/* Isaac, 2026-10-13, on 3231: the PAR-41MAAM is the standard controller "but
   it is not compatible with the zone control box". Zoned, the kit takes the
   maker's zone system from its pack: its own controller, never the unit's. */
describe("a zoned ducted system", () => {
  const me = (zoning as unknown as ZoningController[])[0]!;

  it("takes the maker's interface for the zones, its own controller, a sensor a zone and the receiver, from its pack", () => {
    expect(zoneKitOf(me, 5, "temperature", true)).toEqual({
      zones: 5,
      control: "temperature",
      interface: "PAC-ZC10L240C-A",
      mainController: "PAR-ZM01A-A",
      receiver: "PAR-ZR01R-A",
      sensor: "PAR-ZR01S-A",
      wifi: "MAC-588IF-E",
      from: "Mitsubishi Electric Zone Controller with Intelligent Comfort Brochure 2026",
    });
    expect(zoneKitOf(me, 4, "on_off", false)).toMatchObject({ interface: "PAC-ZC04S240C-A", sensor: null, receiver: null, wifi: null });
    expect(zoneKitOf(me, 12, "temperature", false).interface).toBeNull();
  });

  it("puts the zone system's controller on in place of the unit's wall controller", () => {
    const zbook = [
      ...book,
      product("WIRED CONTROLLER WITH BACKLIT LCD PAR-41MAAM", 12530),
      product("ZONE CONTROLLER INTERFACE 10 ZONE LINEAR PAC-ZC10L240C-A", 57820),
      product("ME ACC SMART ZONE CONTROLLER PAR-ZM01A-A", 30000),
      product("WIRELESS RECEIVER PAR-ZR01R-A", 6860),
      product("WIRELESS SENSOR PAR-ZR01S-A", 5530),
      product("WI-FI INTERFACE MAC-588IF-E", 7344),
    ];
    const lines = expandKit("ducted", { ...facts, zoning: zoneKitOf(me, 5, "temperature", true) }, zbook, at);
    const names = lines.map((l) => l.name);
    expect(names).toContain("ME ACC SMART ZONE CONTROLLER PAR-ZM01A-A");
    expect(names).not.toContain("WIRED CONTROLLER WITH BACKLIT LCD PAR-41MAAM");
    expect(lines.find((l) => l.name === "ME ACC SMART ZONE CONTROLLER PAR-ZM01A-A")!.why).toMatch(/^the zone system's own controller, in place of the unit's/);
    expect(lines.find((l) => l.name === "ZONE CONTROLLER INTERFACE 10 ZONE LINEAR PAC-ZC10L240C-A")).toMatchObject({ qty: 1 });
    expect(lines.find((l) => l.name === "WIRELESS SENSOR PAR-ZR01S-A")).toMatchObject({ qty: 5 });
    expect(lines.find((l) => l.name === "WIRELESS RECEIVER PAR-ZR01R-A")).toMatchObject({ qty: 1 });
    expect(lines.find((l) => l.name === "WI-FI INTERFACE MAC-588IF-E")).toMatchObject({ qty: 1 });
    /* not zoned: the unit's own wall controller, and nothing of a zone system */
    const plain = expandKit("ducted", facts, zbook, at).map((l) => l.name);
    expect(plain).toContain("WIRED CONTROLLER WITH BACKLIT LCD PAR-41MAAM");
    expect(plain.some((n) => /PAR-ZM01A-A|PAC-ZC10L/.test(n ?? ""))).toBe(false);
  });

  /* 2026-10-15: "5 zones" with the kit form's pack left on None added a kit
     with no zone parts, and nothing to settle said so */
  it("zones asked for and no zone system read: the interface is a line not known yet, saying why, for Tiff to settle", () => {
    const lines = expandKit("ducted", { ...facts, zones: 5, zoneControl: "temperature", wifi: true }, book, at);
    expect(lines.find((l) => l.name === "Zone interface")).toMatchObject({ qty: 1, costCents: 0, source: "unknown", why: "Needs the maker's zone system: none read off the unit's data pack" });
    expect(stillToSize(lines).map((x) => x.name)).toContain("Zone interface");
    /* read, and none of its interfaces takes that many: said as before */
    const many = expandKit("ducted", { ...facts, zones: 12, zoning: zoneKitOf(me, 12, "temperature", false) }, book, at);
    expect(many.find((l) => l.name === "Zone interface")).toMatchObject({ source: "unknown", why: "None of the maker's zone interfaces takes this many zones" });
    /* not zoned: no zone line at all */
    expect(expandKit("ducted", facts, book, at).some((l) => l.name === "Zone interface")).toBe(false);
  });

  it("reads the zones, the control and WiFi from what Tiff or a person gave", () => {
    expect(normaliseKitFacts({ zones: 5, zoneControl: "temperature", wifi: true })).toMatchObject({ zones: 5, zoneControl: "temperature", wifi: true });
    const none = normaliseKitFacts({ zones: "lots", zoneControl: "fast" });
    expect(none).not.toHaveProperty("zones");
    expect(none).not.toHaveProperty("zoneControl");
    expect(none).not.toHaveProperty("wifi");
  });
});

/* the bench, 15 October: the business's preferred PAR-41MAAM went on a
   Daikin and on a Fujitsu ducted unit as their wall controller */
describe("a ducted kit's wall controller", () => {
  const me = product("PAR-41MAAM WIRED REMOTE CONTROLLER", 9800, { brand: "Mitsubishi Electric" });
  const dai = product("DAIKIN MADOKA WIRED CONTROLLER BRC1H63W", 14500, { brand: "Daikin" });
  const prefs = { ranges: new Map(), components: { wall_controller: { supplierKey: "s1", code: me.offers[0]!.code, rollM: null } } };
  const controllerOf = (brand: string | null, books: Product[]) => {
    const f = brand ? { ...facts, brand } : facts;
    return expandKit("ducted", f, [...book, ...books], { optionIndex: 0, system: "Ducted" }, null, null, prefs).find((l) => l.group === "Pipe, power and controls" && /controller/i.test(String(l.why) + l.name));
  };

  it("is the unit's own maker's: the business's preferred only when it's that maker's", () => {
    expect(controllerOf("daikin", [me, dai])).toMatchObject({ name: dai.name, source: "assumed" });
    expect(controllerOf("mitsubishi-electric", [me, dai])).toMatchObject({ name: me.name, why: expect.stringMatching(/your preferred/i) });
  });

  it("goes on as not known yet when the book has none of that maker's", () => {
    expect(controllerOf("fujitsu", [me, dai])).toMatchObject({ name: "Wall controller", source: "unknown", costCents: 0 });
  });

  it("is the business's preferred when the unit's maker isn't known, as before", () => {
    expect(controllerOf(null, [me, dai])).toMatchObject({ name: me.name });
  });
});
