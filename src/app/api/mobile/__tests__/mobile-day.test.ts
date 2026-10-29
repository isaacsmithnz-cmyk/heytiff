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

import { hasLife, mergeJobs, recentWindow, rosteredDays, sheetCall, stintTimes, summarise, toQuarter, type DayJob } from "@/lib/mobile/day";
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
