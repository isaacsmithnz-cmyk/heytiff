import { buildLicenceRow, credBadgeCode, licenceStatus } from "../licence";

describe("buildLicenceRow", () => {
  it("refuses a blank type", () => {
    expect(buildLicenceRow({ typeName: "  " })).toEqual({ error: expect.stringMatching(/licence type/i) });
  });

  it("keeps a type-only licence — expiry and number are optional", () => {
    expect(buildLicenceRow({ typeName: "White card" })).toEqual({
      row: { type_name: "White card", licence_number: null, expiry_date: null, color: null },
    });
  });

  /* The add-licence form is a calendar picker now, so it sends ISO; a typed
     dd/mm/yyyy still parses, because parseAuDate takes both and this validator
     is the same one a direct POST hits. */
  it("takes an ISO expiry from the picker", () => {
    const r = buildLicenceRow({ typeName: "ARC licence", expiryDate: "2026-08-07" });
    expect(r).toEqual({ row: expect.objectContaining({ expiry_date: "2026-08-07" }) });
  });

  it("still parses a typed dd/mm/yyyy expiry to ISO", () => {
    const r = buildLicenceRow({ typeName: "ARC licence", expiryDate: "07/08/2026" });
    expect(r).toEqual({ row: expect.objectContaining({ expiry_date: "2026-08-07" }) });
  });

  it("rejects an unparseable expiry rather than storing garbage", () => {
    for (const bad of ["31/31/2026", "2026-02-31", "whenever"]) {
      expect(buildLicenceRow({ typeName: "ARC", expiryDate: bad })).toEqual({
        error: expect.stringMatching(/expiry date/i),
      });
    }
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

/* The 2–4 letter stamp on a credential card. It has to be stable and it has
   to be recognisable at a glance — "ARC" and "WC" are what a tradesperson
   would actually say, so a card reads the way the ticket does. */
describe("credBadgeCode", () => {
  it("gives the known tickets their real abbreviations and colours", () => {
    expect(credBadgeCode("ARC licence")).toEqual({ code: "ARC", color: "#00A389" });
    expect(credBadgeCode("Driver’s licence")).toEqual({ code: "DL", color: "#2E68FF" });
    expect(credBadgeCode("White card")).toEqual({ code: "WC", color: "#8A2BE2" });
    expect(credBadgeCode("Contractor licence")).toEqual({ code: "CL", color: "#F0A431" });
  });

  it("matches however the type was typed", () => {
    expect(credBadgeCode("arc").code).toBe("ARC");
    expect(credBadgeCode("Drivers Licence (NSW)").code).toBe("DL");
    expect(credBadgeCode("White Card").code).toBe("WC");
  });

  it("initialises a custom ticket, at most three letters", () => {
    expect(credBadgeCode("Working at Heights")).toEqual({ code: "WAH", color: "#00A389" });
    expect(credBadgeCode("Confined Spaces Entry Permit").code).toBe("CSE");
    expect(credBadgeCode("EWP").code).toBe("E");
  });

  it("splits on the separators a ticket name actually uses", () => {
    expect(credBadgeCode("Test & Tag").code).toBe("TT");
    expect(credBadgeCode("First-Aid").code).toBe("FA");
  });

  it("has something to show for a blank name", () => {
    expect(credBadgeCode("").code).toBe("—");
    expect(credBadgeCode(null).code).toBe("—");
  });
});
