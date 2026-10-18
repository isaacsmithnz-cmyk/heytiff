import { awayOnDay, fallsOn, invalidRule, isoWeekday, ruleWords, withRegular, type RegularDayOff } from "../regular-days-off";

const rule = (over: Partial<RegularDayOff> = {}): RegularDayOff => ({
  id: "r1",
  staffProfileId: "p1",
  reason: "TAFE",
  weekdays: [2],
  everyWeeks: 1,
  fromDate: "2026-10-05",
  toDate: "2026-11-27",
  partFrom: null,
  partTo: null,
  skipDates: [],
  ...over,
});

describe("regular days off", () => {
  it("reads weekdays the ISO way, Monday 1", () => {
    expect(isoWeekday("2026-10-19")).toBe(1);
    expect(isoWeekday("2026-10-25")).toBe(7);
  });
  it("falls on its weekday between its dates, and not on a skipped day", () => {
    expect(fallsOn(rule(), "2026-10-20")).toBe(true);
    expect(fallsOn(rule(), "2026-10-21")).toBe(false);
    expect(fallsOn(rule(), "2026-12-01")).toBe(false);
    expect(fallsOn(rule({ skipDates: ["2026-10-20"] }), "2026-10-20")).toBe(false);
  });
  it("every second week counts from its first week", () => {
    const rdo = rule({ reason: "RDO", weekdays: [5], everyWeeks: 2, fromDate: "2026-10-09", toDate: null });
    expect(fallsOn(rdo, "2026-10-09")).toBe(true);
    expect(fallsOn(rdo, "2026-10-16")).toBe(false);
    expect(fallsOn(rdo, "2026-10-23")).toBe(true);
  });
  it("lands on the diary as the person's time off, by their ServiceM8 uuid", () => {
    const links = new Map([["p1", "SM8-A"]]);
    expect(awayOnDay([rule()], "2026-10-20", links)).toEqual([
      { uuid: "regular:r1:2026-10-20", staffUuid: "SM8-A", name: "TAFE", start: "2026-10-20 00:00:00", end: "2026-10-20 23:59:59" },
    ]);
    expect(awayOnDay([rule({ partFrom: "12:00", partTo: "15:30" })], "2026-10-20", links)[0]).toMatchObject({ start: "2026-10-20 12:00:00", end: "2026-10-20 15:30:00" });
    expect(awayOnDay([rule()], "2026-10-20", new Map())).toEqual([]);
  });
  it("says nothing where ServiceM8 already has the same word that day", () => {
    const typed = [{ uuid: "x", staffUuid: "sm8-a", name: "tafe", start: "2026-10-20 00:00:00", end: "2026-10-20 23:59:59" }];
    const ours = awayOnDay([rule()], "2026-10-20", new Map([["p1", "SM8-A"]]));
    expect(withRegular(typed, ours)).toEqual(typed);
  });
  it("says itself in words", () => {
    expect(ruleWords(rule())).toBe("Every Tuesday");
    expect(ruleWords(rule({ weekdays: [1, 4], everyWeeks: 2, partFrom: "12:00", partTo: "15:30" }))).toBe("Every second Monday and Thursday, 12 to 3:30");
  });
  it("refuses a rule that can't be kept", () => {
    const base = { reason: "TAFE", weekdays: [2], everyWeeks: 1 as const, fromDate: "2026-10-05", toDate: null, partFrom: null, partTo: null, skipDates: [] };
    expect(invalidRule(base)).toBeNull();
    expect(invalidRule({ ...base, weekdays: [] })).toMatch(/day it falls on/);
    expect(invalidRule({ ...base, toDate: "2026-01-01" })).toMatch(/end after it starts/);
    expect(invalidRule({ ...base, partFrom: "15:00", partTo: "12:00" })).toMatch(/part day/);
  });
});
