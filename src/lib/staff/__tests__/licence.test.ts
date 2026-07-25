import { buildLicenceRow, licenceStatus } from "../licence";

describe("buildLicenceRow", () => {
  it("refuses a blank type", () => {
    expect(buildLicenceRow({ typeName: "  " })).toEqual({ error: expect.stringMatching(/licence type/i) });
  });

  it("keeps a type-only licence — expiry and number are optional", () => {
    expect(buildLicenceRow({ typeName: "White card" })).toEqual({
      row: { type_name: "White card", licence_number: null, expiry_date: null, color: null },
    });
  });

  it("parses a dd/mm/yyyy expiry to ISO", () => {
    const r = buildLicenceRow({ typeName: "ARC licence", expiryDate: "07/08/2026" });
    expect(r).toEqual({ row: expect.objectContaining({ expiry_date: "2026-08-07" }) });
  });

  it("rejects an unparseable expiry rather than storing garbage", () => {
    expect(buildLicenceRow({ typeName: "ARC", expiryDate: "31/31/2026" })).toEqual({
      error: expect.stringMatching(/dd\/mm\/yyyy/i),
    });
  });

  it("trims a number and only keeps a real hex colour", () => {
    const ok = buildLicenceRow({ typeName: "ARC", licenceNumber: "  L123  ", color: "#00A389" });
    expect("row" in ok && ok.row).toMatchObject({ licence_number: "L123", color: "#00A389" });
    // a non-hex colour from a forged post is dropped, not stored
    const forged = buildLicenceRow({ typeName: "ARC", color: "red; drop table" });
    expect("row" in forged && forged.row.color).toBeNull();
  });
});

describe("licenceStatus", () => {
  const TODAY = "2026-07-24";

  it("reads 'No expiry' when none is set", () => {
    expect(licenceStatus(null, TODAY)).toEqual({ label: "No expiry", tone: "mute" });
  });

  it("is bad once past", () => {
    expect(licenceStatus("2026-07-10", TODAY)).toEqual({ label: "Expired", tone: "bad" });
  });

  it("warns inside the 30-day window, matching the dashboard chip", () => {
    expect(licenceStatus("2026-08-07", TODAY)).toEqual({ label: "Expires in 2 weeks", tone: "warn" });
    expect(licenceStatus(TODAY, TODAY)).toEqual({ label: "Expires today", tone: "warn" });
  });

  it("is valid comfortably out", () => {
    expect(licenceStatus("2027-01-01", TODAY)).toEqual({ label: "Valid", tone: "ok" });
  });
});
