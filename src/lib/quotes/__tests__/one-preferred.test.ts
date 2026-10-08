/* One preferred store (slice 1.2, whole-range on Isaac's word): an item
   chosen at one size makes its line the range at every size, and kits pick
   from the range, then Quoting's preferred items, before searching. */
import type { Product } from "../families";
import { chosenFor, expandKit, KITS } from "../kits";
import { rangeKindOf, sameSize, wholeRange } from "../ranges";

const offer = (supplierKey: string, code: string, cents: number, name: string) => ({ supplierKey, supplierName: supplierKey.toUpperCase(), code, name, netCents: cents });
const product = (name: string, offers: ReturnType<typeof offer>[]): Product =>
  ({ key: `${offers[0]!.supplierKey}|${offers[0]!.code}`, name, category: "parts", offers, cheapest: offers[0]!, preferred: null, brand: null, quotes: 0 }) as Product;

describe("whole-range preferred", () => {
  it("makes the chosen item's line the range at every size, over another line's at those sizes", () => {
    const line = [
      { code: "VB200", size: { mm: 200 } },
      { code: "VB250", size: { mm: 250 } },
      { code: "VB300", size: { mm: 300 } },
    ];
    const held = [
      { supplierKey: "reece", code: "FLX250", size: { mm: 250 } },
      { supplierKey: "reece", code: "FLX450", size: { mm: 450 } },
    ];
    const { add, remove } = wholeRange("flex_duct", line, "aad", held);
    expect(add.map((a) => a.code)).toEqual(["VB200", "VB250", "VB300"]);
    /* the 450 the AAD line doesn't come in stays */
    expect(remove).toEqual([{ supplierKey: "reece", code: "FLX250" }]);
  });

  it("knows an isolator's size by its amps, and a range by the line a swap replaced", () => {
    expect(sameSize("isolator", { amps: 20, poles: 2 }, { amps: 20, poles: null })).toBe(true);
    expect(sameSize("isolator", { amps: 20 }, { amps: 35 })).toBe(false);
    expect(rangeKindOf("METAL BTO 350.250.250")).toBe("fitting");
    expect(rangeKindOf("Isolator 20A 2 pole")).toBe("isolator");
    expect(rangeKindOf("Rubber feet")).toBeNull();
  });
});

describe("a kit picks what the business chose first", () => {
  const BOOK = [
    product("FLEX DUCT 250 6M", [offer("reece", "FD250", 2900, "FLEX DUCT 250 6M")]),
    product("AAD VORTEX VB250 6M", [offer("aad", "VB250", 3045, "AAD VORTEX VB250 6M")]),
    product("PAIRED COIL 1/4+1/2X20M", [offer("aad", "PC1412", 19100, "PAIRED COIL 1/4+1/2X20M")]),
    product("ARDENT PR CU 1/4 X 1/2 20M", [offer("reece", "9800006-1", 18000, "ARDENT PR CU 1/4 X 1/2 20M")]),
  ];
  const ranges = new Map([["flex_duct" as const, [{ size: { mm: 250 }, perUnitCents: 3045, supplierKey: "aad", code: "VB250", name: "AAD VORTEX VB250 6M" }]]]);
  const flex = KITS.ducted.parts.find((p) => p.key === "flex")!;
  const coil = KITS.split.parts.find((p) => p.key === "pair-coil")!;
  const f = { pipe: "1/4+1/2" as const, pipeM: 10, powerM: null, amps: null, mount: "ground" as const, trunkingM: null, drainM: null, outlets: 3, outletMm: 250 };

  it("its range at the size, over the cheaper item a search would take", () => {
    expect(chosenFor(flex, f, BOOK, { ranges, components: {} }, null)).toMatchObject({ offer: { code: "VB250" }, why: "Your range" });
    const lines = expandKit("ducted", f, BOOK, { optionIndex: 0, system: "Up" }, null, null, { ranges, components: {} });
    expect(lines.find((l) => /250/.test(l.name ?? "") && /flex|vortex/i.test(l.name ?? ""))).toMatchObject({ code: "VB250", why: "a bag to each of 3 outlets; your range" });
  });

  it("Quoting's preferred item for the part, over the cheapest", () => {
    const components = { pair_coil_14_12: { supplierKey: "aad", code: "PC1412", rollM: 20 } };
    expect(chosenFor(coil, f, BOOK, { ranges: new Map(), components }, null)).toMatchObject({ offer: { code: "PC1412" }, why: "Your preferred" });
    /* nothing chosen: the book is searched, the cheapest */
    expect(chosenFor(coil, f, BOOK, { ranges: new Map(), components: {} }, null)).toBeNull();
  });
});
