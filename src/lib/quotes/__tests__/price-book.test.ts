/* The price book's two imports and its sums, on lines taken from the
   business's real files (2026-09-30). */
import {
  DEFAULT_SUPPLIERS,
  compareOffers,
  netCents,
  parseAadCsv,
  parseMitsubishiLines,
  parseReeceCsv,
  pricingWords,
} from "../price-book";

const aad = DEFAULT_SUPPLIERS.find((s) => s.key === "aad")!;
const me = DEFAULT_SUPPLIERS.find((s) => s.key === "mitsubishi")!;

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
});

