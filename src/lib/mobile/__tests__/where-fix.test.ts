import { readFix } from "../where-fix";

/* WHERE A PHONE IS, as it says it: only a real place, recently. */
const NOW = Date.parse("2026-11-17T02:00:00Z");

describe("readFix", () => {
  it("(F) takes a place in range, said in the last half hour, its sureness to the metre", () => {
    expect(readFix({ lat: -33.88, lng: 151.186, accuracy: 12.6, at: "2026-11-17T01:58:00Z" }, NOW)).toEqual({
      lat: -33.88,
      lng: 151.186,
      accuracy: 13,
      at: "2026-11-17T01:58:00.000Z",
    });
  });

  it("(F) refuses nowhere, a place out of range, an old one and one from the future", () => {
    expect(readFix(null, NOW)).toBeNull();
    expect(readFix({ lat: 0, lng: 0, at: "2026-11-17T01:58:00Z" }, NOW)).toBeNull();
    expect(readFix({ lat: -95, lng: 151, at: "2026-11-17T01:58:00Z" }, NOW)).toBeNull();
    expect(readFix({ lat: "-33", lng: 151, at: "2026-11-17T01:58:00Z" }, NOW)).toBeNull();
    expect(readFix({ lat: -33.88, lng: 151.186, at: "2026-11-17T01:20:00Z" }, NOW)).toBeNull();
    expect(readFix({ lat: -33.88, lng: 151.186, at: "2026-11-17T02:10:00Z" }, NOW)).toBeNull();
  });

  it("puts a clock a little ahead back to now, and an unknown sureness as none", () => {
    expect(readFix({ lat: -33.88, lng: 151.186, at: "2026-11-17T02:01:00Z" }, NOW)).toEqual({ lat: -33.88, lng: 151.186, accuracy: null, at: "2026-11-17T02:00:00.000Z" });
  });
});
