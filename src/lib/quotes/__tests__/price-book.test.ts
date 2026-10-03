/* The price book's two imports and its sums, on lines taken from the
   business's real files (2026-09-30). */
import {
  BUILT_IN_SUPPLIERS,
  columnLetter,
  compareOffers,
  csvRows,
  netCents,
  parseHeadedRows,
  parseAadCsv,
  parseMitsubishiLines,
  parseReeceCsv,
  previewRows,
  pricingWords,
} from "../price-book";

const aad = BUILT_IN_SUPPLIERS.find((s) => s.key === "aad")!;
/* the business's own discount, as it set it on the Quoting page */
const me = { ...BUILT_IN_SUPPLIERS.find((s) => s.key === "mitsubishi")!, discountPct: 30, rules: [{ prefix: "PUMY", discountPct: 48 }] };

describe("AAD's CSV", () => {
  it("reads code, name and net price, quotes and all", () => {
    const r = parseAadCsv(
      '﻿"MSZ-AP71VGKD2-A2","MITSUBISHI ELEC. HWS IND 7.1KW R32 WI-FI","409.27"\n' +
        '"MUZ-AP71VGD2-A2","MITSUBISHI ELEC. HWS OUT 7.1KW R32 DRED","1269.4"\n' +
        '"CQB/S4INTFLUKIT","BRA INT FLU KIT","0"\n\n'
    );
    expect(r.rows).toEqual([
      { code: "MSZ-AP71VGKD2-A2", name: "MITSUBISHI ELEC. HWS IND 7.1KW R32 WI-FI", cents: 40927 },
      { code: "MUZ-AP71VGD2-A2", name: "MITSUBISHI ELEC. HWS OUT 7.1KW R32 DRED", cents: 126940 },
      { code: "CQB/S4INTFLUKIT", name: "BRA INT FLU KIT", cents: 0 },
    ]);
  });
});

describe("Mitsubishi's trade book", () => {
  const lines = [
    "MSZ-AP71VGKD2-A2  Indoor Unit - wireless R/C with WiFi  $600.00  $660.00",
    "MUZ-AP71VGD2-A2  R32 Outdoor  $1,861.00  $2,047.10",
    "MSZAP71VGKD2KIT  7.1  8.0  $2,461.00  $2,707.10",
    "PUMY-SP125VKMD3-A  Single Fan Heat Pump VRF O/U 1 Phase  14.0  16.0  $5,803.00  $6,383.30",
    "Total  $1,566.00  $1,722.60",
    "MSZ-AP71VGKD2-A2  AP Series - Wireless R/C WITH WIFI  7.1  7.8  $600.00  $660.00",
    "A standard delivery charge of $45.00 plus GST per delivery will apply",
  ];

  it("keeps each model once at its list price, and leaves the kits out", () => {
    const r = parseMitsubishiLines(lines);
    expect(r.rows).toEqual([
      { code: "MSZ-AP71VGKD2-A2", name: "Indoor Unit - wireless R/C with WiFi", cents: 60000 },
      { code: "MUZ-AP71VGD2-A2", name: "R32 Outdoor", cents: 186100 },
      { code: "PUMY-SP125VKMD3-A", name: "Single Fan Heat Pump VRF O/U 1 Phase", cents: 580300 },
    ]);
    expect(r.conflicts).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  it("names a code listed twice at two prices", () => {
    const r = parseMitsubishiLines(["PAR-41MAAM  Wired Controller  $179.00  $196.90", "PAR-41MAAM  Wired Controller  $189.00  $207.90"]);
    expect(r.conflicts).toEqual([{ code: "PAR-41MAAM", kept: 17900, also: 18900 }]);
  });
});

describe("what the business pays", () => {
  it("AAD's price as sent; Mitsubishi's list less 30%, PUMY less 48%", () => {
    expect(netCents(aad, "MUZ-AP71VGD2-A2", 126940)).toBe(126940);
    expect(netCents(me, "MUZ-AP71VGD2-A2", 186100)).toBe(130270);
    expect(netCents(me, "PUMY-SP125VKMD3-A", 580300)).toBe(301756);
    expect(pricingWords(me)).toBe("List less 30%, PUMY less 48%");
    expect(pricingWords(aad)).toBe("Net prices");
  });

  it("knows no business's discount: a list-price supplier starts at list, and says so", () => {
    const fresh = BUILT_IN_SUPPLIERS.find((s) => s.key === "mitsubishi")!;
    expect(BUILT_IN_SUPPLIERS.every((s) => s.discountPct === 0 && s.rules.length === 0)).toBe(true);
    expect(netCents(fresh, "PUMY-SP125VKMD3-A", 580300)).toBe(580300);
    expect(pricingWords(fresh)).toBe("List prices, no discount set");
  });

  it("puts the cheaper supplier first and says by how much", () => {
    const c = compareOffers([
      { supplierKey: "mitsubishi", supplierName: "Mitsubishi Electric", code: "X", name: "x", netCents: 172270 },
      { supplierKey: "aad", supplierName: "AAD", code: "X", name: "x", netCents: 167867 },
    ]);
    expect(c.cheapest?.supplierKey).toBe("aad");
    expect(c.savesCents).toBe(4403);
  });
});

describe("Reece's account price file", () => {
  it("skips the section headings and keeps the net price ex GST, with the unit it's sold by", () => {
    const r = parseReeceCsv(
      "01,,,STOPS/FLEX HOSES/COVER PLATES\r\n" +
        "32,01,,DRAIN HOSE\r\n" +
        "32,01,3211201-1,FLEX DRAIN HOSE SMOOTH WALL 16MM X 25MTR (COIL),COIL,84.80,93.28,63.60,69.96,10.00,,,,,\r\n" +
        "32,01,3211201-2,FLEX DRAIN HOSE SMOOTH WALL 16MM X 25MTR (MTR),MTR,4.07,4.48,3.05,3.36,10.00,,,,,\r\n"
    );
    expect(r.rows).toEqual([
      { code: "3211201-1", name: "FLEX DRAIN HOSE SMOOTH WALL 16MM X 25MTR (COIL)", cents: 6360, uom: "COIL" },
      { code: "3211201-2", name: "FLEX DRAIN HOSE SMOOTH WALL 16MM X 25MTR (MTR)", cents: 305, uom: "MTR" },
    ]);
  });

  it("reads an inch mark mid-name as an inch mark, not a quote", () => {
    const r = parseReeceCsv(
      '08,12,9800013-1,ARDENT ANN REF CU R410A 1/2" 12X0.81X18M (COIL),COIL,276.94,304.63,207.71,228.48,10.00,,,,,\r\n' +
        '04,47,2701245-1,REFRIG COPPER FLARE BONNET R410A    1/4" (EA),EA,1.49,1.64,1.12,1.23,10.00,,,,,\r\n'
    );
    expect(r.rows).toEqual([
      { code: "9800013-1", name: 'ARDENT ANN REF CU R410A 1/2" 12X0.81X18M (COIL)', cents: 20771, uom: "COIL" },
      { code: "2701245-1", name: 'REFRIG COPPER FLARE BONNET R410A 1/4" (EA)', cents: 112, uom: "EA" },
    ]);
  });

  it("skips a row with no price rather than pricing it at $0.00", () => {
    expect(parseReeceCsv("08,12,1-1,SOMETHING (EA),EA,,,,,10.00\r\n")).toEqual({ rows: [], conflicts: [], skipped: 1 });
  });
});


describe("a layout HeyTiff doesn't know", () => {
  const text =
    "Acme Refrigeration price list,,,\r\n" +
    "Effective 1 Oct,,,\r\n" +
    "Part No,Product,Each,Trade\r\n" +
    'AC-100,"Bracket, wall 450",12.50,10.00\r\n' +
    "AC-200,Pump,,\r\n" +
    "AC-300,Isolator 20A,31.00,24.80\r\n";

  it("reads a CSV's lines as rows by column letter", () => {
    const rows = csvRows(text);
    expect(rows[3]!.get("A")).toBe("AC-100");
    expect(rows[3]!.get("B")).toBe("Bracket, wall 450");
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(26)).toBe("AA");
  });

  it("finds no known headings, so shows the first rows to match", () => {
    const rows = csvRows(text);
    expect(parseHeadedRows(rows, () => "").rows).toEqual([]);
    const p = previewRows(rows, 4);
    expect(p.letters).toEqual(["A", "B", "C", "D"]);
    expect(p.rows[2]).toEqual(["Part No", "Product", "Each", "Trade"]);
  });

  it("reads by the matched columns: titles above the first price aren't missed rows, a blank price after is", () => {
    const r = parseHeadedRows(csvRows(text), () => "", { code: "A", name: "B", price: "D" });
    expect(r.rows).toEqual([
      { code: "AC-100", name: "Bracket, wall 450", cents: 1000, pricedOn: null, timesBought: null, qtyBought: null, uom: null },
      { code: "AC-300", name: "Isolator 20A", cents: 2480, pricedOn: null, timesBought: null, qtyBought: null, uom: null },
    ]);
    expect(r.skipped).toBe(1);
  });
});
