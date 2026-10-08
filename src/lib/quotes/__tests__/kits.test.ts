import type { Product } from "../families";
import { breakerFor, cableFor, expandKit, isolatorFor, KITS } from "../kits";

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
    "flex", "outlets", "floor-grilles", "boots", "hangers", "return", "return-box", "controller",
  ]);
  const lines = expandKit("ducted", { ...facts, outlets: 5, outletMm: 250 }, [...book, product("VORTEX FLEX R1.0 250MM X 6M", 3045), product("CONE DIFFUSER 250MM", 1887)], at);
  expect(lines.find((l) => l.name === "VORTEX FLEX R1.0 250MM X 6M")).toMatchObject({ qty: 5, costCents: 3045 });
  expect(lines.find((l) => l.name === "CONE DIFFUSER 250MM")).toMatchObject({ qty: 5 });
  expect(lines.find((l) => l.name === "Return air grille, filtered")).toMatchObject({ source: "unknown", why: "Not in your book" });
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

it("lists every kit part at each size as the book prices it today, and what the book hasn't got", async () => {
  const { kitPriceList } = await import("../kits");
  const rows = kitPriceList(book);
  expect(rows.find((r) => r.part === "Pair coil" && r.size === "1/4 + 1/2")!.pick).toMatchObject({ name: "PAIRED COIL 1/4+1/2X20M", cents: 955, perMetre: true });
  expect(rows.find((r) => r.part === "RCBO" && r.size === "20 A")!.pick).toMatchObject({ cents: 3886, perMetre: false });
  /* no 16 A in the book: the next rating up it has */
  expect(rows.find((r) => r.part === "RCBO" && r.size === "16 A")!.pick).toMatchObject({ name: "RCBO 20A 30MA 1P+N" });
  expect(rows.find((r) => r.part === "Outdoor mount" && r.size === "Wall bracket")!.pick).toBeNull();
  expect(rows.filter((r) => r.kit === "ducted").map((r) => r.part)).toContain("Flex duct");
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
