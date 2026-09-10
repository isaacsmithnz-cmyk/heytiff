import {
  DEFAULT_EXPIRY_WARN_DAYS,
  DEFAULT_EXPIRY_WINDOW,
  EXPIRY_WARN_MAX,
  EXPIRY_WARN_MIN,
  expiryWarnDaysFrom,
  isExpiryWarnDays,
  readExpiryWarnDays,
} from "../expiry";

/* THE ONE NUMBER. It replaced six hard-coded 30s in three files, and the
   rules that used to import those constants now take it as an argument with
   no default — so what is pinned here is the number's own contract: what a
   fresh workspace gets, what the settings box accepts, and what a row that
   failed to read falls back to. */

describe("the default", () => {
  it("is the number the six constants all were", () => {
    expect(DEFAULT_EXPIRY_WARN_DAYS).toBe(30);
    expect(DEFAULT_EXPIRY_WINDOW).toEqual({ warnDays: 30, email: true });
  });
});

describe("what the settings box accepts", () => {
  it("takes a whole number of days inside the column's CHECK", () => {
    expect(readExpiryWarnDays("30")).toBe(30);
    expect(readExpiryWarnDays(" 14 ")).toBe(14);
    expect(readExpiryWarnDays(String(EXPIRY_WARN_MIN))).toBe(EXPIRY_WARN_MIN);
    expect(readExpiryWarnDays(String(EXPIRY_WARN_MAX))).toBe(EXPIRY_WARN_MAX);
  });

  /* REFUSED, NOT SALVAGED. A sign or a point stripped to digits would turn
     "-14" into 14 and "1.5" into 15 — a window nobody chose, stored
     silently. Same posture as a head count. */
  it("refuses a blank, a sign, a point, a word, and anything outside the range", () => {
    for (const bad of ["", "  ", "0", "366", "-14", "1.5", "thirty", "30d", "1000"]) {
      expect(readExpiryWarnDays(bad)).toBe("invalid");
    }
  });
});

describe("what a row is believed to say", () => {
  it("keeps a number inside the range and falls back to the default for anything else", () => {
    expect(expiryWarnDaysFrom(14)).toBe(14);
    expect(expiryWarnDaysFrom(365)).toBe(365);
    for (const bad of [null, undefined, 0, 366, -1, 7.5, "30", NaN]) {
      expect(expiryWarnDaysFrom(bad)).toBe(DEFAULT_EXPIRY_WARN_DAYS);
    }
  });

  it("isExpiryWarnDays is the same rule, as a guard", () => {
    expect(isExpiryWarnDays(1)).toBe(true);
    expect(isExpiryWarnDays(365)).toBe(true);
    expect(isExpiryWarnDays(0)).toBe(false);
    expect(isExpiryWarnDays(366)).toBe(false);
    expect(isExpiryWarnDays(2.5)).toBe(false);
    expect(isExpiryWarnDays("30")).toBe(false);
  });
});
