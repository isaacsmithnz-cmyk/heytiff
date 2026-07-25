import { auDayOf, fmtAuDayMonth, fmtAuWeekdayDayMonth, fmtAuWeekdayDate, todayInAu, parseAuDate, formatAuDate } from "../au-dates";

/* The date helpers everything else anchors on. `todayInAu` answers "what day is
   it now" and `auDayOf` answers "what day was that" — they have to agree, or a
   timestamp can't be compared against today. `fmtAuDayMonth` is the one short
   label the dashboard's three date chips now share. */

describe("auDayOf — the AU day a timestamp fell on", () => {
  it("agrees with todayInAu for the same instant", () => {
    const iso = "2026-07-24T22:00:00Z";
    expect(auDayOf(iso)).toBe(todayInAu(new Date(iso)));
  });

  it("rolls a late-UTC evening into the next AU day", () => {
    // 22:00 UTC Fri = 08:00 Sat in Sydney (AEST, UTC+10)
    expect(auDayOf("2026-07-24T22:00:00Z")).toBe("2026-07-25");
  });

  it("keeps a mid-UTC-day timestamp on the same AU date", () => {
    expect(auDayOf("2026-07-25T10:00:00Z")).toBe("2026-07-25");
  });

  it("handles daylight saving — AEDT is UTC+11", () => {
    // 13:30 UTC on 1 Jan is 00:30 on the 2nd in Sydney
    expect(auDayOf("2026-01-01T13:30:00Z")).toBe("2026-01-02");
  });

  it("accepts a Date as well as a string", () => {
    expect(auDayOf(new Date("2026-07-24T22:00:00Z"))).toBe("2026-07-25");
  });

  it("returns empty for something unparseable rather than a wrong day", () => {
    expect(auDayOf("not a date")).toBe("");
  });
});

describe("fmtAuDayMonth", () => {
  it("formats a plain ISO date without shifting it", () => {
    expect(fmtAuDayMonth("2026-07-22")).toBe("22 July");
    expect(fmtAuDayMonth("2026-01-15")).toBe("15 Jan");
  });

  it("tolerates a full timestamp by taking its date part verbatim", () => {
    expect(fmtAuDayMonth("2026-01-15T23:59:00Z")).toBe("15 Jan");
  });

  /* en-AU writes June, July and Sept out in full and abbreviates the other
     nine. That's correct Australian style, so it's deliberate — but it makes
     those three chips wider, which is worth pinning down so a future change to
     the locale doesn't silently reflow the dashboard. */
  it("is three letters for nine months and full for June/July/Sept", () => {
    const month = (m: number) => fmtAuDayMonth(`2026-${String(m).padStart(2, "0")}-15`).slice(3);
    expect([1, 2, 3, 4, 5, 8, 10, 11, 12].map(month)).toEqual([
      "Jan", "Feb", "Mar", "Apr", "May", "Aug", "Oct", "Nov", "Dec",
    ]);
    expect([6, 7, 9].map(month)).toEqual(["June", "July", "Sept"]);
  });

  it("returns empty for null, undefined or junk", () => {
    expect(fmtAuDayMonth(null)).toBe("");
    expect(fmtAuDayMonth(undefined)).toBe("");
    expect(fmtAuDayMonth("15/07/2026")).toBe("");
  });
});

describe("parseAuDate / formatAuDate round trip", () => {
  it("survives a round trip", () => {
    expect(formatAuDate(parseAuDate("22/07/2026"))).toBe("22/07/2026");
  });

  it("rejects an impossible day rather than rolling it forward", () => {
    expect(parseAuDate("31/02/2026")).toBeNull();
  });
});

describe("fmtAuWeekdayDayMonth / fmtAuWeekdayDate", () => {
  it("renders weekday day month without the en-AU comma", () => {
    expect(fmtAuWeekdayDayMonth("2026-12-25")).toBe("Fri 25 Dec");
    expect(fmtAuWeekdayDate("2026-12-25")).toBe("Fri 25 Dec 2026");
  });

  it("keeps en-AU's full June/July/Sept months, same as fmtAuDayMonth", () => {
    expect(fmtAuWeekdayDayMonth("2026-06-08")).toBe("Mon 8 June");
  });

  it("returns empty for junk", () => {
    expect(fmtAuWeekdayDayMonth("not-a-date")).toBe("");
    expect(fmtAuWeekdayDate(null)).toBe("");
  });
});
