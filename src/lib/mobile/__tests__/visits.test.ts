/**
 * @jest-environment node
 */

/* A job's coming visits are a day each with everyone booked on it: four
   people on 1352 on Thursday read as four, not as the first booking's Alex.
   The diary is a stand-in that records what was asked of it. */

const asked: string[] = [];
let rows: { uuid: string; start_date: string | null; end_date: string | null; staff_uuid: string | null }[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const f: string[] = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (f.push(`${c}=${v}`), q),
        gte: (c: string, v: unknown) => (f.push(`${c}>=${v}`), q),
        in: (c: string, v: string[]) => (f.push(`${c} in ${v.length}`), q),
        order: () => q,
        limit: () => q,
        then: (res: (v: unknown) => unknown) => {
          asked.push(`${table} ${f.join(" ")}`);
          if (table === "sm8_job_activities") return res({ data: rows, error: null });
          return res({
            data: [
              { uuid: "aaa-alex", first: "Alex", last: "Morozoff" },
              { uuid: "BBB-DAVID", first: "David", last: "Kim" },
              { uuid: "ccc-isaac", first: "Isaac", last: "Smith" },
              { uuid: "ddd-leo", first: "Leonardo", last: "Martins" },
            ],
            error: null,
          });
        },
      };
      return q;
    },
  },
}));

import { comingVisits } from "../visits";

beforeEach(() => {
  asked.length = 0;
});

test("a crewed day is one visit with everyone on it, from the first on to the last off", async () => {
  rows = [
    { uuid: "act-1", start_date: "2026-10-29 07:00:00", end_date: "2026-10-29 15:30:00", staff_uuid: "aaa-alex" },
    { uuid: "act-2", start_date: "2026-10-29 07:00:00", end_date: "2026-10-29 15:30:00", staff_uuid: "bbb-david" },
    { uuid: "act-3", start_date: "2026-10-29 07:30:00", end_date: "2026-10-29 16:00:00", staff_uuid: "ccc-isaac" },
    { uuid: "act-4", start_date: "2026-10-29 07:00:00", end_date: "2026-10-29 15:30:00", staff_uuid: "ddd-leo" },
    { uuid: "act-5", start_date: "2026-10-30 07:00:00", end_date: "2026-10-30 14:30:00", staff_uuid: "aaa-alex" },
  ];
  const visits = await comingVisits("org-diamond", "job-1352", "2026-10-26");
  expect(visits.map(({ people: _, ...v }) => v)).toEqual([
    { day: "2026-10-29", start: "2026-10-29 07:00:00", end: "2026-10-29 16:00:00", crew: ["Alex Morozoff", "David Kim", "Isaac Smith", "Leonardo Martins"] },
    { day: "2026-10-30", start: "2026-10-30 07:00:00", end: "2026-10-30 14:30:00", crew: ["Alex Morozoff"] },
  ]);
  /* each person's own booking, to change one from the phone */
  expect(visits[0]!.people.map((p) => [p.name, p.activity, p.start])).toEqual([
    ["Alex Morozoff", "act-1", "2026-10-29 07:00:00"],
    ["David Kim", "act-2", "2026-10-29 07:00:00"],
    ["Isaac Smith", "act-3", "2026-10-29 07:30:00"],
    ["Leonardo Martins", "act-4", "2026-10-29 07:00:00"],
  ]);
  expect(visits[1]!.people).toEqual([{ activity: "act-5", staffUuid: "aaa-alex", name: "Alex Morozoff", start: "2026-10-30 07:00:00", end: "2026-10-30 14:30:00" }]);
  expect(asked[0]).toBe("sm8_job_activities org_id=org-diamond active=1 job_uuid=job-1352 activity_was_scheduled=1 start_date>=2026-10-26");
  expect(asked[1]).toMatch(/^sm8_staff org_id=org-diamond uuid in \d+$/);
});

test("a job with nothing coming has no visits, and reads no names", async () => {
  rows = [];
  expect(await comingVisits("org-diamond", "job-1352", "2026-10-26")).toEqual([]);
  expect(asked).toHaveLength(1);
});

test("a booking with nobody on it is still a day, with no names", async () => {
  rows = [{ uuid: "act-9", start_date: "2026-11-02 09:00:00", end_date: null, staff_uuid: null }];
  expect(await comingVisits("org-diamond", "job-1352", "2026-10-26")).toEqual([{ day: "2026-11-02", start: "2026-11-02 09:00:00", end: null, crew: [], people: [] }]);
});
