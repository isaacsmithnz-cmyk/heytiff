import { buildActivityDays, dayLabel, fmtLeave, fmtMinutes, hoursStats, mondayOf, type ActivityRows } from "../person-activity";

/* A person's activity: their rows as days, newest first, and their week. */

const TODAY = "2026-11-26"; // a Thursday
const empty = (): ActivityRows => ({ clock: [], sites: [], notes: [], photos: [], ticks: [], leave: [], papers: [], numbers: new Map() });

describe("the words", () => {
  it("says a length the way the job feed does", () => {
    expect(fmtMinutes(516)).toBe("8 h 36");
    expect(fmtMinutes(180)).toBe("3 h");
    expect(fmtMinutes(45)).toBe("45 min");
    expect(fmtMinutes(-5)).toBe("0 min");
  });

  it("names today and yesterday, and the days before by their date", () => {
    expect(dayLabel(TODAY, TODAY)).toBe("Today");
    expect(dayLabel("2026-11-25", TODAY)).toBe("Yesterday, Wednesday 25 November");
    expect(dayLabel("2026-11-24", TODAY)).toBe("Tuesday 24 November");
  });

  it("counts leave in days of their normal day, halves kept, hours without one", () => {
    expect(fmtLeave(76, 7.6)).toBe("10 days");
    expect(fmtLeave(72.2, 7.6)).toBe("9½ days");
    expect(fmtLeave(7.6, 7.6)).toBe("1 day");
    expect(fmtLeave(12.5, null)).toBe("12.5 h");
  });

  it("finds the week's Monday", () => {
    expect(mondayOf(TODAY)).toBe("2026-11-23");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    expect(mondayOf("2026-11-29")).toBe("2026-11-23");
  });
});

describe("the days", () => {
  it("files every row under its day on the AU clock, newest first within it", () => {
    const rows = empty();
    // 6:42 am and 3:18 pm in Sydney on the 25th (AEDT, UTC+11)
    rows.clock.push({ work_date: "2026-11-25", on_at: "2026-11-24T19:42:00Z", off_at: "2026-11-25T04:18:00Z" });
    rows.sites.push({ id: "c1", sm8_job_uuid: "job-a", checked_in_at: "2026-11-24T20:20:00Z", checked_out_at: "2026-11-25T02:10:00Z" });
    rows.numbers.set("job-a", "3423");
    const days = buildActivityDays(rows, { today: TODAY, since: "2026-11-13", perDayMinutes: 480 });
    expect(days.map((d) => d.label)).toEqual(["Yesterday, Wednesday 25 November"]);
    expect(days[0]!.entries.map((e) => e.name)).toEqual(["Clocked off 3:18 pm", "On site, 5 h 50", "Clocked on 6:42 am"]);
    const off = days[0]!.entries[0]!;
    expect(off.line).toBe("8 h 36 on the day");
    expect(off.over).toBe("36 min over");
    expect(days[0]!.entries[1]!.job).toEqual({ uuid: "job-a", number: "3423" });
  });

  it("gathers a day's photos on a job into one row, and leaves out what's older than the feed", () => {
    const rows = empty();
    rows.photos.push(
      { sm8_job_uuid: "job-a", created_at: "2026-11-25T01:00:00Z" },
      { sm8_job_uuid: "job-a", created_at: "2026-11-25T01:05:00Z" },
      { sm8_job_uuid: "job-a", created_at: "2026-11-01T01:05:00Z" },
    );
    const days = buildActivityDays(rows, { today: TODAY, since: "2026-11-13", perDayMinutes: null });
    expect(days).toHaveLength(1);
    expect(days[0]!.entries.map((e) => e.name)).toEqual(["Added 2 photos"]);
  });

  it("says a note's words under it, leave as booked or asked for, and a licence added or renewed", () => {
    const rows = empty();
    rows.notes.push({ id: "n1", transcript: "Bracket's rusted through.", target_kind: "job", target_id: "job-a", created_at: "2026-11-25T03:00:00Z" });
    rows.leave.push(
      { id: "l1", kind: "annual", start_date: "2026-12-22", end_date: "2026-12-23", hours: 15.2, status: "approved", created_at: "2026-11-24T03:00:00Z" },
      { id: "l2", kind: "personal", start_date: "2026-12-01", end_date: "2026-12-01", hours: 7.6, status: "pending", created_at: "2026-11-24T02:00:00Z" },
      { id: "l3", kind: "annual", start_date: "2026-12-05", end_date: "2026-12-05", hours: 7.6, status: "cancelled", created_at: "2026-11-24T01:00:00Z" },
    );
    rows.papers.push({ id: "p1", licence: "White card", expires_on: null, created_at: "2026-11-24T00:30:00Z", first: false });
    const [yesterday, before] = buildActivityDays(rows, { today: TODAY, since: "2026-11-13", perDayMinutes: null });
    expect(yesterday!.entries[0]).toMatchObject({ name: "Note", line: "on the job", words: "Bracket's rusted through." });
    expect(before!.entries.map((e) => [e.name, e.line])).toEqual([
      ["Booked annual leave", "Tuesday 22 to Wednesday 23 December"],
      ["Asked for personal leave", "Tuesday 1 December"],
      ["Renewed White card", null],
    ]);
  });
});

describe("the week", () => {
  const now = new Date("2026-11-26T03:00:00Z"); // 2 pm on the Thursday
  it("adds this week's days, counts the time over a normal day day by day, and averages the days that ended", () => {
    const clock = [
      // Monday to Wednesday, 9, 8 and 8 h 36
      { work_date: "2026-11-23", on_at: "2026-11-22T20:00:00Z", off_at: "2026-11-23T05:00:00Z" },
      { work_date: "2026-11-24", on_at: "2026-11-23T20:00:00Z", off_at: "2026-11-24T04:00:00Z" },
      { work_date: "2026-11-25", on_at: "2026-11-24T19:42:00Z", off_at: "2026-11-25T04:18:00Z" },
      // today, still on since 6:42 am: 7 h 18 so far
      { work_date: "2026-11-26", on_at: "2026-11-25T19:42:00Z", off_at: null },
      // last week, 8 h
      { work_date: "2026-11-20", on_at: "2026-11-19T20:00:00Z", off_at: "2026-11-20T04:00:00Z" },
    ];
    const s = hoursStats(clock, { today: TODAY, perDayMinutes: 480, now });
    expect(s.week).toEqual({ minutes: 540 + 480 + 516 + 438, days: 4 });
    expect(s.overtimeMinutes).toBe(60 + 36);
    expect(s.averageDay).toEqual({ minutes: (540 + 480 + 516 + 480) / 4, days: 4 });
  });

  it("has no overtime without a normal day to count it from", () => {
    expect(hoursStats([], { today: TODAY, perDayMinutes: null, now }).overtimeMinutes).toBeNull();
    expect(hoursStats([], { today: TODAY, perDayMinutes: 480, now })).toEqual({ week: { minutes: 0, days: 0 }, overtimeMinutes: 0, averageDay: null });
  });
});
