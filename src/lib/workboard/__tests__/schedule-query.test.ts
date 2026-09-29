/* One day of the diary, read. What is pinned: the jobs come back dated by
   the booking that was drawn — the first paint of a card opened off a block
   said "Raised" and flipped to "Booked" when the sheet's own read landed,
   because this payload left `nextBooking` blank. */

type Call = {
  table: string;
  eq: Record<string, unknown>;
  gte?: [string, string];
  lt?: [string, string];
  gt?: [string, string];
  in?: [string, string[]];
  /** The columns the read named — a row comes back with those and no more. */
  select?: string[];
};

let rows: Record<string, Record<string, unknown>[]> = {};
/** Tables whose reads fail, as a table missing from the database would. */
const failing = new Set<string>();
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
  chain.gt = (col: string, val: string) => {
    call.gt = [col, val];
    return chain;
  };
  chain.maybeSingle = () => ({ then: (res: (v: { data: unknown; error: unknown }) => unknown) => (chain.then as (r: (v: { data: unknown[] }) => unknown) => Promise<unknown>)((v) => res({ data: v.data[0] ?? null, error: failing.has(name) ? { message: "down" } : null })) });
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
    if (call.gt) data = data.filter((r) => String(r[call.gt![0]]) > call.gt![1]);
    if (call.in) data = data.filter((r) => call.in![1].includes(String(r[call.in![0]])));
    if (call.select) {
      const cols = call.select;
      data = data.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
    }
    if (failing.has(name)) return Promise.resolve({ data: null, error: { message: "down" } }).then(res as never);
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
    sm8_staff: [{ uuid: "s-1", first: "Alex", last: "Lomond" }],
    sm8_jobs: [
      { uuid: "j-1", active: 1, generated_job_id: "1377", status: "Work Order", company_uuid: null, geo_city: null, category_uuid: null, job_description: null, date: "2026-04-10 09:00:00", quote_date: null, completion_date: null },
      { uuid: "j-2", active: 1, generated_job_id: "2771", status: "Unsuccessful", company_uuid: null, geo_city: null, category_uuid: null, job_description: null, date: "2026-04-02 09:00:00", quote_date: null, completion_date: null },
    ],
  };
  calls.length = 0;
  failing.clear();
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

/* TIME OFF (leave to ServiceM8, part two): asked for by the Schedule tab
   alone, and said only where the mirror holds all of it. */
describe("time off on the day", () => {
  const off = (over: Record<string, unknown>) => ({
    uuid: "av-1",
    active: 1,
    regarding_object: "staff",
    regarding_object_uuid: "s-2",
    name: "SICK",
    availability_type: "staff-annual-leave",
    start_timestamp: `${DAY} 00:00:00`,
    end_timestamp: `${DAY} 23:59:59`,
    ...over,
  });
  beforeEach(() => {
    rows.sm8_staff.push({ uuid: "s-2", first: "Luke", last: "Ingold" });
    rows.sm8_sync_state = [{ object: "availability", backfill_done: true }];
    rows.sm8_availability = [
      off({}),
      off({ uuid: "av-long", regarding_object_uuid: "s-1", name: "Holidays", start_timestamp: "2026-09-07 00:00:00", end_timestamp: "2026-09-18 23:59:59" }),
      off({ uuid: "av-holiday", regarding_object: "vendor", regarding_object_uuid: "v-1", name: "Labour Day", availability_type: "public-holiday" }),
      off({ uuid: "av-gone", active: 0 }),
      off({ uuid: "av-before", start_timestamp: "2026-09-14 00:00:00", end_timestamp: `${DAY} 00:00:00` }),
    ];
  });

  it("(F) carries who's off and whether the business is shut, and names the people off", async () => {
    const day = await loadScheduleDay("org-1", DAY, { away: true });
    expect(day.away?.map((a) => [a.uuid, a.staffUuid, a.name])).toEqual([
      ["av-long", "s-1", "Holidays"],
      ["av-1", "s-2", "SICK"],
    ]);
    expect(day.closed?.map((c) => [c.uuid, c.kind, c.name])).toEqual([["av-holiday", "holiday", "Labour Day"]]);
    expect(day.staff.map((s) => s.name).sort()).toEqual(["Alex Lomond", "Luke Ingold"]);
    // one bounded read: what starts before the day ends and ends after it begins
    const read = calls.find((c) => c.table === "sm8_availability")!;
    expect(read).toMatchObject({ eq: { org_id: "org-1", active: 1 }, lt: ["start_timestamp", "2026-09-16 00:00:00"], gt: ["end_timestamp", `${DAY} 00:00:00`] });
  });

  it("(F) says it on a day with nothing booked — a public holiday is exactly that day", async () => {
    rows.sm8_job_activities = [];
    const day = await loadScheduleDay("org-1", DAY, { away: true });
    expect(day.activities).toEqual([]);
    expect(day.away?.map((a) => a.uuid)).toEqual(["av-long", "av-1"]);
    expect(day.staff.map((s) => s.name).sort()).toEqual(["Alex Lomond", "Luke Ingold"]);
    rows.sm8_availability = rows.sm8_availability.filter((r) => r.regarding_object === "vendor");
    const shut = await loadScheduleDay("org-1", DAY, { away: true });
    expect(shut).toMatchObject({ activities: [], away: [], closed: [{ name: "Labour Day" }] });
  });

  it("(F) says nothing until the mirror's first read of it has finished — half a diary reads as people being in", async () => {
    rows.sm8_sync_state = [{ object: "availability", backfill_done: false }];
    const day = await loadScheduleDay("org-1", DAY, { away: true });
    expect(day).not.toHaveProperty("away");
    expect(day).not.toHaveProperty("closed");
    rows.sm8_sync_state = [];
    expect(await loadScheduleDay("org-1", DAY, { away: true })).not.toHaveProperty("away");
  });

  it("(F) says nothing where the table isn't there yet, and the day still reads", async () => {
    failing.add("sm8_availability");
    const day = await loadScheduleDay("org-1", DAY, { away: true });
    expect(day).not.toHaveProperty("away");
    expect(day.activities).toHaveLength(3);
  });

  it("(F) isn't read at all unless asked — Home's day costs what it did", async () => {
    const day = await loadScheduleDay("org-1", DAY);
    expect(day).not.toHaveProperty("away");
    expect(calls.some((c) => c.table === "sm8_availability" || c.table === "sm8_sync_state")).toBe(false);
  });
});
