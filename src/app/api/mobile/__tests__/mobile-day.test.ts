/**
 * @jest-environment node
 */

/* Your day on the phone, the three things it decides: where the day went to
   the quarter hour (summarise), whose time a job's is when ServiceM8 checked
   the person in too (mergeJobs), and whether a clocked day goes on the
   timesheet at all (sheetCall: the normal day is a floor). Drawn on Alex
   Lorenz's real Tuesday, 27 October 2026, with one stop added on the way
   past, as the mock is. */

jest.mock("server-only", () => ({}));
let employment: string | null = "Full-time";
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { employment_type: employment } }) };
      return q;
    },
  },
}));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => "card-alex" }));
jest.mock("@/lib/timepay/query", () => ({
  getPaySettings: async () => ({ settings: { workDays: [0, 1, 2, 3, 4], defaultStart: "7:00 AM", defaultEnd: "3:00 PM" } }),
  shiftDefaultsFor: async () => ({ hours: new Map(), workDays: new Map() }),
}));
jest.mock("@/lib/timepay/leave-query", () => ({
  stateFor: async () => "NSW",
  holidaysInSpan: async () => [{ date: "2026-11-03", name: "A public holiday" }],
  approvedInSpan: async () => [
    { staffId: "card-alex", startDate: "2026-11-05", endDate: "2026-11-06" },
    { staffId: "card-someone-else", startDate: "2026-10-29", endDate: "2026-10-29" },
  ],
}));
jest.mock("@/app/actions/timepay", () => ({ saveDay: async () => ({ ok: true }) }));
jest.mock("@/lib/timepay/page-data", () => ({}));
jest.mock("@/app/actions/sm8-booking-queue", () => ({}));
jest.mock("@/lib/integrations/sm8-drain", () => ({}));
jest.mock("@auth0/nextjs-auth0/server", () => ({ Auth0Client: class {} }));

import { AWAY_KEPT_MS, arrivedOf, clockOnPlan, hasLife, joinDay, mergeJobs, recentWindow, rosteredDays, sheetCall, stintTimes, summarise, toQuarter, type DayJob } from "@/lib/mobile/day";
import type { MobileCtx } from "@/lib/mobile/auth";

/* 27 October 2026 is daylight time in Sydney: +11:00 */
const at = (hm: string) => new Date(`2026-10-27T${hm}:00+11:00`).toISOString();
const job = (n: string, from: string, until: string | null, how: DayJob["how"] = "phone"): DayJob => ({
  jobUuid: `j-${n}`,
  number: n,
  where: "",
  from: at(from),
  until: until ? at(until) : null,
  how,
});

test("a time goes to the nearest quarter hour", () => {
  expect(toQuarter(at("07:27"))).toBe(at("07:30"));
  expect(toQuarter(at("10:51"))).toBe(at("10:45"));
  expect(toQuarter(at("10:52"))).toBe(at("10:45"));
  expect(toQuarter(at("10:53"))).toBe(at("11:00"));
  expect(toQuarter(at("06:56"))).toBe(at("07:00"));
});

test("Alex's day comes to 8 h: four jobs, the office and travel, to the quarter hour", () => {
  const s = summarise(
    { onAt: at("06:56"), until: at("15:02") },
    [job("3215", "07:27", "09:25"), job("3426", "10:13", "10:51"), job("3287", "11:48", "12:45"), job("3304", "12:55", "13:25")],
    [
      { from: at("06:56"), until: at("07:14") },
      { from: at("13:58"), until: null },
    ]
  );
  expect([s.from, s.until, s.minutes]).toEqual([at("07:00"), at("15:00"), 480]);
  expect(s.jobs.map((j) => [j.number, j.minutes])).toEqual([
    ["3215", 120],
    ["3426", 30],
    ["3287", 60],
    ["3304", 30],
  ]);
  expect(s.office.minutes).toBe(75);
  expect(s.travel).toBe(165);
  expect(s.jobs.reduce((n, j) => n + j.minutes, 0) + s.office.minutes + s.travel).toBe(s.minutes);
});

test("a stop that rounds to nothing is left out, and nothing runs outside the day", () => {
  const s = summarise({ onAt: at("07:00"), until: at("15:00") }, [job("3304", "12:46", "12:52"), job("3215", "06:40", "07:40")], []);
  expect(s.jobs.map((j) => [j.number, j.from, j.minutes])).toEqual([["3215", at("07:00"), 45]]);
});

test("ServiceM8's own check-in wins on the same job at the same time; the phone's stints fill the rest and are the ones to send", () => {
  const name = (u: string) => ({ jobUuid: u, number: u.slice(2), where: "" });
  const stints = [
    { id: "c-1", jobUuid: "j-3215", inAt: at("07:28"), outAt: at("09:24") },
    { id: "c-2", jobUuid: "j-3304", inAt: at("12:55"), outAt: at("13:25"), reason: "site_meeting" },
  ];
  const theirs = [{ jobUuid: "J-3215", from: at("07:27"), until: at("09:25") }];
  const { jobs, toSend } = mergeJobs(stints, theirs, name, at("15:00"));
  expect(jobs.map((j) => [j.jobUuid.toLowerCase(), j.how])).toEqual([
    ["j-3215", "servicem8"],
    ["j-3304", "phone"],
  ]);
  expect(toSend.map((s) => s.id)).toEqual(["c-2"]);
  expect(jobs[1]!.stintId).toBe("c-2");
  expect(jobs[1]!.reason).toBe("site_meeting");
});

test("the normal day is a floor: a short or normal rostered day leaves it standing, only more is written", () => {
  const day = { entered: false, rostered: true, casual: false, normalDay: 8 };
  expect(sheetCall({ ...day, hours: 7.25 })).toBe("normal");
  expect(sheetCall({ ...day, hours: 8 })).toBe("normal");
  expect(sheetCall({ ...day, hours: 8.5 })).toBe("write");
  expect(sheetCall({ ...day, rostered: false, hours: 4 })).toBe("write");
  expect(sheetCall({ ...day, casual: true, hours: 5 })).toBe("write");
  expect(sheetCall({ ...day, entered: true, hours: 10 })).toBe("kept");
});

test("a job's times are changed only to times inside the day, in order, none still to come", () => {
  const day = { onAt: at("07:00"), now: Date.parse(at("15:00")) };
  expect(stintTimes({ ...day, from: at("09:00"), until: at("10:30") })).toEqual({ from: at("09:00"), until: at("10:30") });
  expect(stintTimes({ ...day, from: at("06:30"), until: at("08:00") })).toEqual({ error: "That's before you clocked on." });
  expect(stintTimes({ ...day, from: at("10:30"), until: at("09:00") })).toEqual({ error: "It has to finish after it starts." });
  expect(stintTimes({ ...day, from: at("14:00"), until: at("17:00") })).toEqual({ error: "That time hasn't come yet." });
  expect(stintTimes({ ...day, from: "soon", until: at("10:00") })).toEqual({ error: "Pick the time." });
});

/* the review of 29 October 2026: the sheet offers quarter hours, so on at 7:05 its
   7:00 and, at 2:53, its 3:00 are the day's start and now, not refusals */
test("a time rounded to the quarter just past the day's start or now is held to it", () => {
  const day = { onAt: at("07:05"), now: Date.parse(at("14:53")) };
  expect(stintTimes({ ...day, from: at("07:00"), until: at("09:00") })).toEqual({ from: at("07:05"), until: at("09:00") });
  expect(stintTimes({ ...day, from: at("13:00"), until: at("15:00") })).toEqual({ from: at("13:00"), until: at("14:53") });
  expect(stintTimes({ ...day, from: at("06:45"), until: at("09:00") })).toEqual({ error: "That's before you clocked on." });
});

test("the morning reminder's days: the days you're rostered on, less public holidays and your approved leave; a casual, none", async () => {
  const ctx = { orgId: "org-1", userId: "auth0|alex" } as MobileCtx;
  /* Wed 28 Oct for eight days: Thu 29, Fri 30, Mon 2, and Tue 3 is a holiday here, Wed 4, Thu 5 and Fri 6 his leave */
  expect(await rosteredDays(ctx, "2026-10-28")).toEqual(["2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-04"]);
  employment = "Casual";
  expect(await rosteredDays(ctx, "2026-10-28")).toEqual([]);
  employment = "Full-time";
});

/* 993, 3 Farran Street: a quote from January 2025 nobody closed, next door
   to Isaac's own house, put him "at" it on 29 October 2026. An open job is a
   place to drop in at only with a change or a visit in the last or next 60
   days. */
test("an open job counts as somewhere you dropped in only with some life in it", () => {
  const [from, until] = recentWindow("2026-10-29");
  expect([from, until]).toEqual(["2026-08-30", "2026-12-28"]);
  const none = new Set<string>();
  expect(hasLife({ uuid: "fc8d5c66-993", edit_date: "2025-01-06 14:20:00" }, from, none)).toBe(false);
  expect(hasLife({ uuid: "f720048c-1352", edit_date: "2026-10-29 13:38:02" }, from, none)).toBe(true);
  /* untouched for months, but a visit booked: still a place */
  expect(hasLife({ uuid: "ABC-OLD", edit_date: "2026-03-01 09:00:00" }, from, new Set(["abc-old"]))).toBe(true);
  expect(hasLife({ uuid: "no-date", edit_date: null }, from, none)).toBe(false);
});

/* THE JOB-TIME RULES (Isaac, 29 October 2026, "Build them"), drawn on his
   own day: at 1352 at 7:15, up the road to park and get a coffee, back at
   7:42. Times are Sydney's, written as UTC instants. */
describe("the day's pieces, joined", () => {
  const at = (hm: string) => {
    const [h, m] = hm.split(":").map(Number);
    return new Date(Date.UTC(2026, 9, 29, h! - 11, m!)).toISOString();
  };
  const piece = (job: string, from: string, until: string | null, id: string, how: DayJob["how"] = "phone"): DayJob => ({
    jobUuid: job,
    number: job,
    where: "",
    from: at(from),
    until: until ? at(until) : null,
    how,
    ...(how === "phone" ? { stintId: id } : {}),
  });

  it("out and back to the same job is one stretch on it, from when you first got there", () => {
    const day = joinDay([piece("1352", "7:15", "7:25", "s1"), piece("1352", "7:42", null, "s2")], []);
    expect(day).toEqual([expect.objectContaining({ jobUuid: "1352", from: at("7:15"), until: null, stintId: "s1", joined: ["s2"] })]);
  });

  it("a stop at another job keeps its own time; the drives there and back stay on the first job", () => {
    const day = joinDay([piece("1352", "7:15", "12:50", "s1"), piece("3304", "13:00", "13:40", "s2"), piece("1352", "13:55", "15:00", "s3")], []);
    expect(day.map((j) => [j.jobUuid, j.from, j.until])).toEqual([
      ["1352", at("7:15"), at("13:00")],
      ["3304", at("13:00"), at("13:40")],
      ["1352", at("13:40"), at("15:00")],
    ]);
  });

  it("a stop at the office counts as somewhere else", () => {
    const day = joinDay([piece("1352", "7:15", "10:00", "s1"), piece("1352", "11:00", "15:00", "s2")], [{ from: at("10:20"), until: at("10:40") }]);
    expect(day.map((j) => [j.from, j.until])).toEqual([[at("7:15"), at("10:20")], [at("10:40"), at("15:00")]]);
  });

  it("away more than two hours stays off the job, offered to keep", () => {
    const day = joinDay([piece("1352", "7:15", "10:00", "s1"), piece("1352", "13:30", "15:00", "s2")], []);
    expect(day).toHaveLength(2);
    expect(day[1]!.away).toEqual({ from: at("10:00"), until: at("13:30"), stintId: "s1", stintFrom: at("7:15") });
    /* exactly two hours still stays on */
    expect(joinDay([piece("1352", "7:00", "10:00", "s1"), { ...piece("1352", "7:00", "15:00", "s2"), from: new Date(Date.parse(at("10:00")) + AWAY_KEPT_MS).toISOString() }], [])).toHaveLength(1);
  });

  it("leave and don't come back: the job ends when you left", () => {
    const day = joinDay([piece("1352", "7:15", "12:00", "s1"), piece("3124", "12:30", "15:00", "s2")], []);
    expect(day.map((j) => [j.jobUuid, j.from, j.until])).toEqual([["1352", at("7:15"), at("12:00")], ["3124", at("12:30"), at("15:00")]]);
  });

  it("ServiceM8's own check-ins stand as they are", () => {
    const day = joinDay([piece("1352", "7:00", "9:00", "x", "servicem8"), piece("1352", "9:30", "15:00", "s2")], []);
    expect(day.map((j) => [j.how, j.from, j.until])).toEqual([["servicem8", at("7:00"), at("9:00")], ["phone", at("9:30"), at("15:00")]]);
  });

  it("the morning watch's arrival counts only from this morning, and never from the future", () => {
    const now = Date.parse(at("7:28"));
    expect(arrivedOf({ jobUuid: "f720048c-eab5-46a5-ac1b-229a747bd49d", at: at("7:15"), left: at("7:25") }, now)).toEqual({
      place: "f720048c-eab5-46a5-ac1b-229a747bd49d",
      at: at("7:15"),
      left: at("7:25"),
    });
    expect(arrivedOf({ jobUuid: "office", at: at("6:50") }, now)).toEqual({ place: "office", at: at("6:50"), left: null });
    expect(arrivedOf({ jobUuid: "office", at: at("7:40") }, now)).toBeNull();
    expect(arrivedOf({ jobUuid: "office", at: "2026-10-28T08:00:00.000Z" }, now)).toBeNull();
    expect(arrivedOf(null, now)).toBeNull();
  });
});

describe("Clock on, with where the morning watch saw you arrive", () => {
  const J = "f720048c-eab5-46a5-ac1b-229a747bd49d";
  it("starts your time at the job from your arrival, and the day no later; the trip up the road is left for joinDay", () => {
    /* the 7:15 reminder's Clock on starts the day at the normal start, 7:00 */
    expect(clockOnPlan("2026-10-28T20:00:00.000Z", undefined, { place: J, at: "2026-10-28T20:15:00.000Z", left: "2026-10-28T20:25:00.000Z" })).toEqual({
      onAt: "2026-10-28T20:00:00.000Z",
      office: [],
      stint: { jobUuid: J, from: "2026-10-28T20:15:00.000Z", until: "2026-10-28T20:25:00.000Z" },
    });
    /* pressed by hand at 7:28: the day starts at the 7:15 arrival */
    expect(clockOnPlan("2026-10-28T20:28:00.000Z", undefined, { place: J, at: "2026-10-28T20:15:00.000Z", left: null }).onAt).toBe("2026-10-28T20:15:00.000Z");
  });
  it("an arrival at the office is an office stop from then; none is the day as pressed", () => {
    expect(clockOnPlan("2026-10-28T20:28:00.000Z", undefined, { place: "office", at: "2026-10-28T20:05:00.000Z", left: null })).toEqual({
      onAt: "2026-10-28T20:05:00.000Z",
      office: [{ from: "2026-10-28T20:05:00.000Z", until: null }],
      stint: null,
    });
    expect(clockOnPlan("2026-10-28T20:28:00.000Z", "office", null)).toEqual({ onAt: "2026-10-28T20:28:00.000Z", office: [{ from: "2026-10-28T20:28:00.000Z", until: null }], stint: null });
  });
});
