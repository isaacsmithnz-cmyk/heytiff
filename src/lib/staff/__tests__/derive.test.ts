import { yearsSince } from "../derive";

const NOW = new Date("2026-07-19T00:00:00Z");

describe("yearsSince", () => {
  it("returns one decimal place", () => {
    expect(yearsSince("2021-03-01", NOW)).toBe("5.4");
    expect(yearsSince("2024-01-15", NOW)).toBe("2.5");
  });

  it("returns an em dash when there is no start date", () => {
    expect(yearsSince(null, NOW)).toBe("—");
    expect(yearsSince(undefined, NOW)).toBe("—");
    expect(yearsSince("", NOW)).toBe("—");
  });

  it("returns an em dash for an unparseable date", () => {
    expect(yearsSince("not a date", NOW)).toBe("—");
  });

  it("returns an em dash for a future start date rather than a negative", () => {
    expect(yearsSince("2027-01-01", NOW)).toBe("—");
  });

  it("reads a timestamp as well as a bare date", () => {
    expect(yearsSince("2021-03-01T09:30:00Z", NOW)).toBe("5.4");
  });

  it("is 0.0 on the start date itself", () => {
    expect(yearsSince("2026-07-19", NOW)).toBe("0.0");
  });
});
