/* One part at two suppliers, on names from the business's real price
   files (2026-09-30). */
import { decidedKey, productsOf, proposeSameItems, sameProductRefs, sizesOf, type SameItem } from "../same-items";

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
