import {
  NOTE_MAX,
  asSaid,
  filedLine,
  holidayClaimLine,
  landedEvent,
  lineAbout,
  lineDates,
  lineDoor,
  linePlan,
  notedLine,
  onBoxDay,
  openDays,
  outsideLine,
  saysRepeat,
  shutdownOnHolidaysLine,
  takenBackLine,
  withNote,
  type CalendarLine,
  type LineFrame,
} from "../line";

/* A LINE FOR THE CALENDAR, counted and said (H22). His own words are the
   spine: "Toolbox talk every first Thursday, 6:45", on Thu 24 Sept 2026,
   goes on eleven times and Tiff says so in the spec's words. Without the
   every, "the first Thursday of the month" is the next one, once (the first
   real-model check). */

const AT: LineFrame = { today: "2026-09-24", windowStart: "2026-09-01", windowEnd: "2027-08-31" };

const line = (over: Partial<CalendarLine> = {}): CalendarLine => ({
  title: "Toolbox talk",
  titleInSentence: "toolbox talk",
  kind: "event",
  day: null,
  lastDay: null,
  time: null,
  endTime: null,
  repeat: null,
  repeatWord: null,
  where: null,
  who: null,
  ...over,
});

const TOOLBOX = line({ time: "06:45", repeat: { every: "month", day: "thu", nth: 1 } });

const on = (l: CalendarLine) => {
  const d = lineDates(l, AT);
  if (!d.ok) throw new Error(`no dates: ${d.why}`);
  return d;
};

describe("the days a line goes on", () => {
  it("puts the first Thursday on eleven times, from today to the window's end", () => {
    const d = on(TOOLBOX);
    expect(d.days).toEqual([
      "2026-10-01",
      "2026-11-05",
      "2026-12-03",
      "2027-01-07",
      "2027-02-04",
      "2027-03-04",
      "2027-04-01",
      "2027-05-06",
      "2027-06-03",
      "2027-07-01",
      "2027-08-05",
    ]);
    expect(d.lastDay).toBeNull();
  });

  it("starts a repeat from the day the line said, when that is later than today", () => {
    expect(on(line({ day: "2026-11-01", repeat: { every: "week", day: "mon" } })).days[0]).toBe("2026-11-02");
  });

  it("never starts a repeat before today, whatever day came back with it", () => {
    expect(on(line({ day: "2026-09-01", repeat: { every: "week", day: "mon" } })).days[0]).toBe("2026-09-28");
  });

  it("puts a one-off on its day, and a range on its first day with its last", () => {
    expect(on(line({ day: "2026-10-08" }))).toEqual({ ok: true, days: ["2026-10-08"], lastDay: null });
    expect(on(line({ kind: "shutdown", day: "2026-12-23", lastDay: "2027-01-08" }))).toEqual({
      ok: true,
      days: ["2026-12-23"],
      lastDay: "2027-01-08",
    });
  });

  it("asks for a day when a one-off has none", () => {
    expect(lineDates(line(), AT)).toEqual({ ok: false, why: "no-day" });
  });

  /* A shutdown closes the business for its days; it never repeats, so a
     rule that came back with one is not a day to put it on. */
  it("never repeats a shutdown: without a day of its own it asks", () => {
    expect(lineDates(line({ kind: "shutdown", repeat: { every: "week", day: "fri" } }), AT)).toEqual({
      ok: false,
      why: "no-day",
    });
  });

  it("keeps to the twelve months: before them is past, after them is far", () => {
    expect(lineDates(line({ day: "2026-08-31" }), AT)).toEqual({ ok: false, why: "past" });
    expect(lineDates(line({ day: "2027-09-01" }), AT)).toEqual({ ok: false, why: "far" });
    expect(lineDates(line({ day: "2027-09-01", repeat: { every: "week", day: "mon" } }), AT)).toEqual({
      ok: false,
      why: "far",
    });
  });
});

describe("what Tiff says", () => {
  it("says the spec's line for his toolbox talk, with its plan and its door", () => {
    const d = on(TOOLBOX);
    expect(filedLine(TOOLBOX, d)).toBe(
      "Done. Toolbox talk is on the calendar for Thu 1 Oct at 6:45 am, then the first Thursday of every month until Aug 2027.",
    );
    expect(linePlan(TOOLBOX, d)).toEqual([
      { lead: "Thu 1 Oct", text: "toolbox talk, 6:45 am" },
      { lead: "Every month", text: "the first Thursday, until Aug 2027" },
    ]);
    expect(lineDoor(d)).toBe("11 events on the calendar");
    expect(lineAbout(TOOLBOX, d)).toBe("the toolbox talk on Thu 1 Oct");
    expect(notedLine(lineAbout(TOOLBOX, d))).toBe("Got it. I have added that to the toolbox talk on Thu 1 Oct.");
  });

  it("says a one-off with its hours, and keeps a name's capitals inside the sentence", () => {
    const l = line({
      title: "Daikin VRV training",
      titleInSentence: "Daikin VRV training",
      day: "2026-10-08",
      time: "07:30",
      endTime: "11:30",
    });
    const d = on(l);
    expect(filedLine(l, d)).toBe("Done. Daikin VRV training is on the calendar for Thu 8 Oct at 7:30 am.");
    expect(linePlan(l, d)).toEqual([{ lead: "Thu 8 Oct", text: "Daikin VRV training, 7:30 – 11:30 am" }]);
    expect(lineDoor(d)).toBe("1 event on the calendar");
  });

  it("says a range from its first day to its last", () => {
    const l = line({ title: "Christmas shutdown", titleInSentence: "Christmas shutdown", kind: "shutdown", day: "2026-12-23", lastDay: "2027-01-08" });
    const d = on(l);
    expect(filedLine(l, d)).toBe("Done. Christmas shutdown is on the calendar from Wed 23 Dec to Fri 8 Jan.");
    expect(linePlan(l, d)).toEqual([{ lead: "Wed 23 Dec – Fri 8 Jan", text: "Christmas shutdown" }]);
  });

  it("says a repeat that lands once as the one date it is", () => {
    const l = line({ repeat: { every: "month", day: "thu", nth: 1 }, day: "2027-08-01" });
    const d = on(l);
    expect(d.days).toEqual(["2027-08-05"]);
    expect(filedLine(l, d)).toBe("Done. Toolbox talk is on the calendar for Thu 5 Aug.");
    expect(linePlan(l, d)).toHaveLength(1);
  });

  it("says why a day outside the twelve months went nowhere", () => {
    expect(outsideLine("past", AT.windowEnd)).toBe("That day has already gone, so I haven't put it on the calendar.");
    expect(outsideLine("far", AT.windowEnd)).toBe("The calendar runs to Aug 2027, so I haven't put that on it.");
  });

  it("counts what Undo took back", () => {
    expect(takenBackLine(1)).toBe("1 event taken back.");
    expect(takenBackLine(11)).toBe("11 events taken back.");
  });
});

describe("held to the words", () => {
  it("hears every, each, monthly, weekly and fortnightly as a repeat, and only as whole words", () => {
    expect(saysRepeat(["toolbox talk every first Thursday"], null)).toBe(true);
    expect(saysRepeat(["BBQ last Friday of EACH month"], null)).toBe(true);
    expect(saysRepeat(["Monthly BBQ"], "")).toBe(true);
    expect(saysRepeat(["site walk, weekly"], null)).toBe(true);
    expect(saysRepeat(["Fortnightly site meeting"], null)).toBe(true);
    expect(saysRepeat(["everyone to the beach BBQ last Friday of the month"], null)).toBe(false);
  });

  it("hears it in an answer to Which day? as in the line", () => {
    expect(saysRepeat(["toolbox talk", "every first Thursday"], null)).toBe(true);
  });

  it("takes the speaker's own word only where they said it, whole", () => {
    expect(saysRepeat(["Werkzeugbesprechung jeden ersten Donnerstag"], "jeden")).toBe(true);
    expect(saysRepeat(["Werkzeugbesprechung JEDEN ersten Donnerstag"], "jeden")).toBe(true);
    expect(saysRepeat(["reunión todos  los primeros jueves"], "todos los")).toBe(true);
    expect(saysRepeat(["toolbox talk first Thursday of the month"], "jeden")).toBe(false);
    expect(saysRepeat(["Werkzeugbesprechung jedenfalls Donnerstag"], "jeden")).toBe(false);
    /* Chinese has no spaces to find a word between. */
    expect(saysRepeat(["每月最后一个星期五烧烤"], "每")).toBe(true);
    expect(saysRepeat(["最后一个星期五烧烤"], "每")).toBe(false);
  });

  it("never takes words that only name the day for a repeat", () => {
    const line = "BBQ at the yard last Friday of the month 3pm";
    for (const w of ["of the month", "month", "the last Friday", "Last", "  ", "."]) expect(saysRepeat([line], w)).toBe(false);
  });

  it("puts a weekday of the month the words never say repeats on once, the next one, whatever the reader returned", () => {
    const bbq = line({ title: "BBQ", time: "15:00", repeat: { every: "month", day: "fri", nth: "last" } });
    const once = asSaid(bbq, ["BBQ at the yard last Friday of the month 3pm"], AT);
    expect(once).toEqual({ ...bbq, repeat: null, day: "2026-09-25", lastDay: null });
    expect(lineDates(once, AT)).toEqual({ ok: true, days: ["2026-09-25"], lastDay: null });
    /* From the day it names when that is later, and never past the calendar. */
    expect(asSaid({ ...bbq, day: "2026-11-02" }, ["BBQ last Friday of November"], AT).day).toBe("2026-11-27");
    expect(asSaid({ ...bbq, day: "2026-08-01" }, ["BBQ last Friday of the month"], AT).day).toBe("2026-09-25");
    const far = asSaid({ ...bbq, day: "2027-09-03" }, ["BBQ last Friday of September next year"], AT);
    expect(lineDates(far, AT)).toEqual({ ok: false, why: "far" });
  });

  it("leaves a repeat the words say as it was read", () => {
    const bbq = line({ title: "BBQ", repeat: { every: "month", day: "fri", nth: "last" } });
    expect(asSaid(bbq, ["BBQ every last Friday of the month"], AT)).toBe(bbq);
    expect(asSaid({ ...bbq, repeatWord: "jeden" }, ["Grillen jeden letzten Freitag"], AT).repeat).toEqual(bbq.repeat);
    expect(asSaid(line({ day: "2026-10-08" }), ["toolbox talk on the 8th"], AT)).toEqual(line({ day: "2026-10-08" }));
  });

  it("hears a line called Public holiday as a claim that the day is one, whatever kind it was read as", () => {
    const said = ["public holiday Monday"];
    for (const kind of ["shutdown", "event"] as const) {
      expect(asSaid(line({ title: "Public holiday", kind, day: "2026-09-28", time: "07:00" }), said, AT)).toMatchObject({
        kind: "public_holiday",
        day: "2026-09-28",
        time: null,
        repeat: null,
      });
    }
    expect(asSaid(line({ title: "public  holidays", kind: "shutdown" }), said, AT).kind).toBe("public_holiday");
    const weekly = line({ title: "Public holiday", repeat: { every: "week", day: "mon" }, repeatWord: "every" });
    expect(asSaid(weekly, ["public holiday every Monday"], AT)).toMatchObject({ kind: "public_holiday", repeat: null });
    /* Something held on one is not a claim. */
    expect(asSaid(line({ title: "Public holiday BBQ", day: "2026-10-05" }), ["public holiday BBQ"], AT).kind).toBe("event");
  });
});

/* THE BOX'S DAY (Isaac, 2026-09-26: "simplify it. how does a calendar
   normally add things in?"): the Calendar's box adds to a day it names, so
   a line that names none goes on it, where she would have asked. */
describe("on the box's day", () => {
  it("puts a line that names no day on it, and her line names it", () => {
    const l = onBoxDay(line({ time: "06:45" }), "2026-10-01", AT);
    expect(l).toMatchObject({ day: "2026-10-01", lastDay: null, time: "06:45" });
    expect(filedLine(l, on(l))).toBe("Done. Toolbox talk is on the calendar for Thu 1 Oct at 6:45 am.");
    // a shutdown or a claimed holiday with no day is on it too
    expect(onBoxDay(line({ kind: "shutdown" }), "2026-12-24", AT).day).toBe("2026-12-24");
    expect(onBoxDay(line({ kind: "public_holiday" }), "2026-10-05", AT).day).toBe("2026-10-05");
    // the calendar's first and last days, and a day gone by this month, are days on it
    for (const day of ["2026-09-01", "2026-09-10", "2027-08-31"]) expect(onBoxDay(line(), day, AT).day).toBe(day);
  });

  it("leaves words that name a day, a range or a repeat as they said", () => {
    const named = line({ day: "2026-10-08" });
    expect(onBoxDay(named, "2026-10-01", AT)).toBe(named);
    const range = line({ kind: "shutdown", day: "2026-12-23", lastDay: "2027-01-08" });
    expect(onBoxDay(range, "2026-10-01", AT)).toBe(range);
    expect(onBoxDay(TOOLBOX, "2026-10-14", AT)).toBe(TOOLBOX);
  });

  it("is no day outside the twelve months, or that is not a day, and she asks as ever", () => {
    const bare = line();
    for (const day of ["2026-08-31", "2027-09-01", "2026-02-30", "2026-9-30", "", null, undefined]) {
      expect(onBoxDay(bare, day, AT)).toBe(bare);
    }
    expect(lineDates(onBoxDay(bare, "2027-09-01", AT), AT)).toEqual({ ok: false, why: "no-day" });
  });
});

describe("the days the business is already closed", () => {
  const NSW = [
    { date: "2026-10-05", name: "Labour Day" },
    { date: "2026-12-25", name: "Christmas Day" },
    { date: "2026-12-26", name: "Boxing Day" },
    { date: "2026-12-28", name: "Boxing Day (additional day)" },
    { date: "2027-03-26", name: "Good Friday" },
  ];
  const one = (day: string, lastDay: string | null = null) => ({ ok: true as const, days: [day], lastDay });

  it("says a claimed public holiday is already on, or that its day isn't one, and never files it", () => {
    expect(holidayClaimLine(one("2026-10-05"), NSW, "NSW")).toBe("Labour Day is already on the calendar.");
    expect(holidayClaimLine(one("2026-12-25", "2026-12-26"), NSW, "NSW")).toBe(
      "Christmas Day and Boxing Day are already on the calendar.",
    );
    expect(holidayClaimLine(one("2026-09-28"), NSW, "NSW")).toBe(
      "Mon 28 Sept isn't a public holiday in NSW. If the yard's closed, say it's a shutdown.",
    );
    expect(holidayClaimLine(one("2026-12-25", "2026-12-27"), NSW, "NSW")).toBe(
      "Sun 27 Dec isn't a public holiday in NSW. If the yard's closed, say it's a shutdown.",
    );
    expect(holidayClaimLine(one("2026-10-05"), [], null)).toBe(
      "Mon 5 Oct isn't a public holiday on the calendar. If the yard's closed, say it's a shutdown.",
    );
  });

  it("refuses a shutdown only when every day of it is a public holiday already", () => {
    expect(shutdownOnHolidaysLine(one("2026-10-05"), NSW)).toBe("Labour Day is already on the calendar.");
    expect(shutdownOnHolidaysLine(one("2026-12-25", "2026-12-26"), NSW)).toBe(
      "Christmas Day and Boxing Day are already on the calendar.",
    );
    expect(shutdownOnHolidaysLine(one("2026-12-22", "2027-01-06"), NSW)).toBeNull();
    expect(shutdownOnHolidaysLine(one("2026-10-06"), NSW)).toBeNull();
  });

  it("leaves a series' holidays and shutdown days out, and names them", () => {
    expect(openDays(["2026-10-30", "2026-12-25", "2027-01-29", "2027-03-26"], NSW, [])).toEqual({
      days: ["2026-10-30", "2027-01-29"],
      skips: "Skips Christmas Day and Good Friday.",
    });
    const XMAS = { id: "sd", startsOn: "2026-12-23", endsOn: "2027-01-08" };
    expect(openDays(["2026-12-21", "2027-01-06", "2027-01-13"], NSW, [XMAS])).toEqual({
      days: ["2026-12-21", "2027-01-13"],
      skips: "Skips Wed 6 Jan in the shutdown.",
    });
    /* Its first and last days are in it. */
    expect(openDays(["2026-12-22", "2026-12-23", "2027-01-08", "2027-01-09"], [], [XMAS])).toEqual({
      days: ["2026-12-22", "2027-01-09"],
      skips: "Skips 2 dates in the shutdown.",
    });
    /* A holiday inside a shutdown is named as the holiday. */
    expect(openDays(["2026-12-23", "2026-12-28", "2026-12-30", "2027-01-06", "2027-03-26"], NSW, [XMAS])).toEqual({
      days: [],
      skips: "Skips Boxing Day (additional day), Good Friday and 3 dates in the shutdown.",
    });
    const EASTER = { id: "sd2", startsOn: "2027-03-29", endsOn: "2027-04-02" };
    expect(openDays(["2026-12-30", "2027-03-31"], [], [XMAS, EASTER]).skips).toBe("Skips 2 dates in shutdowns.");
    expect(openDays(["2026-10-30"], NSW, [XMAS])).toEqual({ days: ["2026-10-30"], skips: null });
  });
});

describe("a reply kept on an event", () => {
  it("adds to the note as another sentence, never over it", () => {
    expect(withNote(null, " Put it in the  yard ")).toBe("Put it in the yard");
    expect(withNote("Working at heights", "Put it in the yard")).toBe("Working at heights. Put it in the yard");
    expect(withNote("Working at heights.", "Put it in the yard")).toBe("Working at heights. Put it in the yard");
  });

  it("keeps to the table's ceiling", () => {
    expect(withNote("a".repeat(NOTE_MAX), "more")).toHaveLength(NOTE_MAX);
  });
});

describe("what landed", () => {
  const items = [
    { id: "ev:b", start: "2026-11-05" },
    { id: "ev:a", start: "2026-10-01" },
    { id: "ph:2026-10-05", start: "2026-10-05" },
    { id: "ev:c", start: "2026-09-30" },
  ];

  it("chooses the earliest of the events filed, and only those", () => {
    expect(landedEvent(items, ["b", "a"])).toEqual({ id: "ev:a", start: "2026-10-01" });
  });

  it("finds nothing until the calendar has them, and never takes another source's row", () => {
    expect(landedEvent(items, ["zz"])).toBeNull();
    expect(landedEvent(items, ["2026-10-05"])).toBeNull();
  });
});
