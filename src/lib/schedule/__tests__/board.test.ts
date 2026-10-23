import {
  boardOf,
  clockWord,
  dayLine,
  stackDay,
  daysFit,
  daysFor,
  fillWord,
  hoursWord,
  fitOf,
  fitWord,
  lengthWord,
  listDays,
  stepDay,
  weekLine,
  weekOf,
  workingDaysFrom,
  type DayBlock,
  type PersonRow,
} from "../board";
import { readScheduleParams } from "../schedule-page-query";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";

jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn() } }));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(), getDbRole: jest.fn() }));
jest.mock("@/lib/workboard/jobs-list-query", () => ({ loadJobsList: jest.fn() }));
jest.mock("@/lib/workboard/schedule-query", () => ({ loadScheduleDay: jest.fn() }));
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: jest.fn() }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: jest.fn() }));
jest.mock("@/lib/workboard/capacity-query", () => ({ loadCapacityWindow: jest.fn() }));
jest.mock("@/lib/team/regular-days-off-query", () => ({ readRegularDaysOff: jest.fn(), sm8StaffByProfile: jest.fn() }));
jest.mock("@/lib/calendar/query", () => ({ calendarEventsInSpan: jest.fn(), noticeEventsInSpan: jest.fn() }));

const blk = (startMin: number, endMin: number, over: Partial<DayBlock> = {}): DayBlock => ({
  key: `${startMin}`,
  jobUuid: "j",
  number: "3355",
  client: "Tran",
  suburb: null,
  hue: "pink",
  startMin,
  endMin,
  with: [],
  kind: null,
  state: null,
  ...over,
});

describe("the days", () => {
  it("a week is its Monday to Friday, a weekend reading as the week just gone", () => {
    expect(weekOf("2026-10-21")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(weekOf("2026-10-25")[0]).toBe("2026-10-19");
  });
  it("Earlier and Later step a weekday, or a week", () => {
    expect(stepDay("day", "2026-10-23", 1)).toBe("2026-10-26");
    expect(stepDay("day", "2026-10-26", -1)).toBe("2026-10-23");
    expect(stepDay("week", "2026-10-21", 1)).toBe("2026-10-26");
  });
  it("a job of days skips the weekend", () => {
    expect(workingDaysFrom("2026-10-23", 3)).toEqual(["2026-10-23", "2026-10-26", "2026-10-27"]);
  });
  it("a weekend asked for the day view shows the Monday after; a bad day is today", () => {
    expect(readScheduleParams({ day: "2026-10-24" }, "2026-10-21")).toEqual({ view: "day", day: "2026-10-26" });
    expect(readScheduleParams({ view: "week", day: "nope" }, "2026-10-21")).toEqual({ view: "week", day: "2026-10-21" });
  });
});

describe("4 weeks", () => {
  it("is twenty weekdays from the Monday, and steps four weeks", () => {
    const days = daysFor("weeks", "2026-10-21");
    expect(days).toHaveLength(20);
    expect(days[0]).toBe("2026-10-19");
    expect(days[19]).toBe("2026-11-13");
    expect(stepDay("weeks", "2026-10-21", 1)).toBe("2026-11-16");
  });
  it("says Room under 85%, Full to 100%, Over past it, and nothing without crew hours", () => {
    expect(fillWord(84, false)).toBe("Room");
    expect(fillWord(85, false)).toBe("Full");
    expect(fillWord(100, false)).toBe("Full");
    expect(fillWord(101, true)).toBe("Over");
    expect(fillWord(null, false)).toBeNull();
    expect(hoursWord(450)).toBe("7.5 h");
  });
});

describe("Month", () => {
  it("is the month's weekdays, and steps a month", () => {
    const days = daysFor("month", "2026-11-18");
    expect(days[0]).toBe("2026-11-02");
    expect(days[days.length - 1]).toBe("2026-11-30");
    expect(days).toHaveLength(21);
    expect(stepDay("month", "2026-11-18", 1)).toBe("2026-12-01");
    expect(stepDay("month", "2026-01-10", -1)).toBe("2025-12-01");
  });
});

describe("the words", () => {
  it("says times the board's way", () => {
    expect(clockWord(540)).toBe("9");
    expect(clockWord(570)).toBe("9:30");
    expect(clockWord(780, true)).toBe("1 pm");
    expect(lengthWord(90)).toBe("1 h 30");
    expect(lengthWord(30)).toBe("30 min");
    expect(listDays(["2026-10-27", "2026-10-28", "2026-10-29"])).toBe("Tuesday, Wednesday and Thursday");
  });
});

describe("is someone free for a held job's hours", () => {
  const day = { blocks: [blk(480, 600)], away: [] };
  it("free where nothing is booked", () => {
    expect(fitOf(day, 600, 780)).toEqual({ kind: "free" });
  });
  it("part free says from when", () => {
    const f = fitOf(day, 540, 720);
    expect(f).toEqual({ kind: "part", from: 600, to: 720 });
    expect(fitWord(f, 540, 720)).toBe("Free from 10");
  });
  it("booked over the whole of it says what on", () => {
    expect(fitOf(day, 480, 600)).toEqual({ kind: "busy", what: "job 3355" });
  });
  it("time off wins, in the business's own word", () => {
    expect(fitOf({ blocks: [], away: [{ key: "a", word: "TAFE", startMin: 0, endMin: 1440, whole: true }] }, 540, 600)).toEqual({ kind: "away", word: "TAFE" });
  });
});

describe("a person's line", () => {
  it("counts the free hours of the working day", () => {
    expect(dayLine({ blocks: [], away: [] })).toBe("Free all day");
    expect(dayLine({ blocks: [blk(480, 600)], away: [] })).toBe("Free 6.5 h");
    expect(dayLine({ blocks: [blk(420, 930)], away: [] })).toBe("");
    /* under an hour free says nothing (Isaac, 22 October) */
    expect(dayLine({ blocks: [blk(420, 900)], away: [] })).toBe("");
    expect(dayLine({ blocks: [blk(420, 870)], away: [] })).toBe("Free 1 h");
    expect(dayLine({ blocks: [], away: [{ key: "a", word: "Leave", startMin: 0, endMin: 1440, whole: true }] })).toBe("Leave");
  });
});

describe("a job of several days against a person", () => {
  const row: PersonRow = {
    staffUuid: "s",
    name: "Sam Ortiz",
    days: [
      { day: "2026-10-27", blocks: [], away: [{ key: "t", word: "TAFE", startMin: 0, endMin: 1440, whole: true }] },
      { day: "2026-10-28", blocks: [], away: [] },
      { day: "2026-10-29", blocks: [], away: [] },
    ],
  };
  it("says which days they're free, and why not on the others", () => {
    expect(daysFit(row, ["2026-10-27", "2026-10-28", "2026-10-29"])).toEqual({
      free: ["2026-10-28", "2026-10-29"],
      not: [{ day: "2026-10-27", why: "TAFE" }],
    });
  });
  it("a day off the board is booked as free", () => {
    expect(daysFit(row, ["2026-11-02"]).free).toEqual(["2026-11-02"]);
  });
  it("the week's line counts the free days", () => {
    expect(weekLine(row)).toBe("2 days free");
  });
});

describe("the board from the day reads", () => {
  const payload = (dayISO: string, acts: SchedulePayload["activities"]): SchedulePayload => ({
    dayISO,
    activities: acts,
    staff: [
      { uuid: "B", name: "Callum Ahn" },
      { uuid: "A", name: "Sam Ortiz" },
    ],
    jobs: [
      {
        remoteId: "J1",
        jobNumber: "3323",
        clientName: "Northgate Realty",
        suburb: "Ryde",
        status: "Work Order",
        categoryName: null,
        categoryColour: null,
      } as unknown as SchedulePayload["jobs"][number],
    ],
    onSite: [],
    addresses: {},
  });
  const act = (uuid: string, staff: string, day: string) => ({
    uuid,
    jobUuid: "J1",
    staffUuid: staff,
    start: `${day} 07:00:00`,
    end: `${day} 15:00:00`,
    wasScheduled: 1,
  });
  it("is a row per person, A to Z, with each day's bookings and who else is on them", () => {
    const b = boardOf([payload("2026-10-21", [act("x", "B", "2026-10-21"), act("y", "A", "2026-10-21")])]);
    expect(b.people.map((p) => p.name)).toEqual(["Callum Ahn", "Sam Ortiz"]);
    expect(b.people[0].days[0].blocks[0]).toMatchObject({ number: "3323", startMin: 420, endMin: 900, with: ["Sam Ortiz"] });
  });
});

/* TWO AT ONCE (Isaac, 23 October): overlapping bookings stack in the lane */
describe("stacking a person's day", () => {
  it("keeps bookings that don't overlap on one line", () => {
    const st = stackDay([blk(450, 690, { key: "a" }), blk(705, 900, { key: "b" })]);
    expect(st.lines).toBe(1);
    expect(st.clash.size).toBe(0);
    expect([st.line.get("a"), st.line.get("b")]).toEqual([0, 0]);
  });

  it("puts a booking that overlaps another on a line of its own, and marks both", () => {
    /* Callum on 22 October: 3225 6 to 9, 3118 7 to 3, 3118 again 9:45 to 1:45 */
    const st = stackDay([blk(360, 540, { key: "pagewood" }), blk(420, 900, { key: "long" }), blk(585, 825, { key: "short" })]);
    expect(st.lines).toBe(2);
    expect(st.line.get("pagewood")).toBe(0);
    expect(st.line.get("long")).toBe(1);
    expect(st.line.get("short")).toBe(0);
    expect([...st.clash].sort()).toEqual(["long", "pagewood", "short"]);
  });

  it("says one line for an empty day", () => {
    expect(stackDay([]).lines).toBe(1);
  });
});
