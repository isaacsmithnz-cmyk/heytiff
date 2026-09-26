import {
  BAR_PITCH,
  addDayOf,
  agendaRows,
  barTop,
  calFrame,
  chipCounts,
  choiceOf,
  clampAnchor,
  dayDetail,
  detail,
  firstSelection,
  fmtDates,
  fmtDay,
  fmtDayLong,
  fmtDayRange,
  isHome,
  laneReserve,
  longWeekend,
  monthWeeks,
  onCalendar,
  railLists,
  rangeTitle,
  revealDay,
  sameChoice,
  settleChoice,
  settleSelection,
  startNav,
  stepAnchor,
  switchView,
  viewRange,
  visibleItems,
  weekLabel,
  yearMonths,
  type AgendaRow,
  type CalItem,
} from "../model";
import { ADMIN, EVENTS, FRAME, HOLIDAYS, ITEMS, SCHOOL, TODAY } from "./fixtures/nsw-2026";

/* One line per agenda row, so a whole four weeks reads as his screen does. */
function line(r: AgendaRow<CalItem>): string {
  if (r.kind === "week") return `wk ${r.label} | ${r.range}${r.tags.length ? ` | ${r.tags.map((t) => t.label).join(" / ")}` : ""}`;
  if (r.kind === "quiet") return `q ${r.dates} | ${r.text}${r.longWeekend ? " (lw)" : ""}`;
  const flags = [r.today && "today", r.holiday && "hol", r.weekend && "we"].filter(Boolean).join(" ");
  const lines = r.lines.map((l) => l.title + (l.sub ? ` — ${l.sub}` : "") + (l.time ? ` @ ${l.time}` : ""));
  return `day ${r.weekday} ${r.date}${flags ? ` ${flags}` : ""}${lines.length ? ` | ${lines.join(" ; ")}` : ""}`;
}
const agenda = (items: readonly CalItem[], anchor = TODAY, frame = FRAME) => agendaRows(items, anchor, frame).map(line);
const byId = (id: string): CalItem => {
  const x = ITEMS.find((i) => i.id === id);
  if (!x) throw new Error(`no fixture ${id}`);
  return x;
};
const at = (today: string) => calFrame(today, "NSW");

describe("the window and the views", () => {
  it("runs the window from the 1st of this month to the end of the 11th month after", () => {
    expect(FRAME).toEqual({ today: "2026-09-24", windowStart: "2026-09-01", windowEnd: "2027-08-31", stateName: "NSW" });
    expect(calFrame("2026-12-31", "VIC")).toMatchObject({ windowStart: "2026-12-01", windowEnd: "2027-11-30" });
  });

  it("shows today plus 27 days in 4 weeks", () => {
    expect(viewRange("4w", TODAY, FRAME)).toEqual({ start: "2026-09-24", end: "2026-10-21" });
    expect(rangeTitle("4w", TODAY, FRAME)).toBe("24 Sept – 21 Oct");
  });

  it("runs October 2026 from Mon 28 Sept to Sun 1 Nov", () => {
    expect(viewRange("month", "2026-10-14", FRAME)).toEqual({ start: "2026-09-28", end: "2026-11-01" });
    expect(rangeTitle("month", "2026-10-14", FRAME)).toBe("October 2026");
  });

  it("gives a month that starts on a Monday exactly its own weeks (Feb 2027)", () => {
    expect(viewRange("month", "2027-02-10", FRAME)).toEqual({ start: "2027-02-01", end: "2027-02-28" });
  });

  it("runs Year from this month for twelve months", () => {
    expect(viewRange("year", "2027-03-05", FRAME)).toEqual({ start: "2026-09-01", end: "2027-08-31" });
    expect(rangeTitle("year", TODAY, FRAME)).toBe("Sept 2026 – Aug 2027");
  });

  it("steps four weeks, and clamps at the window's edges", () => {
    expect(stepAnchor("4w", TODAY, 1, FRAME)).toBe("2026-10-22");
    expect(stepAnchor("4w", TODAY, -1, FRAME)).toBe("2026-09-01");
    expect(stepAnchor("4w", "2026-09-01", -1, FRAME)).toBeNull();
    expect(stepAnchor("4w", "2027-07-20", 1, FRAME)).toBe("2027-08-04");
    expect(stepAnchor("4w", "2027-08-04", 1, FRAME)).toBeNull();
  });

  it("steps a month, and rests at Sept 2026 and Aug 2027", () => {
    expect(stepAnchor("month", "2026-10-14", 1, FRAME)).toBe("2026-11-01");
    expect(stepAnchor("month", "2026-10-14", -1, FRAME)).toBe("2026-09-01");
    expect(stepAnchor("month", TODAY, -1, FRAME)).toBeNull();
    expect(stepAnchor("month", "2027-08-01", 1, FRAME)).toBeNull();
    expect(stepAnchor("month", "2027-07-10", 1, FRAME)).toBe("2027-08-01"); // the window's last month is reachable
  });

  it("rests both of Year's arrows: the window is one year", () => {
    expect(stepAnchor("year", TODAY, -1, FRAME)).toBeNull();
    expect(stepAnchor("year", TODAY, 1, FRAME)).toBeNull();
  });

  it("clamps an anchor into the window for the view", () => {
    expect(clampAnchor("4w", "2027-08-20", FRAME)).toBe("2027-08-04");
    expect(clampAnchor("month", "2027-08-20", FRAME)).toBe("2027-08-20");
    expect(clampAnchor("month", "2026-08-20", FRAME)).toBe("2026-09-01");
  });

  it("rests Today when today's range is already in view", () => {
    expect(isHome("4w", TODAY, FRAME)).toBe(true);
    expect(isHome("4w", "2026-10-22", FRAME)).toBe(false);
    expect(isHome("month", "2026-09-01", FRAME)).toBe(true);
    expect(isHome("month", "2026-10-01", FRAME)).toBe(false);
    expect(isHome("year", "2027-05-01", FRAME)).toBe(true);
  });

  it("refuses a frame or an anchor that is not an ISO day", () => {
    expect(() => viewRange("4w", "24/09/2026", FRAME)).toThrow(/anchor/);
    expect(() => calFrame("2026-09-31", "NSW")).toThrow(/today/);
  });
});

describe("switching views", () => {
  it("brings 4 weeks back to where it stood when the month has not changed", () => {
    const nav = { view: "4w" as const, anchor: "2026-10-22", a4: TODAY };
    const month = switchView(nav, "month", FRAME);
    expect(month).toEqual({ view: "month", anchor: "2026-10-22", a4: "2026-10-22" });
    expect(switchView(month, "4w", FRAME)).toEqual({ view: "4w", anchor: "2026-10-22", a4: "2026-10-22" });
  });

  it("takes 4 weeks to today when Month moved back to this month", () => {
    const nav = { view: "month" as const, anchor: "2026-09-01", a4: "2026-10-22" };
    expect(switchView(nav, "4w", FRAME).anchor).toBe(TODAY);
  });

  it("takes 4 weeks to the 1st of the month Month was on otherwise", () => {
    const nav = { view: "month" as const, anchor: "2026-12-01", a4: TODAY };
    expect(switchView(nav, "4w", FRAME).anchor).toBe("2026-12-01");
    const late = { view: "month" as const, anchor: "2027-08-01", a4: TODAY };
    expect(switchView(late, "4w", FRAME).anchor).toBe("2027-08-01"); // 1 – 28 Aug, inside the window
  });

  it("leaves the place alone when the view is the same", () => {
    const nav = startNav(FRAME);
    expect(switchView(nav, "4w", FRAME)).toBe(nav);
  });

  it("reveals a day just added: four weeks stay on today when it is inside them", () => {
    const nav = startNav(FRAME);
    expect(revealDay(nav, "2026-10-10", FRAME)).toBe(nav);
    expect(revealDay({ ...nav, anchor: "2026-11-19" }, "2026-10-10", FRAME).anchor).toBe(TODAY);
    expect(revealDay(nav, "2026-11-15", FRAME).anchor).toBe("2026-11-15");
    expect(revealDay(nav, "2026-10-22", FRAME).anchor).toBe("2026-10-22"); // today + 28, one past the four weeks
    expect(revealDay(nav, "2027-08-30", FRAME).anchor).toBe("2027-08-04");
    expect(revealDay({ view: "month", anchor: TODAY, a4: TODAY }, "2027-01-10", FRAME).anchor).toBe("2027-01-10");
  });
});

describe("4 weeks: the agenda", () => {
  it("gives a row only to a day with something on, plus today, and folds the rest (his screen)", () => {
    expect(agenda(ITEMS)).toEqual([
      "wk This week | 24 – 27 Sept",
      "day Thu 24 today",
      "q 25 – 27 | Fri – Sun, nothing on",
      "wk Next week | 28 Sept – 4 Oct | School holidays all week",
      "day Mon 28 | School holidays start — NSW public schools, until Fri 9 Oct.",
      "q 29 – 30 | Tue – Wed, nothing on",
      "day Thu 1 | Toolbox talk — The yard. This month: working at heights. @ 6:45 am",
      "q 2 | Fri, nothing on",
      "q 3 – 4 | Sat – Sun, long weekend (lw)",
      "wk In 2 weeks | 5 – 11 Oct | School holidays until Fri 9",
      "day Mon 5 hol | Labour Day — Public holiday in NSW. Long weekend, Sat 3 – Mon 5 Oct.",
      "q 6 – 7 | Tue – Wed, nothing on",
      "day Thu 8 | Daikin VRV training @ 7:30 am",
      "q 9 – 11 | Fri – Sun, nothing on",
      "wk In 3 weeks | 12 – 18 Oct",
      "q 12 – 13 | Mon – Tue, nothing on",
      "day Wed 14 | Team meeting @ 3:30 pm",
      "q 15 – 18 | Thu – Sun, nothing on",
      "wk In 4 weeks | 19 – 21 Oct",
      "q 19 | Mon, nothing on",
      "day Tue 20 | Trailer, TC22BJ rego — From Assets.",
      "q 21 | Wed, nothing on",
    ]);
  });

  it("gives an empty today its row, which the page words as nothing on today", () => {
    const rows = agendaRows([], TODAY, FRAME);
    const today = rows.find((r) => r.kind === "day");
    expect(today).toMatchObject({ kind: "day", day: TODAY, today: true, lines: [] });
    expect(rows.filter((r) => r.kind === "day")).toHaveLength(1);
  });

  /* A quiet run is its first day's button (2026-09-26), and "Sat – Sun"
     comes round every week: its name carries its dates. */
  it("names each quiet run by its dates, a long weekend's as one", () => {
    const labels = agendaRows(ITEMS, TODAY, FRAME).flatMap((r) => (r.kind === "quiet" ? [r.label] : []));
    expect(labels.slice(0, 4)).toEqual([
      "Fri 25 – Sun 27 Sept, nothing on",
      "Tue 29 – Wed 30 Sept, nothing on",
      "Fri 2 Oct, nothing on",
      "Sat 3 – Sun 4 Oct, long weekend",
    ]);
  });

  it("splits a quiet run at a month boundary", () => {
    const rows = agenda(ITEMS, "2026-10-26");
    expect(rows.slice(0, 7)).toEqual([
      "wk In 5 weeks | 26 Oct – 1 Nov",
      "q 26 – 31 | Mon – Sat, nothing on",
      "q 1 | Sun, nothing on",
      "wk In 6 weeks | 2 – 8 Nov",
      "q 2 – 8 | Mon – Sun, nothing on",
      "wk In 7 weeks | 9 – 15 Nov",
      "q 9 | Mon, nothing on",
    ]);
    expect(rows[7]).toBe("day Tue 10 | Public liability insurance — QBE Insurance (Australia) Ltd. From Admin.");
  });

  it("reads Christmas as his screen does: long weekends either side of a holiday, the shutdown tagged", () => {
    expect(agenda(ITEMS, "2026-12-10")).toEqual([
      "wk In 11 weeks | 10 – 13 Dec",
      "q 10 | Thu, nothing on",
      "day Fri 11 | Christmas party @ 6:00 pm ; Zucky, EVD72G rego — From Assets.",
      "q 12 – 13 | Sat – Sun, nothing on",
      "wk In 12 weeks | 14 – 20 Dec | School holidays from Fri",
      "q 14 – 17 | Mon – Thu, nothing on",
      "day Fri 18 | School holidays start — NSW public schools, until Wed 27 Jan.",
      "q 19 – 20 | Sat – Sun, nothing on",
      "wk In 13 weeks | 21 – 27 Dec | School holidays all week / Shutdown from Wed",
      "q 21 – 22 | Mon – Tue, nothing on",
      "day Wed 23 | Christmas shutdown — Office and crews off. Back Mon 11 Jan.",
      "q 24 | Thu, nothing on",
      "day Fri 25 hol | Christmas Day — Public holiday in NSW. Long weekend, Fri 25 – Mon 28 Dec.",
      "day Sat 26 hol | Boxing Day — Public holiday in NSW. Long weekend, Fri 25 – Mon 28 Dec.",
      "q 27 | Sun, long weekend (lw)",
      "wk In 14 weeks | 28 Dec – 3 Jan | School holidays all week / Shutdown all week",
      "day Mon 28 hol | Boxing Day (additional day) — Public holiday in NSW. Long weekend, Fri 25 – Mon 28 Dec.",
      "q 29 – 31 | Tue – Thu, nothing on",
      "day Fri 1 hol | New Year’s Day — Public holiday in NSW. Long weekend, Fri 1 – Sun 3 Jan.",
      "q 2 – 3 | Sat – Sun, long weekend (lw)",
      "wk In 15 weeks | 4 – 6 Jan | School holidays all week / Shutdown all week",
      "q 4 – 6 | Mon – Wed, nothing on",
    ]);
  });

  it("keeps the working days before a long weekend on their own line", () => {
    const rows = agenda(ITEMS);
    expect(rows).toContain("q 2 | Fri, nothing on");
    expect(rows).toContain("q 3 – 4 | Sat – Sun, long weekend (lw)");
    expect(rows.some((r) => r.startsWith("q 2 – 4"))).toBe(false);
  });

  it("reads the weekend after a Friday holiday as long, and the days after Labour Day as quiet", () => {
    const friday: CalItem = { id: "ph:f", cat: "hol", start: "2026-10-16", end: "2026-10-16", title: "Show Day" };
    expect(agenda([friday], "2026-10-12")).toEqual([
      "wk In 3 weeks | 12 – 18 Oct",
      "q 12 – 15 | Mon – Thu, nothing on",
      "day Fri 16 hol | Show Day — Public holiday in NSW. Long weekend, Fri 16 – Sun 18 Oct.",
      "q 17 – 18 | Sat – Sun, long weekend (lw)",
      "wk In 4 weeks | 19 – 25 Oct",
      "q 19 – 25 | Mon – Sun, nothing on",
      "wk In 5 weeks | 26 Oct – 1 Nov",
      "q 26 – 31 | Mon – Sat, nothing on",
      "q 1 | Sun, nothing on",
      "wk In 6 weeks | 2 – 8 Nov",
      "q 2 – 8 | Mon – Sun, nothing on",
    ]);
    const job: CalItem = { id: "ev:t", cat: "event", start: "2026-10-09", end: "2026-10-09", title: "Friday job" };
    expect(agenda([byId("ph:labour"), job], "2026-10-05").slice(0, 4)).toEqual([
      "wk In 2 weeks | 5 – 11 Oct",
      "day Mon 5 hol | Labour Day — Public holiday in NSW. Long weekend, Sat 3 – Mon 5 Oct.",
      "q 6 – 8 | Tue – Thu, nothing on",
      "day Fri 9 | Friday job",
    ]);
  });

  it("calls a quiet day long only where the holiday's own line does: a Saturday Anzac Day makes no long weekend", () => {
    const anzac: CalItem = { id: "ph:anzac26", cat: "hol", start: "2026-04-25", end: "2026-04-25", title: "Anzac Day" };
    const rows = agenda([anzac], "2026-04-20", at("2026-04-20"));
    expect(rows.slice(0, 5)).toEqual([
      "wk This week | 20 – 26 Apr",
      "day Mon 20 today",
      "q 21 – 24 | Tue – Fri, nothing on",
      "day Sat 25 hol | Anzac Day — Public holiday in NSW.",
      "q 26 | Sun, nothing on",
    ]);
    expect(longWeekend("2026-04-26", [anzac])).toBeNull();
  });

  it("reads both days of a long weekend a month end splits as long (Labour Day, Mon 2 Oct 2028)", () => {
    const labour: CalItem = { id: "ph:labour28", cat: "hol", start: "2028-10-02", end: "2028-10-02", title: "Labour Day" };
    expect(agenda([labour], "2028-09-25", at("2028-09-25")).slice(0, 7)).toEqual([
      "wk This week | 25 Sept – 1 Oct",
      "day Mon 25 today",
      "q 26 – 29 | Tue – Fri, nothing on",
      "q 30 | Sat, long weekend (lw)",
      "q 1 | Sun, long weekend (lw)",
      "wk Next week | 2 – 8 Oct",
      "day Mon 2 hol | Labour Day — Public holiday in NSW. Long weekend, Sat 30 Sept – Mon 2 Oct.",
    ]);
  });

  it("keeps the Sunday of a Friday holiday's long weekend long when the Saturday has an event", () => {
    const friday: CalItem = { id: "ph:f", cat: "hol", start: "2026-10-16", end: "2026-10-16", title: "Show Day" };
    const sat: CalItem = { id: "ev:sat", cat: "event", start: "2026-10-17", end: "2026-10-17", title: "Open day" };
    expect(agenda([friday, sat], "2026-10-12").slice(0, 5)).toEqual([
      "wk In 3 weeks | 12 – 18 Oct",
      "q 12 – 15 | Mon – Thu, nothing on",
      "day Fri 16 hol | Show Day — Public holiday in NSW. Long weekend, Fri 16 – Sun 18 Oct.",
      "day Sat 17 we | Open day",
      "q 18 | Sun, long weekend (lw)",
    ]);
  });

  it("labels the weeks from today's week, back past today too", () => {
    expect(weekLabel(0)).toBe("This week");
    expect(weekLabel(1)).toBe("Next week");
    expect(weekLabel(2)).toBe("In 2 weeks");
    expect(weekLabel(-1)).toBe("Last week");
    expect(weekLabel(-3)).toBe("3 weeks ago");
    expect(agenda(ITEMS, "2026-09-01")[0]).toBe("wk 3 weeks ago | 1 – 6 Sept");
  });

  it("orders a day: holiday, school holidays, events by time, then admin", () => {
    const day = "2026-10-05";
    const mk = (id: string, cat: CalItem["cat"], time?: string, end = day): CalItem => ({ id, cat, start: day, end, title: id, time });
    const rows = agendaRows(
      [mk("admin", "admin"), mk("late event", "event", "15:00"), mk("school", "school", undefined, "2026-10-09"), mk("early event", "event", "07:00"), mk("holiday", "hol")],
      day,
      FRAME,
    );
    const first = rows.find((r) => r.kind === "day");
    expect(first?.kind === "day" && first.lines.map((l) => l.item.id)).toEqual(["holiday", "school", "early event", "late event", "admin"]);
  });

  it('says where a span inside one week starts and ends: "Shutdown from Tue until Thu 15"', () => {
    const shut: CalItem = { id: "ev:s", cat: "event", start: "2026-10-13", end: "2026-10-15", title: "Stocktake", shutdown: true };
    expect(agenda([shut])).toContain("wk In 3 weeks | 12 – 18 Oct | Shutdown from Tue until Thu 15");
  });

  it("tags an event over days by its title, and still gives its first day a row", () => {
    const course: CalItem = { id: "ev:c", cat: "event", start: "2026-10-13", end: "2026-10-14", title: "Course" };
    const rows = agendaRows([course], TODAY, FRAME);
    expect(rows.map(line)).toContain("wk In 3 weeks | 12 – 18 Oct | Course from Tue until Wed 14");
    expect(rows.map(line)).toContain("day Tue 13 | Course");
    const wk = rows.find((r) => r.kind === "week" && r.start === "2026-10-12");
    expect(wk?.kind === "week" && wk.tags.map((t) => t.kind)).toEqual(["event"]);
  });

  it("shows a two-day event on its second day, begun before the anchor", () => {
    const course: CalItem = { id: "ev:c", cat: "event", start: "2026-09-30", end: "2026-10-01", title: "Course" };
    expect(agenda([course], "2026-10-01", at("2026-10-01")).slice(0, 2)).toEqual([
      "wk This week | 1 – 4 Oct | Course until Thu 1",
      "day Thu 1 today",
    ]);
  });

  it("marks a weekend day row quiet, and a holiday on a weekend as a holiday", () => {
    const sat: CalItem = { id: "ev:sat", cat: "event", start: "2026-09-26", end: "2026-09-26", title: "Open day" };
    expect(agenda([sat])).toContain("day Sat 26 we | Open day");
    expect(agenda(ITEMS, "2026-12-10")).toContain(
      "day Sat 26 hol | Boxing Day — Public holiday in NSW. Long weekend, Fri 25 – Mon 28 Dec.",
    );
  });

  it("drops an item whose start is not a day, and treats an end before the start as one day", () => {
    const bad: CalItem = { id: "ev:bad", cat: "event", start: "2026-13-01", end: "2026-13-01", title: "Bad" };
    const back: CalItem = { id: "ev:back", cat: "event", start: "2026-10-01", end: "2026-09-29", title: "Backwards" };
    const rows = agenda([bad, back]);
    expect(rows.join("\n")).not.toContain("Bad");
    expect(rows).toContain("day Thu 1 | Backwards");
    const oct = monthWeeks([back], "2026-10-01", FRAME);
    expect(oct.flatMap((w) => w.bars)).toEqual([]);
    expect(oct[0].cells[3].items.map((i) => i.title)).toEqual(["Backwards"]);
    // and the Year and the chips still find it on its day, as they find one with no end at all
    const noEnd: CalItem = { id: "ev:noend", cat: "event", start: "2026-10-02", end: "", title: "No end" };
    const cells = yearMonths([back, noEnd], TODAY, FRAME).flatMap((m) => m.cells);
    expect(cells.find((c) => c.day === "2026-10-01")).toMatchObject({ dot: "event", ring: "ev:back" });
    expect(cells.find((c) => c.day === "2026-10-02")).toMatchObject({ dot: "event", ring: "ev:noend" });
    expect(chipCounts([back, noEnd], viewRange("4w", TODAY, FRAME), { admin: false, school: false })[1].count).toBe(2);
  });

  it("gives every row a key of its own", () => {
    const keys = agendaRows(ITEMS, "2026-12-10", FRAME).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never reads the clock: the frame's today is the only today", () => {
    const before = agenda(ITEMS);
    jest.useFakeTimers({ now: new Date("2031-06-15T03:00:00Z") });
    try {
      expect(agenda(ITEMS)).toEqual(before);
      expect(railLists(ITEMS, FRAME, 30).due.map((r) => r.away)).toEqual([null, "26 days"]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("long weekends", () => {
  it("finds the weekend a holiday joins: Labour Day makes Sat 3 – Mon 5 Oct", () => {
    expect(longWeekend("2026-10-05", HOLIDAYS)).toEqual({ start: "2026-10-03", end: "2026-10-05" });
    expect(longWeekend("2027-03-26", HOLIDAYS)).toEqual({ start: "2027-03-26", end: "2027-03-29" });
    expect(longWeekend("2027-01-01", HOLIDAYS)).toEqual({ start: "2027-01-01", end: "2027-01-03" });
  });

  it("finds none for a holiday on a Tuesday", () => {
    expect(longWeekend("2027-01-26", HOLIDAYS)).toBeNull();
  });

  it("finds none for two days off midweek: Christmas on a Tuesday and Boxing Day (2029)", () => {
    const hol = (day: string): CalItem => ({ id: `ph:${day}`, cat: "hol", start: day, end: day, title: day });
    const both = [hol("2029-12-25"), hol("2029-12-26")];
    expect(longWeekend("2029-12-25", both)).toBeNull();
    expect(longWeekend("2029-12-26", both)).toBeNull();
  });

  it("finds none for a working day beside one", () => {
    expect(longWeekend("2026-10-06", HOLIDAYS)).toBeNull();
    expect(longWeekend("2026-10-02", HOLIDAYS)).toBeNull();
  });
});

describe("the rail", () => {
  it("puts overdue first, then what is due inside the window, by date", () => {
    const { due } = railLists(ITEMS, FRAME, 30);
    expect(due.map((r) => [r.title, r.sub, r.late, r.away])).toEqual([
      ["Spare van, CY14FE rego", "Ran out Thu 17 Sept.", true, null],
      ["Trailer, TC22BJ rego", "Due Tue 20 Oct.", false, "26 days"],
    ]);
  });

  it("follows the org's warning window, not a fixed 30", () => {
    expect(railLists(ITEMS, FRAME, 14).due.map((r) => r.item.id)).toEqual(["veh:cy14:rego"]);
    expect(railLists(ITEMS, FRAME, 60).due.map((r) => [r.item.id, r.away])).toEqual([
      ["veh:cy14:rego", null],
      ["veh:tc22:rego", "26 days"],
      ["cred:pl", "47 days"],
    ]);
    expect(railLists(ITEMS, FRAME, 90).due.map((r) => r.away)).toEqual([null, "26 days", "47 days", "Dec"]);
  });

  it("counts due on its last day, and today as Today", () => {
    const today: CalItem = { id: "a:t", cat: "admin", start: TODAY, end: TODAY, title: "Due today" };
    const edge: CalItem = { id: "a:e", cat: "admin", start: "2026-10-24", end: "2026-10-24", title: "Day 30" };
    const past: CalItem = { id: "a:p", cat: "admin", start: "2026-10-25", end: "2026-10-25", title: "Day 31" };
    expect(railLists([today, edge, past], FRAME, 30).due.map((r) => [r.title, r.away])).toEqual([
      ["Due today", "Today"],
      ["Day 30", "30 days"],
    ]);
    const tomorrow: CalItem = { id: "a:1", cat: "admin", start: "2026-09-25", end: "2026-09-25", title: "Tomorrow" };
    expect(railLists([tomorrow], FRAME, 30).due[0].away).toBe("1 day");
  });

  it("trusts the overdue flag over the date, so Due and the bell never disagree", () => {
    // The flag comes from the same expiry state the bell reads; a late item
    // on today's date (another clock's today) still leads the list.
    const late: CalItem = { id: "veh:u:rego", cat: "admin", start: TODAY, end: TODAY, title: "Ute, AB12CD rego", overdue: true };
    const soon: CalItem = { id: "veh:h:rego", cat: "admin", start: TODAY, end: TODAY, title: "Hiace van, EF34GH rego" };
    expect(railLists([soon, late], FRAME, 30).due.map((r) => [r.item.id, r.late, r.away])).toEqual([
      ["veh:u:rego", true, null],
      ["veh:h:rego", false, "Today"],
    ]);
  });

  it("keeps an item the flag calls due in Due even when its date is behind this today", () => {
    // the reverse of the case above: the bell still warns on it, so Due must hold it
    const due: CalItem = { id: "veh:y:rego", cat: "admin", start: "2026-09-23", end: "2026-09-23", title: "Ute, AB12CD rego" };
    expect(railLists([due], FRAME, 30).due.map((r) => [r.item.id, r.sub, r.late, r.away])).toEqual([
      ["veh:y:rego", "Due Wed 23 Sept.", false, null],
    ]);
  });

  it("takes the org's window every time, never a default", () => {
    expect(() => railLists(ITEMS, FRAME, undefined as unknown as number)).toThrow(/warnDays/);
    expect(() => railLists(ITEMS, FRAME, -1)).toThrow(/warnDays/);
    // @ts-expect-error the window is orgExpiryWindow's number, so leaving it out does not compile
    expect(() => railLists(ITEMS, FRAME)).toThrow(/warnDays/);
    expect(railLists(ITEMS, FRAME, 0).due.map((r) => r.item.id)).toEqual(["veh:cy14:rego"]);
  });

  it('reads the right side in days under 60, then as the month: "59 days", "Nov"', () => {
    const hol = (start: string): CalItem => ({ id: `ph:${start}`, cat: "hol", start, end: start, title: start });
    expect(railLists([hol("2026-11-22"), hol("2026-11-23")], FRAME, 30).holidays.map((r) => r.away)).toEqual(["59 days", "Nov"]);
  });

  it("holds the next 6 public holidays and shutdowns from today", () => {
    const { holidays } = railLists(ITEMS, FRAME, 30);
    expect(holidays.map((r) => [r.title, r.sub, r.away])).toEqual([
      ["Labour Day", "Mon 5 Oct", "11 days"],
      ["Christmas shutdown", "Wed 23 Dec – Fri 8 Jan", "Dec"],
      ["Christmas Day", "Fri 25 Dec", "Dec"],
      ["Boxing Day", "Sat 26 Dec", "Dec"],
      ["Boxing Day (additional day)", "Mon 28 Dec", "Dec"],
      ["New Year’s Day", "Fri 1 Jan", "Jan"],
    ]);
  });

  it("hides what a chip turned off, from the rail as from the view", () => {
    const vis = visibleItems(ITEMS, { admin: true, event: true });
    const rail = railLists(vis, FRAME, 30);
    expect(rail.due).toEqual([]);
    expect(rail.holidays.map((r) => r.title)).not.toContain("Christmas shutdown");
    expect(agenda(vis).join("\n")).not.toContain("Toolbox talk");
  });
});

describe("chips", () => {
  it("counts each category in the visible range; school holidays carry no count", () => {
    const r = viewRange("4w", TODAY, FRAME);
    expect(chipCounts(ITEMS, r, { admin: true, school: true })).toEqual([
      { cat: "hol", label: "Public holidays", count: 1 },
      { cat: "event", label: "Events", count: 3 },
      { cat: "admin", label: "Admin", count: 1 },
      { cat: "school", label: "School holidays", count: null },
    ]);
    const year = viewRange("year", TODAY, FRAME);
    expect(chipCounts(ITEMS, year, { admin: true, school: true }).map((c) => c.count)).toEqual([13, 5, 7, null]);
  });

  it("counts a span that only touches the range", () => {
    const r = viewRange("4w", "2027-01-05", FRAME);
    const counts = chipCounts(ITEMS, r, { admin: true, school: true });
    expect(counts.find((c) => c.cat === "event")?.count).toBe(1); // the shutdown, 23 Dec – 8 Jan
  });

  it("leaves Admin out without admin data, and School holidays where the state has none", () => {
    const r = viewRange("4w", TODAY, FRAME);
    expect(chipCounts(ITEMS, r, { admin: false, school: false }).map((c) => c.cat)).toEqual(["hol", "event"]);
  });

  it("keeps the counts when a chip is turned off", () => {
    const r = viewRange("4w", TODAY, FRAME);
    const all = chipCounts(ITEMS, r, { admin: true, school: true });
    expect(visibleItems(ITEMS, { event: true }).some((x) => x.cat === "event")).toBe(false);
    expect(chipCounts(ITEMS, r, { admin: true, school: true })).toEqual(all);
  });
});

describe("the selection", () => {
  it("starts on the first thing from today that is not already late", () => {
    expect(firstSelection(ITEMS, FRAME)).toBe("sch:spring26");
    expect(firstSelection(visibleItems(ITEMS, { school: true }), FRAME)).toBe("ev:toolbox");
    expect(firstSelection([byId("veh:cy14:rego")], FRAME)).toBe("veh:cy14:rego");
    expect(firstSelection([], FRAME)).toBeNull();
  });

  it("skips a late item by its flag, not its date", () => {
    const late: CalItem = { id: "a:late", cat: "admin", start: TODAY, end: TODAY, title: "A rego", overdue: true };
    const next: CalItem = { id: "a:next", cat: "admin", start: TODAY, end: TODAY, title: "B rego" };
    expect(firstSelection([late, next], FRAME)).toBe("a:next");
  });

  it("keeps a selection still shown, and moves off one a chip hid", () => {
    expect(settleSelection("ev:daikin", ITEMS, FRAME)).toBe("ev:daikin");
    expect(settleSelection("ev:daikin", visibleItems(ITEMS, { event: true }), FRAME)).toBe("sch:spring26");
    expect(settleSelection("ev:daikin", [], FRAME)).toBe("ev:daikin");
    expect(settleSelection(null, ITEMS, FRAME)).toBe("sch:spring26");
  });
});

/* "simplify it. how does a calendar normally add things in?" (Isaac,
   2026-09-26): you click a day and add to it. The choice is a thing or a
   day, and the box adds to the day it names. */
describe("the one choice: a thing, or a day", () => {
  it("says which days are on the calendar: its twelve months, and nothing that is not a day", () => {
    expect(onCalendar("2026-09-01", FRAME)).toBe(true);
    expect(onCalendar("2027-08-31", FRAME)).toBe(true);
    expect(onCalendar("2026-08-31", FRAME)).toBe(false);
    expect(onCalendar("2027-09-01", FRAME)).toBe(false);
    expect(onCalendar("2026-02-30", FRAME)).toBe(false);
    expect(onCalendar("soon", FRAME)).toBe(false);
  });

  it("holds a day picked whatever is shown, while it is on the calendar", () => {
    const day = { day: "2026-10-14" };
    expect(choiceOf(day, [], FRAME)).toBe(day);
    expect(choiceOf(day, visibleItems(ITEMS, { event: true }), FRAME)).toBe(day);
    expect(choiceOf({ day: "2026-08-31" }, ITEMS, FRAME)).toEqual({ id: "sch:spring26", settled: true });
  });

  it("holds a thing picked while it is shown, and stands in the first thing from today, settled, otherwise", () => {
    const daikin = { id: "ev:daikin" };
    expect(choiceOf(daikin, ITEMS, FRAME)).toBe(daikin);
    expect(choiceOf(daikin, visibleItems(ITEMS, { event: true }), FRAME)).toEqual({ id: "sch:spring26", settled: true });
    expect(choiceOf(null, ITEMS, FRAME)).toEqual({ id: "sch:spring26", settled: true });
    expect(choiceOf(null, [], FRAME)).toBeNull();
  });

  it("settles a thing as settleSelection does, and never moves a day", () => {
    const day = { day: "2026-10-01" };
    expect(settleChoice(day, [], FRAME)).toBe(day);
    expect(settleChoice(day, visibleItems(ITEMS, { event: true, school: true }), FRAME)).toBe(day);
    const daikin = { id: "ev:daikin" };
    expect(settleChoice(daikin, ITEMS, FRAME)).toBe(daikin);
    expect(settleChoice(daikin, visibleItems(ITEMS, { event: true }), FRAME)).toEqual({ id: "sch:spring26", settled: true });
    expect(settleChoice(daikin, [], FRAME)).toBe(daikin);
    expect(settleChoice(null, ITEMS, FRAME)).toEqual({ id: "sch:spring26", settled: true });
    expect(settleChoice(null, [], FRAME)).toBeNull();
  });

  it("knows the same choice, whoever made it, and never takes a day for a thing", () => {
    expect(sameChoice({ id: "ev:daikin" }, { id: "ev:daikin", settled: true })).toBe(true);
    expect(sameChoice({ day: "2026-10-01" }, { day: "2026-10-01" })).toBe(true);
    expect(sameChoice({ day: "2026-10-01" }, { day: "2026-10-02" })).toBe(false);
    expect(sameChoice({ day: "2026-10-01" }, { id: "2026-10-01" })).toBe(false);
    expect(sameChoice(null, { id: "ev:daikin" })).toBe(false);
  });

  it("adds to the day picked, else the first day of the thing picked, else today", () => {
    expect(addDayOf({ day: "2026-10-14" }, ITEMS, FRAME)).toBe("2026-10-14");
    expect(addDayOf({ id: "ev:shutdown" }, ITEMS, FRAME)).toBe("2026-12-23");
    expect(addDayOf({ id: "veh:cy14:rego" }, ITEMS, FRAME)).toBe("2026-09-17");
    // the page's own choice is nobody's day to add to
    expect(addDayOf({ id: "ev:shutdown", settled: true }, ITEMS, FRAME)).toBe(TODAY);
    expect(addDayOf(null, ITEMS, FRAME)).toBe(TODAY);
    // a thing begun before the calendar was, a thing gone, or a day past it: today
    expect(addDayOf({ id: "veh:cy14:rego" }, ITEMS, at("2026-10-02"))).toBe("2026-10-02");
    expect(addDayOf({ id: "ev:gone" }, ITEMS, FRAME)).toBe(TODAY);
    expect(addDayOf({ day: "2027-09-01" }, ITEMS, FRAME)).toBe(TODAY);
  });
});

describe("a day in the panel", () => {
  it("names the day in full, with no year, as the twelve months hold each month once", () => {
    expect(fmtDayLong("2026-10-01")).toBe("Thursday 1 October");
    expect(dayDetail(ITEMS, "2027-01-01").title).toBe("Friday 1 January");
    expect(dayDetail(ITEMS, "2026-09-30").title).toBe("Wednesday 30 September");
  });

  it("lists everything on the day in a day's order: holiday, school holidays, events by time, then admin", () => {
    const lines = (day: string, vis = ITEMS) => dayDetail(vis, day).lines.map((l) => [l.item.id, l.title, l.time, l.late]);
    expect(lines("2026-10-05")).toEqual([
      ["ph:labour", "Labour Day", null, false],
      ["sch:spring26", "School holidays", null, false],
    ]);
    // what runs through the day is on it, and an event says its time
    expect(lines("2026-12-30")).toEqual([
      ["sch:summer26", "School holidays", null, false],
      ["ev:shutdown", "Christmas shutdown", null, false],
    ]);
    expect(lines("2026-12-11")).toEqual([
      ["ev:party", "Christmas party", "6:00 pm", false],
      ["veh:evd:rego", "Zucky, EVD72G rego", null, false],
    ]);
    expect(lines("2026-09-17")).toEqual([["veh:cy14:rego", "Spare van, CY14FE rego", null, true]]);
    expect(lines("2026-10-15")).toEqual([]);
    // only what the filters show
    expect(lines("2026-10-05", visibleItems(ITEMS, { school: true }))).toEqual([["ph:labour", "Labour Day", null, false]]);
  });
});

describe("Month", () => {
  const oct = monthWeeks(ITEMS, "2026-10-14", FRAME);

  it("lays out October 2026 in five Monday-first weeks", () => {
    expect(oct.map((w) => `${w.start} ${w.end}`)).toEqual([
      "2026-09-28 2026-10-04",
      "2026-10-05 2026-10-11",
      "2026-10-12 2026-10-18",
      "2026-10-19 2026-10-25",
      "2026-10-26 2026-11-01",
    ]);
    expect(oct[0].cells.map((c) => c.inMonth)).toEqual([false, false, false, true, true, true, true]);
    // the days before the 1st are the calendar's, and a click may pick them
    expect(oct[0].cells.map((c) => c.inWindow)).toEqual([true, true, true, true, true, true, true]);
  });

  /* Only the calendar's days are a click's to pick (2026-09-26): the first
     month's and the last month's whole weeks reach past its twelve months. */
  it("marks the days of the whole weeks past the twelve months as not the calendar's", () => {
    const sept = monthWeeks(ITEMS, "2026-09-10", FRAME).flatMap((w) => w.cells);
    expect(sept[0]).toMatchObject({ day: "2026-08-31", inMonth: false, inWindow: false });
    expect(sept.filter((c) => !c.inWindow).map((c) => c.day)).toEqual(["2026-08-31"]);
    const aug = monthWeeks(ITEMS, "2027-08-10", FRAME).flatMap((w) => w.cells);
    expect(aug.filter((c) => !c.inWindow).map((c) => c.day)).toEqual([
      "2027-09-01",
      "2027-09-02",
      "2027-09-03",
      "2027-09-04",
      "2027-09-05",
    ]);
  });

  it("draws school holidays as a bar per week, square where it carries on", () => {
    expect(oct[0].bars).toHaveLength(1);
    expect(oct[0].bars[0]).toMatchObject({ kind: "school", lane: 0, from: 0, to: 6, continuesBefore: false, continuesAfter: true });
    expect(oct[0].bars[0].left).toBeCloseTo(0);
    expect(oct[0].bars[0].width).toBeCloseTo(100);
    expect(oct[1].bars[0]).toMatchObject({ from: 0, to: 4, continuesBefore: true, continuesAfter: false });
    expect(oct[1].bars[0].width).toBeCloseTo(81.967, 2); // Mon – Fri of a week whose weekend is narrow
    expect(oct[2].bars).toEqual([]);
  });

  it("keeps lanes × 26 + 2 under the date row in a week with bars", () => {
    expect(oct.map((w) => laneReserve(w.lanes))).toEqual([28, 28, 0, 0, 0]);
    expect(laneReserve(2)).toBe(2 * BAR_PITCH + 2);
    expect(barTop(0)).toBe(32);
    expect(barTop(1)).toBe(58);
  });

  it("puts the holiday's name, today, and the month on the 1st and the first cell in the date row", () => {
    const labels = oct.flatMap((w) => w.cells).filter((c) => c.label).map((c) => `${c.day} ${c.labelKind} ${c.label}`);
    expect(labels).toEqual(["2026-09-28 month Sept", "2026-10-01 month Oct", "2026-10-05 holiday Labour Day", "2026-11-01 month Nov"]);
    const sept = monthWeeks(ITEMS, TODAY, FRAME).flatMap((w) => w.cells);
    expect(sept.find((c) => c.day === TODAY)).toMatchObject({ today: true, label: "Today", labelKind: "today" });
  });

  it("sits single-day events and admin in their day, with the time, the plate or Overdue", () => {
    const cells = monthWeeks(ITEMS, TODAY, FRAME).flatMap((w) => w.cells);
    const items = (day: string) => cells.find((c) => c.day === day)?.items.map((i) => `${i.title} / ${i.meta}`);
    expect(items("2026-09-17")).toEqual(["Spare van rego / Overdue"]);
    expect(cells.find((c) => c.day === "2026-09-17")?.items.map((i) => i.overdue)).toEqual([true]);
    expect(items("2026-10-01")).toEqual(["Toolbox talk / 6:45 am"]);
    expect(cells.find((c) => c.day === "2026-10-01")?.items.map((i) => i.overdue)).toEqual([false]);
    const nov = monthWeeks(ITEMS, "2026-11-10", FRAME).flatMap((w) => w.cells);
    expect(nov.find((c) => c.day === "2026-11-10")?.items.map((i) => `${i.title} / ${i.meta}`)).toEqual(["Public liability / Due"]);
    const octCells = oct.flatMap((w) => w.cells);
    expect(octCells.find((c) => c.day === "2026-10-20")?.items.map((i) => `${i.title} / ${i.meta}`)).toEqual(["Trailer rego / TC22BJ"]);
    expect(octCells.find((c) => c.day === "2026-10-08")?.items.map((i) => i.title)).toEqual(["Daikin training"]);
    // the holiday is its date row, never an item or a bar
    expect(octCells.find((c) => c.day === "2026-10-05")?.items).toEqual([]);
  });

  it("gives school holidays the first lane and the shutdown the next (December)", () => {
    const dec = monthWeeks(ITEMS, "2026-12-01", FRAME);
    const wk = (start: string) => dec.find((w) => w.start === start);
    expect(wk("2026-12-14")?.bars.map((b) => [b.kind, b.lane, b.from, b.to, b.continuesBefore, b.continuesAfter])).toEqual([
      ["school", 0, 4, 6, false, true],
    ]);
    expect(wk("2026-12-14")?.bars[0].left).toBeCloseTo(65.574, 2);
    expect(wk("2026-12-21")?.bars.map((b) => [b.kind, b.lane, b.from, b.to, b.continuesBefore, b.continuesAfter])).toEqual([
      ["school", 0, 0, 6, true, true],
      ["shutdown", 1, 2, 6, false, true],
    ]);
    expect(wk("2026-12-21")?.bars[1].left).toBeCloseTo(32.787, 2);
    expect(laneReserve(wk("2026-12-21")?.lanes ?? 0)).toBe(54);
    expect(wk("2026-12-21")?.cells[4].holiday?.title).toBe("Christmas Day");
  });

  it("fills lanes greedily, school holidays first even when they start later", () => {
    const mk = (id: string, cat: CalItem["cat"], start: string, end: string): CalItem => ({ id, cat, start, end, title: id });
    const weeks = monthWeeks(
      [
        mk("course", "event", "2027-03-01", "2027-03-03"), // Mon – Wed
        mk("school", "school", "2027-03-02", "2027-03-05"), // Tue – Fri
        mk("expo", "event", "2027-03-04", "2027-03-05"), // Thu – Fri
        mk("later", "event", "2027-03-06", "2027-03-07"), // Sat – Sun
      ],
      "2027-03-01",
      FRAME,
    );
    // the course starts first but waits for school holidays; the expo fits in behind the course, the weekend behind school
    expect(weeks[0].bars.map((b) => `${b.item.id}:${b.lane}`)).toEqual(["school:0", "course:1", "expo:1", "later:0"]);
    expect(weeks[0].lanes).toBe(2);
    // an event over days that does not close the business is an event's bar, never a shutdown's
    expect(weeks[0].bars.map((b) => `${b.item.id}:${b.kind}`)).toEqual(["school:school", "course:event", "expo:event", "later:event"]);
  });
});

describe("Year", () => {
  const year = yearMonths(ITEMS, TODAY, FRAME);
  const cell = (day: string) => {
    const c = year.flatMap((m) => m.cells).find((x) => x.day === day);
    if (!c) throw new Error(`no cell ${day}`);
    return { fill: c.fill, dot: c.dot, top: c.top?.id ?? null, ring: c.ring, past: c.past, today: c.today, tip: c.tip };
  };

  it("shows twelve months from this month, January with its year, and the holiday counts", () => {
    expect(year.map((m) => m.title)).toEqual([
      "September", "October", "November", "December", "January 2027", "February",
      "March", "April", "May", "June", "July", "August",
    ]);
    expect(year.map((m) => m.note)).toEqual([
      null, "1 holiday", null, "3 holidays", "2 holidays", null, "4 holidays", "2 holidays", null, "1 holiday", null, null,
    ]);
    expect(year[0]).toMatchObject({ key: "2026-09", lead: 1, past: false }); // 1 Sept 2026 is a Tuesday
    expect(year[0].cells).toHaveLength(30);
  });

  it("selects a public holiday first and hides the dot under it", () => {
    expect(cell("2026-10-05")).toMatchObject({ fill: "holiday", dot: null, top: "ph:labour", tip: "Mon 5 Oct: Labour Day, School holidays" });
    expect(cell("2027-03-29")).toMatchObject({
      fill: "holiday",
      dot: null,
      top: "ph:em",
      tip: "Mon 29 Mar: Easter Monday, Hiace van, DM44AO rego",
    });
  });

  it("selects an event or admin item before school holidays, and dots it", () => {
    expect(cell("2026-10-01")).toMatchObject({ fill: "school", dot: "event", top: "ev:toolbox", ring: "ev:toolbox" });
    expect(cell("2027-01-22")).toMatchObject({ fill: "school", dot: "admin", top: "veh:ykg:rego" });
    expect(cell("2026-12-11")).toMatchObject({ fill: null, dot: "event", top: "ev:party", tip: "Fri 11 Dec: Christmas party, Zucky, EVD72G rego" });
  });

  it("dots an overdue item late", () => {
    expect(cell("2026-09-17")).toMatchObject({ dot: "late", top: "veh:cy14:rego", past: true });
  });

  it("selects a shutdown before school holidays, and an event before the shutdown", () => {
    expect(cell("2026-12-23")).toMatchObject({ fill: "shutdown", top: "ev:shutdown", ring: "ev:shutdown" });
    expect(cell("2026-12-24")).toMatchObject({ fill: "shutdown", top: "ev:shutdown", ring: null });
    expect(cell("2026-12-25")).toMatchObject({ fill: "holiday", top: "ph:xmas" });
    const drinks: CalItem = { id: "ev:drinks", cat: "event", start: "2026-12-30", end: "2026-12-30", title: "Drinks" };
    const withDrinks = yearMonths([...ITEMS, drinks], TODAY, FRAME).flatMap((m) => m.cells).find((c) => c.day === "2026-12-30");
    expect(withDrinks).toMatchObject({ fill: "shutdown", dot: "event", ring: "ev:drinks" });
    expect(withDrinks?.top?.id).toBe("ev:drinks");
  });

  it("rings a span only on its first day", () => {
    expect(cell("2026-09-28")).toMatchObject({ fill: "school", top: "sch:spring26", ring: "sch:spring26" });
    expect(cell("2026-09-29")).toMatchObject({ fill: "school", top: "sch:spring26", ring: null });
  });

  it("dots each day of an event that runs over days without closing the business", () => {
    const course: CalItem = { id: "ev:course", cat: "event", start: "2026-11-02", end: "2026-11-03", title: "Course" };
    const cells = yearMonths([course], TODAY, FRAME).flatMap((m) => m.cells);
    const d = (day: string) => cells.find((c) => c.day === day);
    expect(d("2026-11-02")).toMatchObject({ fill: null, dot: "event", ring: "ev:course" });
    expect(d("2026-11-03")).toMatchObject({ fill: null, dot: "event", ring: null });
  });

  it("leaves an empty day unmarked, and marks today", () => {
    expect(cell(TODAY)).toMatchObject({ top: null, tip: null, today: true, fill: null, dot: null });
  });
});

describe("the panel", () => {
  it("words a public holiday with its long weekend", () => {
    expect(detail(byId("ph:labour"), ITEMS, FRAME)).toEqual({
      kicker: "Public holiday",
      when: "Mon 5 Oct",
      status: { text: "In 11 days", tone: "cat" },
      description: "Public holiday in NSW.",
      facts: [
        ["Where", "All of NSW"],
        ["Long weekend", "Sat 3 – Mon 5 Oct"],
        ["From", "NSW public holidays"],
      ],
    });
    expect(detail(byId("ph:aus"), ITEMS, FRAME)?.facts.map((f) => f[0])).toEqual(["Where", "From"]);
  });

  it("words school holidays with students back", () => {
    expect(detail(byId("sch:spring26"), ITEMS, FRAME)).toEqual({
      kicker: "School holidays",
      when: "Mon 28 Sept – Fri 9 Oct",
      status: { text: "Starts in 4 days", tone: "school" },
      description: "NSW public schools, spring break.",
      facts: [
        ["Students back", "Tue 13 Oct"],
        ["From", "NSW school terms"],
      ],
    });
    expect(detail(byId("sch:spring26"), ITEMS, at("2026-10-01"))?.status.text).toBe("On now");
    expect(detail(byId("sch:spring26"), ITEMS, at("2026-10-20"))?.status.text).toBe("Over");
  });

  it("floors months, as every countdown in the app does: 85 days is 2 months", () => {
    expect(detail(byId("sch:summer26"), ITEMS, FRAME)?.status.text).toBe("Starts in 2 months");
    expect(detail(byId("ph:xmas"), ITEMS, FRAME)?.status.text).toBe("In 3 months"); // 92 days
  });

  it("words an event with its times", () => {
    expect(detail(byId("ev:toolbox"), ITEMS, FRAME)).toEqual({
      kicker: "Event",
      when: "Thu 1 Oct, 6:45 – 7:15 am",
      status: { text: "In 7 days", tone: "cat" },
      description: "Monthly safety meeting. This month: working at heights.",
      facts: [
        ["Where", "The yard"],
        ["Who", "Everyone"],
      ],
    });
    expect(detail(byId("ev:party"), ITEMS, FRAME)?.when).toBe("Fri 11 Dec, 6:00 pm");
    expect(detail(byId("ev:shutdown"), ITEMS, at("2026-12-30"))?.status.text).toBe("On now");
  });

  it("words admin due, due soon and late", () => {
    expect(detail(byId("veh:cy14:rego"), ITEMS, FRAME)).toMatchObject({
      kicker: "Admin, overdue",
      when: "Thu 17 Sept",
      status: { text: "7 days late", tone: "late" },
      description: "Overdue. From Assets.",
    });
    expect(detail(byId("veh:tc22:rego"), ITEMS, FRAME)?.status).toEqual({ text: "Due in 26 days", tone: "due" });
    expect(detail(byId("cred:pl"), ITEMS, FRAME)).toMatchObject({
      kicker: "Admin",
      status: { text: "Due in 47 days", tone: "due" },
      description: "Your public liability cover with QBE Insurance (Australia) Ltd runs out on Tue 10 Nov.",
    });
  });

  it("has the status words for every distance", () => {
    const admin = (start: string): CalItem => ({ id: "a", cat: "admin", start, end: start, title: "a" });
    const event = (start: string): CalItem => ({ id: "e", cat: "event", start, end: start, title: "e" });
    const status = (x: CalItem) => detail(x, [], FRAME)?.status.text;
    expect(status(admin("2026-10-02"))).toBe("Due in 8 days");
    expect(status(admin(TODAY))).toBe("Due today");
    expect(status(admin("2026-09-25"))).toBe("Due tomorrow");
    expect(status(admin("2026-09-21"))).toBe("Was due 3 days ago");
    expect(status(event(TODAY))).toBe("Today");
    expect(status(event("2026-09-25"))).toBe("Tomorrow");
    expect(status(event("2026-10-01"))).toBe("In 7 days");
    expect(status(event("2026-09-21"))).toBe("3 days ago");
    expect(status(admin("2026-09-25"))).not.toBe("Due in 1 day");
    expect(status({ ...admin("2026-09-23"), overdue: true })).toBe("1 day late");
    expect(status(event("2026-09-23"))).toBe("1 day ago");
    expect(status(admin("2026-11-23"))).toBe("Due in 60 days");
    expect(status(admin("2026-11-24"))).toBe("Due in 2 months");
  });

  it("words an item flagged late but dated today or later as Overdue, never 0 or -1 days late", () => {
    const late = (start: string): CalItem => ({ id: "a", cat: "admin", start, end: start, title: "a", overdue: true });
    expect(detail(late(TODAY), [], FRAME)?.status).toEqual({ text: "Overdue", tone: "late" });
    expect(detail(late("2026-09-25"), [], FRAME)?.status).toEqual({ text: "Overdue", tone: "late" });
    expect(detail(late("2026-09-23"), [], FRAME)?.status).toEqual({ text: "1 day late", tone: "late" });
  });

  it("gives school holidays with no day back only where they come from", () => {
    const noBack: CalItem = { ...byId("sch:spring26"), back: null };
    expect(detail(noBack, ITEMS, FRAME)?.facts).toEqual([["From", "NSW school terms"]]);
  });

  it("gives nothing for an item whose start is not a day", () => {
    expect(detail({ id: "x", cat: "event", start: "soon", end: "soon", title: "x" }, [], FRAME)).toBeNull();
  });
});

describe("the day formats, ISO in", () => {
  it("writes the handoff's formats from ISO days", () => {
    expect(fmtDay("2026-10-05")).toBe("Mon 5 Oct");
    expect(fmtDates("2026-09-28", "2026-10-02")).toBe("28 Sept – 2 Oct");
    expect(fmtDates("2026-10-05", "2026-10-11")).toBe("5 – 11 Oct");
    expect(fmtDayRange("2026-09-28", "2026-10-09")).toBe("Mon 28 Sept – Fri 9 Oct");
  });
});

describe("the fixture", () => {
  it("holds his real dates", () => {
    expect(HOLIDAYS.find((h) => h.title === "Labour Day")?.start).toBe("2026-10-05");
    expect(SCHOOL[0]).toMatchObject({ start: "2026-09-28", end: "2026-10-09" });
    expect(ADMIN.find((a) => a.overdue)?.start).toBe("2026-09-17");
    expect(EVENTS.find((e) => e.shutdown)?.end).toBe("2027-01-08");
  });
});
