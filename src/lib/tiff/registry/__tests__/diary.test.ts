/**
 * @jest-environment node
 */
/* schedule_days: the diary as the Schedule reads it, for Tiff (./diary). The
   readers are faked; what is held is the asking (the org from the viewer,
   days capped, a person narrowed) and the shape the model is handed. */

import type { SchedulePayload } from "@/lib/workboard/schedule-query";

const loadScheduleDay = jest.fn();
const readActiveStaff = jest.fn();
const crewNotBooked = jest.fn();
const readRegularDaysOff = jest.fn();
const sm8StaffByProfile = jest.fn();

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
jest.mock("server-only", () => ({}));
jest.mock("@/lib/workboard/schedule-query", () => ({
  loadScheduleDay: (...a: unknown[]) => loadScheduleDay(...a),
  readActiveStaff: (...a: unknown[]) => readActiveStaff(...a),
}));
jest.mock("@/lib/mobile/schedule-crew", () => ({ crewNotBooked: (...a: unknown[]) => crewNotBooked(...a) }));
jest.mock("@/lib/team/regular-days-off-query", () => ({
  readRegularDaysOff: (...a: unknown[]) => readRegularDaysOff(...a),
  sm8StaffByProfile: (...a: unknown[]) => sm8StaffByProfile(...a),
}));

import { TIFF_TOOLS, runTool, toolsFor, type Viewer } from "..";
import { diaryDays, isDiaryDay, MAX_DIARY_DAYS, nameAnswers, readDiary, shapeDiaryDay } from "../diary";

const viewer = (caps: string[], role: Viewer["role"] = "staff"): Viewer => ({
  orgId: "org-1",
  userId: "auth0|u1",
  staffId: null,
  role,
  caps: new Set(caps) as Viewer["caps"],
  tz: "Australia/Sydney",
  today: "2026-11-21",
});

const job = (remoteId: string, jobNumber: string, clientName: string, suburb: string) => ({
  remoteId,
  jobNumber,
  status: "Work Order",
  clientName,
  description: "Install 7kW split in the main bedroom",
  suburb,
  categoryName: null,
  categoryColour: null,
  date: null,
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: null,
  paidCents: 0,
});

/** Monday 23 November 2026: Luke and Sam on 3432 together, Sam on 3440
    after, Kim off on annual leave all week, Jo at TAFE by rule. */
function monday(): SchedulePayload {
  return {
    dayISO: "2026-11-23",
    activities: [
      { uuid: "a1", jobUuid: "J-3432", staffUuid: "S-LUKE", start: "2026-11-23 07:30:00", end: "2026-11-23 12:00:00", wasScheduled: 1 },
      { uuid: "a2", jobUuid: "J-3432", staffUuid: "S-SAM", start: "2026-11-23 07:30:00", end: "2026-11-23 12:00:00", wasScheduled: 1 },
      { uuid: "a3", jobUuid: "J-3440", staffUuid: "S-SAM", start: "2026-11-23 13:00:00", end: "2026-11-23 15:30:00", wasScheduled: 1 },
      /* time recorded on site is no booking */
      { uuid: "a4", jobUuid: "J-3440", staffUuid: "S-SAM", start: "2026-11-23 13:05:00", end: "2026-11-23 15:00:00", wasScheduled: 0 },
    ],
    staff: [
      { uuid: "S-LUKE", name: "Luke Smith" },
      { uuid: "S-SAM", name: "Sam Ng" },
      { uuid: "S-KIM", name: "Kim Lee" },
    ],
    jobs: [job("J-3432", "3432", "Holbrook Homes", "Kellyville"), job("J-3440", "3440", "R. Patel", "Castle Hill")],
    onSite: [],
    addresses: { "J-3432": "2 Spring St" },
    away: [{ uuid: "v1", staffUuid: "s-kim", name: "Annual Leave", start: "2026-11-20 00:00:00", end: "2026-11-28 00:00:00" }],
    closed: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  loadScheduleDay.mockImplementation(async (_org: string, day: string) => (day === "2026-11-23" ? monday() : { ...monday(), dayISO: day, activities: [], away: [], jobs: [] }));
  readActiveStaff.mockResolvedValue([
    { uuid: "S-LUKE", name: "Luke Smith" },
    { uuid: "S-SAM", name: "Sam Ng" },
    { uuid: "S-KIM", name: "Kim Lee" },
    { uuid: "S-JO", name: "Jo Brown" },
  ]);
  crewNotBooked.mockResolvedValue({ free: [], off: [], later: [{ uuid: "S-LUKE", name: "Luke Smith", title: null, after: "2026-11-23 12:00:00" }] });
  readRegularDaysOff.mockResolvedValue([
    { id: "r1", staffProfileId: "p-jo", reason: "TAFE", weekdays: [1], everyWeeks: 1, fromDate: "2026-01-05", toDate: null, partFrom: null, partTo: null, skipDates: [] },
  ]);
  sm8StaffByProfile.mockResolvedValue(new Map([["p-jo", "S-JO"]]));
});

describe("the tool", () => {
  it("is a read, gated on the board", () => {
    const tool = TIFF_TOOLS.find((t) => t.name === "schedule_days")!;
    expect(tool.risk).toBe("read");
    expect(tool.gate).toEqual({ capability: "workboard" });
    expect(toolsFor(viewer(["tiff"])).map((t) => t.name)).not.toContain("schedule_days");
    expect(toolsFor(viewer(["workboard"])).map((t) => t.name)).toContain("schedule_days");
  });

  it("tells the model the dates are the business's own and what it's for", () => {
    const d = TIFF_TOOLS.find((t) => t.name === "schedule_days")!.description;
    expect(d).toMatch(/business's own dates/);
    expect(d).toMatch(/what's booked/);
    expect(d).toMatch(/who's free/);
  });

  it("reads the viewer's org, never one the model names, with time off", async () => {
    const v = viewer(["workboard"]);
    const run = await runTool(v, "schedule_days", { from: "2026-11-23", org: "org-2" } as Record<string, unknown>, toolsFor(v));
    expect(run.ok).toBe(true);
    expect(loadScheduleDay).toHaveBeenCalledWith("org-1", "2026-11-23", { away: true });
    expect(readActiveStaff).toHaveBeenCalledWith("org-1");
    expect(crewNotBooked.mock.calls[0][0]).toBe("org-1");
  });

  it("gives someone who doesn't manage the board everyone's bookings, as the Schedule does", async () => {
    const v = viewer(["workboard"], "staff");
    const run = await runTool(v, "schedule_days", { from: "2026-11-23" }, toolsFor(v));
    if (!run.ok || run.outcome.kind !== "result") throw new Error("no result");
    const read = run.outcome.value as Awaited<ReturnType<typeof readDiary>>;
    if (!read.found) throw new Error("not found");
    expect(read.days[0].bookings.map((b) => b.job)).toEqual(["3432", "3440"]);
    /* and nothing of people's actual hours */
    expect(JSON.stringify(read)).not.toMatch(/actual/);
  });
});

describe("readDiary", () => {
  it("shapes a day: a booking per job and time with everyone on it, who's off, who has room", async () => {
    const read = await readDiary("org-1", "Australia/Sydney", { from: "2026-11-23", to: "2026-11-23", person: null });
    expect(read).toEqual({
      found: true,
      zone: "Australia/Sydney",
      days: [
        {
          date: "2026-11-23",
          weekday: "Monday",
          bookings: [
            {
              id: "J-3432",
              job: "3432",
              client: "Holbrook Homes",
              suburb: "Kellyville",
              street: "2 Spring St",
              what: "Install 7kW split in the main bedroom",
              status: "Work Order",
              start: "07:30",
              end: "12:00",
              who: ["Luke Smith", "Sam Ng"],
            },
            {
              id: "J-3440",
              job: "3440",
              client: "R. Patel",
              suburb: "Castle Hill",
              street: null,
              what: "Install 7kW split in the main bedroom",
              status: "Work Order",
              start: "13:00",
              end: "15:30",
              who: ["Sam Ng"],
            },
          ],
          away: [
            { who: "Jo Brown", what: "TAFE", all_day: true },
            { who: "Kim Lee", what: "Annual Leave", all_day: true, until: "2026-11-27" },
          ],
          free_after: [{ who: "Luke Smith", after: "12:00" }],
        },
      ],
    });
  });

  it("narrows to one person by a name as said, and keeps who else is on their jobs", async () => {
    const read = await readDiary("org-1", null, { from: "2026-11-23", to: "2026-11-23", person: "luke" });
    if (!read.found) throw new Error("not found");
    expect(read.person).toEqual({ asked: "luke", matched: ["Luke Smith"] });
    expect(read.days[0].bookings.map((b) => [b.job, b.who])).toEqual([["3432", ["Luke Smith", "Sam Ng"]]]);
    expect(read.days[0].away).toEqual([]);
    expect(read.days[0].free_after).toEqual([{ who: "Luke Smith", after: "12:00" }]);

    const kim = await readDiary("org-1", null, { from: "2026-11-23", to: "2026-11-23", person: "Kim" });
    if (!kim.found) throw new Error("not found");
    expect(kim.days[0].bookings).toEqual([]);
    expect(kim.days[0].away.map((a) => a.who)).toEqual(["Kim Lee"]);
  });

  it("says who it could mean when no one answers to the name", async () => {
    expect(await readDiary("org-1", null, { from: "2026-11-23", to: "2026-11-23", person: "Bruce" })).toEqual({
      found: false,
      said: 'No one on the diary answers to "Bruce".',
      people: ["Jo Brown", "Kim Lee", "Luke Smith", "Sam Ng"],
    });
    expect(loadScheduleDay).toHaveBeenCalled();
  });

  it("reads a run of days, at most a week, and says where it stopped", async () => {
    const read = await readDiary("org-1", null, { from: "2026-11-23", to: "2026-12-10", person: null });
    if (!read.found) throw new Error("not found");
    expect(read.days.map((d) => d.date)).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(read.days[1].weekday).toBe("Tuesday");
    expect(read.note).toMatch(/from 2026-11-30/);
    expect(loadScheduleDay).toHaveBeenCalledTimes(MAX_DIARY_DAYS);
  });

  it("refuses dates that aren't days, and a run that ends before it starts, reading nothing", async () => {
    expect(await readDiary("org-1", null, { from: "Monday", to: "Monday", person: null })).toEqual({ found: false, said: "Give the days as YYYY-MM-DD." });
    expect(await readDiary("org-1", null, { from: "2026-02-30", to: "2026-02-30", person: null })).toMatchObject({ found: false });
    expect(await readDiary("org-1", null, { from: "2026-11-24", to: "2026-11-23", person: null })).toEqual({ found: false, said: "The last day is before the first." });
    expect(loadScheduleDay).not.toHaveBeenCalled();
  });

  it("leaves `to` out for one day, and reads today with no day at all", async () => {
    const v = viewer(["workboard"]);
    await runTool(v, "schedule_days", { from: "2026-11-23" }, toolsFor(v));
    expect(loadScheduleDay).toHaveBeenCalledTimes(1);
    loadScheduleDay.mockClear();
    await runTool(v, "schedule_days", { from: "" }, toolsFor(v));
    expect(loadScheduleDay).toHaveBeenCalledWith("org-1", "2026-11-21", { away: true });
  });

  it("still answers when the free list can't be read", async () => {
    crewNotBooked.mockRejectedValue(new Error("down"));
    const read = await readDiary("org-1", null, { from: "2026-11-23", to: "2026-11-23", person: null });
    if (!read.found) throw new Error("not found");
    expect(read.days[0].bookings).toHaveLength(2);
    expect(read.days[0]).not.toHaveProperty("free_after");
  });
});

describe("the pure parts", () => {
  it("knows a day", () => {
    expect(isDiaryDay("2026-11-23")).toBe(true);
    expect(isDiaryDay("2026-02-29")).toBe(false);
    expect(isDiaryDay("23/11/2026")).toBe(false);
    expect(isDiaryDay(20261123)).toBe(false);
  });

  it("counts days inclusive, capped", () => {
    expect(diaryDays("2026-11-23", "2026-11-23")).toEqual({ days: ["2026-11-23"], capped: false });
    expect(diaryDays("2026-11-23", "2026-11-29")).toMatchObject({ capped: false });
    expect(diaryDays("2026-11-23", "2026-11-30")).toMatchObject({ capped: true });
  });

  it("matches a name by the starts of its words", () => {
    expect(nameAnswers("Luke Smith", "luke")).toBe(true);
    expect(nameAnswers("Luke Smith", "Smith")).toBe(true);
    expect(nameAnswers("Luke Smith", "luke s")).toBe(true);
    expect(nameAnswers("Luke Smith", "uke")).toBe(false);
    expect(nameAnswers("Luke Smith", "  ")).toBe(false);
  });

  it("gives part-day time off its times, a booking past midnight its end day, and a closed day", () => {
    const day = shapeDiaryDay(
      {
        ...monday(),
        activities: [{ uuid: "a1", jobUuid: "J-3432", staffUuid: "S-LUKE", start: "2026-11-23 20:00:00", end: "2026-11-24 02:00:00", wasScheduled: 1 }],
        away: [{ uuid: "v2", staffUuid: "S-SAM", name: null, start: "2026-11-23 12:00:00", end: "2026-11-23 16:00:00", blockId: "b1", where: "Dentist" }],
        closed: [{ uuid: "c1", kind: "holiday", name: "Show Day", start: "2026-11-23 00:00:00", end: "2026-11-24 00:00:00" }],
      },
      new Map([
        ["s-luke", "Luke Smith"],
        ["s-sam", "Sam Ng"],
      ]),
      null
    );
    expect(day.bookings[0]).toMatchObject({ start: "20:00", end: "2026-11-24 02:00", who: ["Luke Smith"] });
    expect(day.away).toEqual([{ who: "Sam Ng", what: null, all_day: false, from: "12:00", to: "16:00", where: "Dentist" }]);
    expect(day.closed).toEqual([{ kind: "holiday", name: "Show Day", all_day: true }]);
  });
});
