/* When a manual came out: printed on its title, file or edition, else the PDF's own date. */

import { pdfDate, printedDate, releasedOf } from "../released";

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
