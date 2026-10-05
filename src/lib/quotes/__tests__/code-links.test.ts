/* The pack's model names against the codes they're ordered by — the cases
   read off the live pack and price books (2026-09-30). */
import { codeFeatures, differenceOf, linkModels, nearKey, packAlternatives, partsOf, sameUnitKey, type Decision } from "../code-links";
import { parseInvoicedRows } from "../price-book";

describe("linking a pack model to its order code", () => {
  const book = ["PUHY-P300YNW-A1-AU", "MSZ-AP71VGKD2-A2", "PUMY-SP140VKMD3-A", "PUMY-SP140VKMD2-A", "PEFY-P25VMX-E1", "PUMY-SP140YKMD3-A"];

  it("links a revision or region tag without asking", () => {
    expect(sameUnitKey("PUHY-P300YNW-A1")).toBe(sameUnitKey("PUHY-P300YNW-A1-AU"));
    const [l] = linkModels(["PEFY-P25VMX-E"], book, new Map());
    expect(l).toEqual({ model: "PEFY-P25VMX-E", codes: ["PEFY-P25VMX-E1"], proposed: [], proposals: [] });
  });

  it("proposes the Wi-Fi order code for the brochure's AP name, and links it once confirmed", () => {
    expect(linkModels(["MSZ-AP71VGD2"], book, new Map())[0]).toEqual({
      model: "MSZ-AP71VGD2",
      codes: [],
      proposed: ["MSZ-AP71VGKD2-A2"],
      proposals: [{ codes: ["MSZ-AP71VGKD2-A2"], kind: "wifi", words: "VGD2 → VGKD2, adds Wi-Fi built in (K)" }],
    });
    const yes = new Map<string, Decision>([["MSZ-AP71VGD2|MSZ-AP71VGKD2-A2", "confirmed"]]);
    expect(linkModels(["MSZ-AP71VGD2"], book, yes)[0]!.codes).toEqual(["MSZ-AP71VGKD2-A2"]);
  });

  it("never proposes a rejected code again", () => {
    const no = new Map<string, Decision>([["MSZ-AP71VGD2|MSZ-AP71VGKD2-A2", "rejected"]]);
    expect(linkModels(["MSZ-AP71VGD2"], book, no)[0]!.proposed).toEqual([]);
  });

  it("proposes both builds of a PUMY, newest first, and keeps single and three phase apart", () => {
    expect(nearKey("PUMY-SP140VKMD2-A")).not.toBe(nearKey("PUMY-SP140YKMD3-A"));
    expect(linkModels(["PUMY-SP140VKMD"], book, new Map())[0]!.proposed).toEqual(["PUMY-SP140VKMD3-A", "PUMY-SP140VKMD2-A"]);
    /* the pack's own D2 links exactly to the invoiced D2, and the book's D3
       is still offered to confirm */
    expect(linkModels(["PUMY-SP140VKMD2-A"], book, new Map())[0]).toEqual({
      model: "PUMY-SP140VKMD2-A",
      codes: ["PUMY-SP140VKMD2-A"],
      proposed: ["PUMY-SP140VKMD3-A"],
      proposals: [{ codes: ["PUMY-SP140VKMD3-A"], kind: "build", words: "VKMD2 → VKMD3, a newer build" }],
    });
  });
});

/* Isaac, 2026-10-05: "most matches are a slight variant in model code…
   should it just group similar units?" — the cases off the live pack and
   price books that day. */
describe("near units, one decision each, in groups by what differs", () => {
  const book = [
    "PUMY-P200YKMD2-A",
    "PUMY-P200YKM3-A",
    "MFZ-KW25VGK-A2",
    "MFZ-KW25VGK-A1",
    "MUZ-AP25VGD2-A2",
    "PAC-KE92PTB-E",
    "PEAD-M50JAAD.TH",
    "PEAD-M50JAAD",
    "PEAD-M100JAADR1.TH",
    "PKA-M71KAL3.TH",
    "PKA-M71KAL3",
    "PAR-CT01MAA-PB",
    "PAR-CT01MAA-SB",
    "MXZ-4F80VGD-A2",
    "MUZ-LN25VGD-A1",
    "PEA-M100HAA",
    "MLZ-KP25VG-A1",
  ];
  const one = (model: string) => linkModels([model], book, new Map())[0]!;

  it("reads the pack's shorthand: a letter in brackets, either colour after a slash", () => {
    expect(packAlternatives("PEAD-M50JAA(D)")).toEqual(["PEAD-M50JAA", "PEAD-M50JAAD"]);
    expect(packAlternatives("PKA-M71KA(L)2")).toEqual(["PKA-M71KA2", "PKA-M71KAL2"]);
    expect(packAlternatives("PAR-CT01MAA-PB/SB")).toEqual(["PAR-CT01MAA-PB", "PAR-CT01MAA-SB"]);
    expect(one("PEAD-M50JAA(D)").codes).toEqual(["PEAD-M50JAAD.TH", "PEAD-M50JAAD"]);
    expect(one("PEAD-M100JAA(D)").codes).toEqual(["PEAD-M100JAADR1.TH"]);
    expect(one("PAR-CT01MAA-PB/SB").codes).toEqual(["PAR-CT01MAA-SB", "PAR-CT01MAA-PB"]);
  });

  it("makes a unit's revisions and suppliers one decision, and says what it differs by", () => {
    expect(one("MFZ-KW25VG").proposals).toEqual([{ codes: ["MFZ-KW25VGK-A2", "MFZ-KW25VGK-A1"], kind: "wifi", words: "VG → VGK, adds Wi-Fi built in (K)" }]);
    expect(one("PUMY-P200YKMD2-A")).toMatchObject({
      codes: ["PUMY-P200YKMD2-A"],
      proposals: [{ codes: ["PUMY-P200YKM3-A"], kind: "build", words: "YKMD2 → YKM3, a newer build" }],
    });
    expect(one("MUZ-AP25VG2").proposals).toEqual([{ codes: ["MUZ-AP25VGD2-A2"], kind: "dred", words: "VG2 → VGD2, adds demand response (D)" }]);
    expect(one("PKA-M71KA(L)2").proposals).toEqual([{ codes: ["PKA-M71KAL3.TH", "PKA-M71KAL3"], kind: "build", words: "KAL2 → KAL3, a newer build" }]);
    expect(one("PAC-KE92TB-E").proposals).toEqual([{ codes: ["PAC-KE92PTB-E"], kind: "letter", words: "TB → PTB, one letter more" }]);
  });

  it("never offers another size, supply, series or a cold-climate unit", () => {
    /* a multi's port count is its series, the 71 its size */
    expect(partsOf("MXZ-4F71VGD")).toEqual({ family: "MXZ", series: "4F", size: "71", tail: "VGD" });
    expect(one("MXZ-4F71VGD").proposals).toEqual([]);
    expect(one("MUZ-LN25VGHZ2").proposals).toEqual([]);
    expect(one("PEA-M100GAA").proposals).toEqual([]);
    expect(one("MLZ-KP25VF").proposals).toEqual([]);
    expect(differenceOf(partsOf("PUMY-SP140VKMD2-A")!, partsOf("PUMY-SP140YKMD3-A")!)).toBeNull();
  });
});

describe("what an order code tells a client", () => {
  it.each([
    ["MSZ-AP71VGKD2-A2", ["Wi-Fi built in", "Demand response (DRED) ready"]],
    ["MFZ-KW35VGK-A2", ["Wi-Fi built in"]],
    ["MUZ-AP71VGD2-A2", ["Demand response (DRED) ready"]],
    ["PUMY-SP140VKMD3-A", []],
    ["MSZ-AP71VGD2", ["Demand response (DRED) ready"]],
  ])("%s", (code, words) => expect(codeFeatures(code)).toEqual(words));
});

describe("the invoice workbook", () => {
  it("reads from the header down: model, latest price, its date, times and quantity bought", () => {
    const row = (o: Record<string, string | number | null>) => new Map(Object.entries(o));
    const r = parseInvoicedRows(
      [
        row({ A: "What Diamond Air actually pays Mitsubishi Electric" }),
        row({ A: "Model / part no.", B: "Description", C: "Latest unit price", D: "Latest invoice date", G: "Times invoiced", H: "Total qty bought" }),
        row({ A: "PEFY-P50VMX-E1", B: "5.6kW C/M Compact Ceiling Concealed 450mmD", C: 949, D: 46286, G: 9, H: 14 }),
        row({ A: "PAC-XX", B: "no price", C: null }),
      ],
      (n) => (n === 46286 ? "2026-09-21" : "?")
    );
    expect(r.rows).toEqual([
      {
        code: "PEFY-P50VMX-E1",
        name: "5.6kW C/M Compact Ceiling Concealed 450mmD",
        cents: 94900,
        pricedOn: "2026-09-21",
        timesBought: 9,
        qtyBought: 14,
        uom: null,
      },
    ]);
    expect(r.skipped).toBe(1);
  });
});

describe("a workbook read by its headings", () => {
  it("finds Ideal Air's columns where they are, a source column between them", () => {
    const row = (o: Record<string, string | number | null>) => new Map(Object.entries(o));
    const r = parseInvoicedRows(
      [
        row({ A: "Ideal Air Group - what Diamond Air pays" }),
        row({ A: "Item code", B: "Description", C: "Latest price", D: "Latest date", E: "Latest source", F: "Lowest", G: "Highest", H: "Times bought / quoted", I: "Total qty" }),
        row({ A: "SJMF150", B: "Jetflow In-Line Mixed Flow EC Fan 150mm", C: 220, D: 46251, E: "Invoice", F: 185, G: 327.68, H: 13, I: 42 }),
      ],
      () => "2026-08-17"
    );
    expect(r.rows).toEqual([
      { code: "SJMF150", name: "Jetflow In-Line Mixed Flow EC Fan 150mm", cents: 22000, pricedOn: "2026-08-17", timesBought: 13, qtyBought: 42, uom: null },
    ]);
  });
});

