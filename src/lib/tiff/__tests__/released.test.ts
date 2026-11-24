/* When a manual came out: printed on its title, file or edition, else the PDF's own date. */

import { editionWords, pdfDate, printedDate, releasedOf, madeByConverter } from "../released";

const NOW = new Date("2026-10-30T00:00:00Z");

describe("printedDate", () => {
  it.each([
    ["PEA-M100-160HAA Jan2023", "2023-01-01"],
    ["PUMY-SP80-140VYKMD2-A_SM_TCH094A_JUL2023.pdf", "2023-07-01"],
    ["September 2022", "2022-09-01"],
    ["Large Capacity Ducted Systems Flyer 2023-12", "2023-12-01"],
    ["Ducted Air Conditioning Brochure 2024", "2024-01-01"],
    ["Product Release 2023", "2023-01-01"],
  ])("%s is %s", (text, date) => expect(printedDate(text, NOW)).toBe(date));

  it.each([
    ["PUMY-SP80-140VYKMD2-A SM UL2023"],
    ["SiAU282005EA"],
    ["Si30 - 701_A"],
    ["Main-Zone-Controller_IM_BH79F139H03.pdf"],
    ["PUMY-P200YKMD2-A IM"],
    ["Brochure 2031"],
    [null],
  ])("finds no date in %s", (text) => expect(printedDate(text, NOW)).toBeNull());
});

describe("pdfDate", () => {
  it("reads a PDF's own date to its month", () => {
    expect(pdfDate("D:20230713174433+10'00'", NOW)).toBe("2023-07-01");
    expect(pdfDate("D:20110928091207Z", NOW)).toBe("2011-09-01");
  });

  it("is null for nothing, or a date no manual has", () => {
    expect(pdfDate(null, NOW)).toBeNull();
    expect(pdfDate("D:19700101000000Z", NOW)).toBeNull();
    expect(pdfDate("yesterday", NOW)).toBeNull();
  });
});

describe("releasedOf", () => {
  it("takes the title's date first, then the file's, then the edition's", () => {
    expect(releasedOf({ title: "Brochure 2024", fileName: "x_Jan2025.pdf", edition: null }, "D:20250107030804Z", NOW)).toBe("2024-01-01");
    expect(releasedOf({ title: "PUMY-SP80-140VYKMD2-A SM UL2023", fileName: "PUMY-SP80-140VYKMD2-A_SM_TCH094A_JUL2023.pdf", edition: "July 2023" }, null, NOW)).toBe(
      "2023-07-01",
    );
    expect(releasedOf({ title: "PUMY-P250-300YBMD SM", fileName: "PUMY-P250-300YBMD_SM_TCH103.pdf", edition: "September 2022" }, null, NOW)).toBe("2022-09-01");
  });

  it("falls back on the PDF's own date where nothing printed says one", () => {
    expect(releasedOf({ title: "ME - Main Zone Controller", fileName: "Main-Zone-Controller_IM_BH79F139H03.pdf", edition: null }, "D:20260106100651+09'00'", NOW)).toBe(
      "2026-01-01",
    );
    expect(releasedOf({ title: "Daikin VRV Diagnosis Manual", fileName: null, edition: "Si30 - 701_A" }, null, NOW)).toBeNull();
  });
});

describe("editionWords", () => {
  it("keeps an edition that says more than the year", () => {
    expect(editionWords("Si30 - 701_A")).toBe("Si30 - 701_A");
    expect(editionWords("REVISED EDITION-A")).toBe("REVISED EDITION-A");
    expect(editionWords("Product Release 2023")).toBe("Product Release 2023");
  });

  it("drops one that's only a date, or nothing", () => {
    expect(editionWords("July 2023")).toBeNull();
    expect(editionWords("Sep. 2022")).toBeNull();
    expect(editionWords("2024")).toBeNull();
    expect(editionWords("  ")).toBeNull();
    expect(editionWords(null)).toBeNull();
  });
});

/* 24 November 2026: a 2018 sheet photographed or saved from Word today wore
   2026. The cover's printed date comes first; a scanner's or converter's own
   date is never the manual's. */
describe("a scan or a conversion", () => {
  const now = new Date("2026-11-24T00:00:00Z");
  it("takes the date the cover prints before the PDF's own", () => {
    expect(releasedOf({ title: "PFC testing", fileName: "PFC testing.pdf", edition: null, issued: "21 April 2017" }, "D:20261124", now)).toBe("2017-04-01");
  });
  it("gives no year when only a scanner or converter dated the PDF", () => {
    expect(madeByConverter("Skia/PDF m131 · Mozilla/5.0 Chrome/131")).toBe(true);
    expect(madeByConverter("macOS Version 15.1 Quartz PDFContext")).toBe(true);
    expect(madeByConverter("TinyScan")).toBe(true);
    expect(madeByConverter("Adobe PDF Library 17.0 · Adobe InDesign 18.2")).toBe(false);
    expect(releasedOf({ title: "EEV coil information", fileName: "EEV_Coil INFO.pdf", edition: null, producer: "Skia/PDF m131" }, "D:20261124", now)).toBeNull();
    expect(releasedOf({ title: "Brochure", fileName: "b.pdf", edition: null, producer: "Adobe InDesign 18.2" }, "D:20230713", now)).toBe("2023-07-01");
  });
});
