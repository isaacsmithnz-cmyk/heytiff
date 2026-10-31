/* One part at two suppliers, on names from the business's real price
   files (2026-09-30). */
import { decidedKey, modelsWithoutSuffix, productsOf, proposeSameItems, sameProductRefs, sizesOf, type SameItem } from "../same-items";

const aad = (code: string, name: string): SameItem => ({ supplierKey: "aad", code, name });
const reece = (code: string, name: string): SameItem => ({ supplierKey: "reece", code, name });

describe("sizesOf", () => {
  it("reads pipe sizes, lengths, ranges and colours", () => {
    const s = sizesOf('ARDENT PR CU 1/4" X 1/2" R410A 20M (COIL)');
    expect([...s.get("inch")!]).toEqual(["1/4", "1/2"]);
    expect([...s.get("m")!]).toEqual(["20"]);
    expect([...sizesOf("FLEX DRAIN HOSE 50M 16-18mm").get("mm")!].sort()).toEqual(["16", "18"]);
    expect([...sizesOf("DURA FLEX COND DRAIN HOSE(16/18MM) 50MT (COIL)").get("mm")!].sort()).toEqual(["16", "18"]);
    expect(sizesOf("DURA FLEX COND DRAIN HOSE(16/18MM) 50MT (COIL)").has("inch")).toBe(false);
    expect([...sizesOf("WEATHERPROOF ISOLATOR 2 POLE 20 AMPS (EA)").get("amps")!]).toEqual(["20"]);
    expect([...sizesOf("NITTO DUCT TAPE BLACK 48mm x 30M").get("colour")!]).toEqual(["BLACK"]);
  });
});

describe("proposeSameItems", () => {
  it("pairs AAD's and Reece's pair coil of the same sizes and length", () => {
    const p = proposeSameItems(
      [
        aad("PC1412", "PAIRED COIL 1/4+1/2X20M (6.35-12.7) 9mm (R.61/.52)"),
        aad("PC51412", "PAIRED COIL 1/4 + 1/2 X 5M 9mm(R.61/.52)"),
        reece("9800006-1", 'ARDENT PR CU 1/4" X 1/2" R410A 20M (COIL)'),
        reece("9800005-1", 'ARDENT PR CU 1/4" X 3/8" R410A 20M (COIL)'),
        reece("9800168-1", "ARDENT PR CU FR 13MM 1/4-1/2 R410A 20M (COIL)"),
      ],
      new Set()
    );
    expect(p.map((x) => [x.a.code, x.b.code, x.why])).toEqual([["PC1412", "9800006-1", "size"]]);
    expect(p[0]!.shared).toEqual(["1/4", "1/2", "20 m"]);
  });

  it("pairs an item whose code is written in the other's name, but not an accessory for it", () => {
    const p = proposeSameItems(
      [
        aad("FP1056", "ASPEN MINI TANK CONDENSATE PUMP"),
        reece("2702604-1", "ASPEN MINI TANK PUMP 35LTR/HR FP1056 (EA)"),
        aad("PAR-41MAAM", "ME ACC WIRED CONTROLLER W/ BACKLIGHT"),
        { supplierKey: "mitsubishi", code: "PAC-SH29TC-E", name: "Terminal Block (for PAR-41MAAM)" },
      ],
      new Set()
    );
    expect(p.map((x) => [x.a.code, x.b.code, x.why])).toEqual([["FP1056", "2702604-1", "mentioned"]]);
  });

  it("never pairs a kit with a single unit, and never proposes a pair already decided", () => {
    const items = [
      aad("DXK09ZSA-WF1", "MHI AVANTI HWS IND 2.5KW R/C INV WIFI"),
      reece("3102873-1", "MHI WHS AC DXK09ZSA-WF1 AVANTI SET 2.5KW (KIT)"),
      reece("3102874-1", "MHI WHS AC DXK09ZSA-WF1 AVANTI IDU 2.5KW (EA)"),
    ];
    expect(proposeSameItems(items, new Set()).map((x) => x.b.code)).toEqual(["3102874-1"]);
    expect(proposeSameItems(items, new Set([decidedKey("aad|DXK09ZSA-WF1", "reece|3102874-1")]))).toEqual([]);
  });

  it("offers a supplier's pack sizes of one part once", () => {
    const p = proposeSameItems(
      [
        aad("FDH1618", "FLEX DRAIN HOSE 50M 16-18mm"),
        reece("9502294-1", "DURA FLEX COND DRAIN HOSE(16/18MM) 50MT (COIL)"),
        reece("9502294-2", "DURA FLEX COND DRAIN HOSE(16/18MM) 50MT (MTR)"),
      ],
      new Set()
    );
    expect(p).toHaveLength(1);
  });
});

describe("productsOf", () => {
  it("joins a shared code, a supplier's pack sizes and confirmed pairs into one product", () => {
    const p = productsOf(
      [
        { supplierKey: "aad", code: "PC1412" },
        { supplierKey: "reece", code: "9800006-1" },
        { supplierKey: "reece", code: "9800006-2" },
        { supplierKey: "mitsubishi", code: "MSZ-AP25VGD" },
        { supplierKey: "aad", code: "MSZ-AP25VGD" },
        { supplierKey: "aad", code: "ALONE" },
      ],
      [["aad|PC1412", "reece|9800006-1"]]
    );
    expect(p.get("reece|9800006-2")).toBe("aad|PC1412");
    expect(p.get("reece|9800006-1")).toBe("aad|PC1412");
    expect(p.get("mitsubishi|MSZ-AP25VGD")).toBe(p.get("aad|MSZ-AP25VGD"));
    expect(p.has("aad|ALONE")).toBe(false);
  });
});

/* The price book takes a preference off a part's other codes; which codes
   those are is worked out from the book, never from the page (2026-10-05). */
describe("sameProductRefs", () => {
  it("names every code of the part: the same code elsewhere, a pack size, a confirmed pair", () => {
    const items = [
      { supplierKey: "aad", code: "PC1412" },
      { supplierKey: "jz_electrical", code: "PC1412" },
      { supplierKey: "reece", code: "9800006-1" },
      { supplierKey: "reece", code: "9800006-2" },
      { supplierKey: "aad", code: "PC1438" },
    ];
    expect(sameProductRefs(items, [["aad|PC1412", "reece|9800006-1"]], "reece|9800006-2").sort()).toEqual([
      "aad|PC1412",
      "jz_electrical|PC1412",
      "reece|9800006-1",
      "reece|9800006-2",
    ]);
    /* a part of its own is only itself */
    expect(sameProductRefs(items, [], "aad|PC1438")).toEqual(["aad|PC1438"]);
  });
});

/* Isaac, 2026-10-05: "AAD, they've got Fujitsu Lifestyle Indoor
   AST-09KMTC… $200, but that's just the indoor head. The other side is the
   entire kit" — Reece names the whole system by the head's code. */
describe("units", () => {
  const maker = (code: string, name: string): SameItem => ({ supplierKey: "maker", code, name });

  it("proposes a wholesaler's code and the maker's, the same code with its suffix, any brand", () => {
    const p = proposeSameItems(
      [
        aad("PUZ-ZM140YKA2", "MITSUBISHI ELEC. DUCT OUT 14KW 3PH R32"),
        maker("PUZ-ZM140YKA2-A.TH", "R32 Power Inverter Outdoor - Three Phase"),
        aad("FTXM35WV", "DAIKIN HWS IND 3.5KW"),
        maker("FTXM35WV.E", "Wall Mounted Indoor"),
      ],
      new Set()
    );
    expect(p.map((x) => [x.why, x.shared[0], x.a.code, x.b.code])).toEqual([
      ["model", "PUZ-ZM140YKA2", "PUZ-ZM140YKA2", "PUZ-ZM140YKA2-A.TH"],
      ["model", "FTXM35WV", "FTXM35WV", "FTXM35WV.E"],
    ]);
  });

  it("keeps a same-model pair out once it's been decided, and when their sizes disagree", () => {
    const items = [aad("PEA-M100GAA", "DUCTED IND 10KW"), maker("PEA-M100GAA.TH", "Ducted Unit 12.5KW")];
    expect(proposeSameItems(items, new Set())).toEqual([]);
    const agreed = [aad("PEA-M100GAA", "DUCTED IND 10KW"), maker("PEA-M100GAA.TH", "Ducted Unit")];
    expect(proposeSameItems(agreed, new Set([decidedKey("aad|PEA-M100GAA", "maker|PEA-M100GAA.TH")]))).toEqual([]);
  });

  it("reads digits after the dash as a size, not a maker's suffix", () => {
    expect(modelsWithoutSuffix("SHSD595-350")).toEqual([]);
    expect(modelsWithoutSuffix("PUZ-ZM140YKA2-A.TH")).toEqual(["PUZ-ZM140YKA2-A", "PUZ-ZM140YKA2"]);
    /* never down to a word or a series */
    expect(modelsWithoutSuffix("KIT-A")).toEqual([]);
  });

  it("never proposes an indoor head as the whole system it belongs to", () => {
    const p = proposeSameItems(
      [
        aad("ASTG09KMTC", "FUJITSU LIFESTYLE R/C HWS IND 2.5KW"),
        reece("3102341-1", "FUJITSU WALL MOUNTED AC ASTG09KMTC 2.5KW (EA)"),
        aad("DXK09ZSA-WF1", "MHI AVANTI HWS IND 2.5KW R/C INV WIFI"),
        reece("3102874-1", "MHI WHS AC DXK09ZSA-WF1 AVANTI IDU 2.5KW (EA)"),
      ],
      new Set()
    );
    /* the MHI head against the MHI head still is one part */
    expect(p.map((x) => [x.a.code, x.b.code])).toEqual([["DXK09ZSA-WF1", "3102874-1"]]);
  });
});

/* Isaac's walk, 27 October 2026: half of Matching's nine were plainly two
   things, and "a universal fix, not just tailored to us". So the rules are
   the trade's, whatever a supplier calls its cable. */
describe("cable", () => {
  const ge = (code: string, name: string): SameItem => ({ supplierKey: "ge", code, name });
  const vx = (code: string, name: string): SameItem => ({ supplierKey: "vx", code, name });
  const pairs = (items: SameItem[]) => proposeSameItems(items, new Set()).map((x) => [x.a.name, x.b.name]);

  it("reads a cable's cores, however a supplier writes them", () => {
    const cores = (name: string) => [...(sizesOf(name).get("cores") ?? [])];
    expect(cores("3 CORE & EARTH ORANGE CABLE 1.5MM X 100M (COIL)")).toEqual(["3C+E"]);
    expect(cores("Flat TPS 3C +E A/ C 7/0. 5 1.5mm PVC/ PVC Blue")).toEqual(["3C+E"]);
    expect(cores("Cable Tps 2.5Mm 7/067 2C+E100M per metre")).toEqual(["2C+E"]);
    expect(cores("1.5mm TPS Twin and Earth Flat Cable - 100m Roll")).toEqual(["2C+E"]);
    expect(cores("1.5MM 1 PAIR CORE SHIELDED CABLE 100MTR (ROLL)")).toEqual(["1 pair"]);
    expect(cores("Cat6 10G Cable 4Pr UnShielded LSZH Sheath Blue 305m")).toEqual(["4 pair"]);
    expect(cores("SDI 6MM SINGLE CORE BLACK 100M")).toEqual(["1 core"]);
    /* a pair coil is no pair of cores */
    expect(cores('ARDENT PR CU 1/4" X 1/2" R410A 20M (COIL)')).toEqual([]);
  });

  it("never pairs three core and earth, or a shielded pair, with twin and earth", () => {
    const te = vx("TPS15", "1.5mm TPS Twin and Earth Flat Cable - 100m Roll");
    expect(pairs([ge("A", "3 CORE & EARTH ORANGE CABLE 1.5MM X 100M (COIL)"), te])).toEqual([]);
    expect(pairs([ge("B", "1.5MM 1 PAIR CORE SHIELDED CABLE 100MTR (ROLL)"), te])).toEqual([]);
    /* twin and earth however it's written still is */
    expect(pairs([ge("C", "Cable Tps 1.5Mm 2C+E 100M per metre"), te])).toEqual([["Cable Tps 1.5Mm 2C+E 100M per metre", te.name]]);
  });

  it("never pairs data, shielded, flex or circular cable with flat power cable", () => {
    const flat = vx("TPS25", "2.5mm TPS 2C+E Flat Cable 100m");
    for (const name of [
      "Cat6 Data Cable 2.5mm 100m",
      "2.5mm 2C+E Screened Cable 100m",
      "Flex Cable 2C+E 2.5mm 100m",
      "Circular 2C+E 2.5mm 100m Cable",
    ])
      expect([name, pairs([ge("X", name), flat])]).toEqual([name, []]);
    /* one data cable with another of the same length and colour still is */
    expect(pairs([ge("D", "Cat6 10G Cable 4Pr UnShielded LSZH Sheath Blue 305m"), vx("E", "Cat6 Data Cable - UTP; 305m; Blue")])).toHaveLength(1);
  });

  it("never pairs a cable with its ties, nor ties with clips", () => {
    expect(pairs([ge("F", "Flex Cable O/ D 2C +E 2.5mm PVC/ PVC Black per metre"), vx("G", "100 x 2.5mm Nylon Cable Ties - Black; 100 Pack")])).toEqual([]);
    expect(pairs([ge("H", "Cable Tie Nylon Black 300mm 4.8mm"), vx("I", "Cable Clip Black 300mm 4.8mm")])).toEqual([]);
    /* ties with ties of the same size still are */
    expect(pairs([ge("J", "Cable Tie Nylon Std Duty Black L300 mm W4.8 mm"), vx("K", "B/LAND CABLE TIES 300MM X 4.8MM - BLACK (PACK)")])).toHaveLength(1);
  });
});
