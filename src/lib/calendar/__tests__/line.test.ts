import {
  NOTE_MAX,
  filedLine,
  landedEvent,
  lineAbout,
  lineDates,
  lineDoor,
  linePlan,
  notedLine,
  outsideLine,
  takenBackLine,
  withNote,
  type CalendarLine,
  type LineFrame,
} from "../line";

/* A LINE FOR THE CALENDAR, counted and said (H22). His README's own example
   is the spine: "Toolbox talk first Thursday of the month, 6:45", on Thu 24
   Sept 2026, goes on eleven times and Tiff says so in the spec's words. */

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
