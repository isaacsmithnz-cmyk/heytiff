import { jobsTimer } from "../jobs-timing";

/* The Jobs list's reads, timed for a day (Isaac, 25 October 2026): one line
   per read, to the server's log only. */

it("writes one line: where it was read from, whether the server had just woken, when each wait finished", async () => {
  const lines: string[] = [];
  const first = jobsTimer("page", { write: (l) => lines.push(l) });
  first.mark("session");
  await first.lap("jobs", new Promise((r) => setTimeout(r, 5)));
  first.done({ rows: 3 });
  const second = jobsTimer("schedule-panel", { write: (l) => lines.push(l) });
  second.done({});
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^\[jobs-timing\] /);
  const a = JSON.parse(lines[0].slice("[jobs-timing] ".length));
  expect(a).toMatchObject({ from: "page", rows: 3 });
  expect(Object.keys(a)).toEqual(expect.arrayContaining(["cold", "session", "jobs", "total"]));
  expect(a.jobs).toBeGreaterThanOrEqual(a.session);
  expect(a.total).toBeGreaterThanOrEqual(a.jobs);
  expect(JSON.parse(lines[1].slice("[jobs-timing] ".length))).toMatchObject({ from: "schedule-panel", cold: false });
});
