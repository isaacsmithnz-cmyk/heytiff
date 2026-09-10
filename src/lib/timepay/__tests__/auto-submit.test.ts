import { DEFAULT_SETTINGS, type Settings } from "@/components/timepay/logic";
import { addDays, periodConfig, periodDays, periodStartFor } from "../period";
import { hasPassed, hasSomethingToSend, submitDayIndex, submitMomentOf } from "../auto-submit";

/* WHEN A SHEET SENDS ITSELF. The rail has always said "if you don't, it sends
   itself Sun 3:00 PM and locks", and nothing ever did — a walk of the live
   screen found last week closed and still a draft. The moment is pure, so it
   is pinned here; the loaders and actions that act on it have their own
   tests. */

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday

describe("the moment a sheet sends itself", () => {
  it("is the week's Sunday at 3:00 PM on the workspace defaults", () => {
    const cfg = periodConfig(settings());
    const start = periodStartFor("2026-09-10", cfg);
    const moment = submitMomentOf(start, cfg, settings())!;
    expect(weekday(moment.date)).toBe(0);
    expect(moment.date >= start && moment.date <= addDays(start, 6)).toBe(true);
    expect(moment.minutes).toBe(15 * 60);
  });

  it("is the SECOND Sunday of a fortnight — the one the rail names", () => {
    const s = settings({ cycle: "Fortnightly" });
    const cfg = periodConfig(s);
    const start = periodStartFor("2026-09-10", cfg);
    const moment = submitMomentOf(start, cfg, s)!;
    expect(weekday(moment.date)).toBe(0);
    expect(moment.date > addDays(start, 6)).toBe(true);
    // the rail finds its day by index; the server by date — the same day
    expect(addDays(start, submitDayIndex(periodDays(start, cfg), s.submitDay))).toBe(moment.date);
  });

  it("follows the workspace's own day and time", () => {
    const s = settings({ submitDay: "Fri", submitTime: "5:30 PM" });
    const cfg = periodConfig(s);
    const moment = submitMomentOf(periodStartFor("2026-09-10", cfg), cfg, s)!;
    expect(weekday(moment.date)).toBe(5);
    expect(moment.minutes).toBe(17 * 60 + 30);
  });

  it("never comes for a time nobody can read", () => {
    const s = settings({ submitTime: "whenever" });
    const cfg = periodConfig(s);
    expect(submitMomentOf(periodStartFor("2026-09-10", cfg), cfg, s)).toBeNull();
  });

  it("has come at the minute itself — not a minute before", () => {
    const m = { date: "2026-09-06", minutes: 15 * 60 };
    expect(hasPassed(m, "2026-09-06", 15 * 60 - 1)).toBe(false);
    expect(hasPassed(m, "2026-09-06", 15 * 60)).toBe(true);
    expect(hasPassed(m, "2026-09-05", 23 * 60 + 59)).toBe(false);
    expect(hasPassed(m, "2026-09-07", 0)).toBe(true);
    expect(hasPassed(null, "2099-01-01", 0)).toBe(false);
  });

  it("reads the submit day by its first three letters, however it is written", () => {
    const week = [["MON"], ["TUE"], ["WED"], ["THU"], ["FRI"], ["SAT"], ["SUN"]];
    expect(submitDayIndex(week, "Sun")).toBe(6);
    expect(submitDayIndex(week, "sunday")).toBe(6);
    expect(submitDayIndex(week, "Someday")).toBe(-1);
  });

  it("has nothing to send in a week with nothing on it", () => {
    expect(hasSomethingToSend([{ t: "empty" }, { t: "empty" }])).toBe(false);
    // a day marked off is an answer, and an answer is something to send
    expect(hasSomethingToSend([{ t: "empty" }, { t: "off" }])).toBe(true);
  });
});
