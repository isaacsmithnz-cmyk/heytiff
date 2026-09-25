/* One day of the diary, read. What is pinned: the jobs come back dated by
   the booking that was drawn — the first paint of a card opened off a block
   said "Raised" and flipped to "Booked" when the sheet's own read landed,
   because this payload left `nextBooking` blank. */

type Call = {
  table: string;
  eq: Record<string, unknown>;
  gte?: [string, string];
  lt?: [string, string];
  in?: [string, string[]];
  /** The columns the read named — a row comes back with those and no more. */
  select?: string[];
};

let rows: Record<string, Record<string, unknown>[]> = {};
const calls: Call[] = [];

const table = (name: string) => {
  const call: Call = { table: name, eq: {} };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => {
    call.select = cols.split(",").map((c) => c.trim());
    return chain;
  };
  chain.eq = (col: string, val: unknown) => {
    call.eq[col] = val;
    return chain;
  };
  chain.gte = (col: string, val: string) => {
    call.gte = [col, val];
    return chain;
  };
  chain.lt = (col: string, val: string) => {
    call.lt = [col, val];
    return chain;
  };
  chain.in = (col: string, vals: string[]) => {
    call.in = [col, vals];
    return chain;
  };
  chain.order = () => chain;
  chain.then = (res: (v: { data: unknown }) => unknown) => {
    /* Answer the way the database would: every filter the read named. */
    let data = rows[name] ?? [];
    for (const [col, val] of Object.entries(call.eq)) {
      if (col === "org_id") continue;
      data = data.filter((r) => r[col] === val);
    }
    if (call.gte) data = data.filter((r) => String(r[call.gte![0]]) >= call.gte![1]);
    if (call.lt) data = data.filter((r) => String(r[call.lt![0]]) < call.lt![1]);
    if (call.in) data = data.filter((r) => call.in![1].includes(String(r[call.in![0]])));
    if (call.select) {
      const cols = call.select;
      data = data.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
    }
    return Promise.resolve({ data }).then(res);
  };
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));

import { loadScheduleDay } from "../schedule-query";

const DAY = "2026-09-15";

const booking = (uuid: string, job: string, start: string, end: string) => ({
  uuid,
  job_uuid: job,
  staff_uuid: "s-1",
  start_date: `${DAY} ${start}:00`,
  end_date: `${DAY} ${end}:00`,
  activity_was_scheduled: 1,
  active: 1,
});

beforeEach(() => {
  rows = {
    sm8_job_activities: [
      booking("a-1", "j-1", "09:00", "10:00"),
      booking("a-2", "j-1", "07:30", "08:30"),
      booking("a-3", "j-2", "13:00", "15:00"),
    ],
    sm8_staff: [{ uuid: "s-1", first: "Alex", last: "Lorenz" }],
    sm8_jobs: [
      { uuid: "j-1", active: 1, generated_job_id: "1377", status: "Work Order", company_uuid: null, geo_city: null, category_uuid: null, job_description: null, date: "2026-04-10 09:00:00", quote_date: null, completion_date: null },
      { uuid: "j-2", active: 1, generated_job_id: "2771", status: "Unsuccessful", company_uuid: null, geo_city: null, category_uuid: null, job_description: null, date: "2026-04-02 09:00:00", quote_date: null, completion_date: null },
    ],
  };
  calls.length = 0;
});

it("dates every job by its earliest booking on the day — what the row builder calls Booked", async () => {
  const day = await loadScheduleDay("org-1", DAY);
  expect(day.jobs.map((j) => [j.remoteId, j.nextBooking])).toEqual([
    ["j-1", `${DAY} 07:30:00`],
    ["j-2", `${DAY} 13:00:00`],
  ]);
});

describe("addresses — the street line under Home's Where", () => {
  it("keys each job's first address line by the job, and reads the column to do it", async () => {
    rows.sm8_jobs[0].job_address = "260 Birrell St,\nBondi NSW 2026";
    rows.sm8_jobs[1].job_address = "\n2 Spring St\r\nPaddington NSW 2021";
    const day = await loadScheduleDay("org-1", DAY);
    // the street alone: ServiceM8's trailing comma off, a blank first line skipped
    expect(day.addresses).toEqual({ "j-1": "260 Birrell St", "j-2": "2 Spring St" });
  });

  it("leaves out a job with no address rather than saying nothing under Where", async () => {
    rows.sm8_jobs[0].job_address = null;
    rows.sm8_jobs[1].job_address = "   ";
    const day = await loadScheduleDay("org-1", DAY);
    expect(day.addresses).toEqual({});
  });

  it("is empty on a day with nothing booked", async () => {
    rows.sm8_job_activities = [];
    const day = await loadScheduleDay("org-1", DAY);
    expect(day.addresses).toEqual({});
  });
});

it("still carries no money on the diary's jobs", async () => {
  const day = await loadScheduleDay("org-1", DAY);
  expect(day.jobs.every((j) => j.money === null && j.paidCents === 0)).toBe(true);
});
