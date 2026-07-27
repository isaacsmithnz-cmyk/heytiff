import { capacityNote, XERO_TIER_LIMITS, xeroCapacity } from "../capacity";

/* The failure this guards against is silent: Xero doesn't warn as the tier's
   connection ceiling approaches, so customer number six just fails to connect
   and the app reports a generic "didn't complete the connection". These tests
   pin the arithmetic that buys the lead time. */

describe("xeroCapacity", () => {
  it("counts down from the starter tier's five connections", () => {
    expect(xeroCapacity(0)).toMatchObject({ used: 0, limit: 5, remaining: 5, tight: false, full: false });
    expect(xeroCapacity(3)).toMatchObject({ remaining: 2, tight: false, full: false });
  });

  it("calls it tight with one left — while raising the tier is still possible in time", () => {
    expect(xeroCapacity(4)).toMatchObject({ remaining: 1, tight: true, full: false });
  });

  it("knows when it is full", () => {
    expect(xeroCapacity(5)).toMatchObject({ remaining: 0, tight: true, full: true });
  });

  it("clamps rather than rendering a negative if the limit moves under us", () => {
    expect(xeroCapacity(9)).toMatchObject({ remaining: 0, full: true });
  });

  it("has room to grow on core", () => {
    expect(xeroCapacity(5, "core")).toMatchObject({ limit: 50, remaining: 45, tight: false });
  });

  it("treats plus as unbounded rather than guessing Xero's negotiated number", () => {
    expect(xeroCapacity(200, "plus")).toMatchObject({ limit: null, remaining: null, full: false });
    expect(XERO_TIER_LIMITS.plus).toBeNull();
  });
});

describe("capacityNote", () => {
  it("names the action, not just the number, once it's tight", () => {
    expect(capacityNote(xeroCapacity(4))).toContain("ask Xero");
  });

  it("says plainly that nobody new can connect when full", () => {
    const note = capacityNote(xeroCapacity(5));
    expect(note).toContain("Limit reached");
    expect(note).toContain("No new customer can connect");
  });

  it("stays quiet with room to spare", () => {
    const note = capacityNote(xeroCapacity(1));
    expect(note).toBe("4 left of 5 on this tier.");
  });

  it("says so when the tier has no ceiling", () => {
    expect(capacityNote(xeroCapacity(0, "plus"))).toBe("No connection limit on this tier.");
  });
});
