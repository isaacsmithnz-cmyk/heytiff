import { andWords, clockWord, dateBlock, daysWords, lengthRange, rangeWords, runDays } from "../visit-words";

/* A visit in words, as Isaac's mock of 25 October 2026 says it */

describe("a visit in words", () => {
  it("says a time the short way, and a range on one day", () => {
    expect(clockWord("07:00")).toBe("7am");
    expect(clockWord("2026-11-05 15:30:00")).toBe("3:30pm");
    expect(clockWord("12:00")).toBe("12pm");
    expect(clockWord("00:15")).toBe("12:15am");
    expect(rangeWords("2026-11-05 07:00:00", "2026-11-05 15:00:00")).toBe("7am to 3pm");
    expect(rangeWords("2026-11-05 07:00:00", null)).toBe("7am");
    expect(lengthRange("07:00", 480)).toBe("7am to 3pm");
    expect(lengthRange("23:00", 120)).toBe("11pm");
  });

  it("draws a date block, and a run of days within a month or across one", () => {
    expect(dateBlock("2026-11-05")).toEqual({ weekday: "Thu", date: "5", month: "Nov" });
    expect(daysWords("2026-11-09", "2026-11-11")).toBe("Mon 9 to Wed 11 Nov");
    expect(daysWords("2026-10-30", "2026-11-03")).toBe("Fri 30 Oct to Tue 3 Nov");
    expect(daysWords("2026-11-05", "2026-11-05")).toBe("Thu 5 Nov");
    expect(andWords(["Louis Jones", "Leonardo Martins", "David Hann"])).toBe("Louis Jones, Leonardo Martins and David Hann");
  });

  it("books the weekdays of a run, and a Saturday or Sunday only when pressed or at either end", () => {
    expect(runDays("2026-11-06", "2026-11-10", [])).toEqual(["2026-11-06", "2026-11-09", "2026-11-10"]);
    expect(runDays("2026-11-06", "2026-11-10", ["2026-11-07"])).toEqual(["2026-11-06", "2026-11-07", "2026-11-09", "2026-11-10"]);
    expect(runDays("2026-11-07", null, [])).toEqual(["2026-11-07"]);
    expect(runDays(null, null, [])).toEqual([]);
  });
});
