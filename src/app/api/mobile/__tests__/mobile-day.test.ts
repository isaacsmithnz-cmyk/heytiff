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
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
jest.mock("@/app/actions/timepay", () => ({ saveDay: async () => ({ ok: true }) }));
jest.mock("@/lib/timepay/page-data", () => ({}));
jest.mock("@/app/actions/sm8-booking-queue", () => ({}));
jest.mock("@/lib/integrations/sm8-drain", () => ({}));
jest.mock("@auth0/nextjs-auth0/server", () => ({ Auth0Client: class {} }));

import { mergeJobs, sheetCall, summarise, toQuarter, type DayJob } from "@/lib/mobile/day";

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
    { id: "c-2", jobUuid: "j-3304", inAt: at("12:55"), outAt: at("13:25") },
  ];
  const theirs = [{ jobUuid: "J-3215", from: at("07:27"), until: at("09:25") }];
  const { jobs, toSend } = mergeJobs(stints, theirs, name, at("15:00"));
  expect(jobs.map((j) => [j.jobUuid.toLowerCase(), j.how])).toEqual([
    ["j-3215", "servicem8"],
    ["j-3304", "phone"],
  ]);
  expect(toSend.map((s) => s.id)).toEqual(["c-2"]);
  expect(jobs[1]!.stintId).toBe("c-2");
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
