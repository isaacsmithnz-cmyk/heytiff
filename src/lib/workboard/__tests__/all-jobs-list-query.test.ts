/* The list-level "next booking" reads. The diary table holds two kinds of row:
   a scheduled block (activity_was_scheduled = 1) and a recorded time-on-site
   session (= 0). Only the first is a booking — the Schedule tab already draws
   by that rule, and readMirrorJobDetail already reads by it (see
   all-jobs-query.test.ts). These tests pin the LIST queries to the same rule:
   a recorded session starting today must never surface as the job's booked
   day.

   The mock applies each filter the query actually sends, so a query missing
   `activity_was_scheduled = 1` really does hand back the recorded row and the
   assertion really does fail. */

type Row = Record<string, unknown>;

let tables: Record<string, Row[]> = {};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ilikeMatch = (val: unknown, pattern: string) =>
  typeof val === "string" &&
  new RegExp(`^${pattern.split("%").map(escapeRe).join(".*")}$`, "i").test(val);

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let sortBy: { col: string; asc: boolean } | null = null;
      let cap: number | null = null;
      const rows = () => {
        let out = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (sortBy) {
          const { col, asc } = sortBy;
          out = [...out].sort((a, b) => {
            const x = String(a[col] ?? "");
            const y = String(b[col] ?? "");
            return asc ? x.localeCompare(y) : y.localeCompare(x);
          });
        }
        return cap === null ? out : out.slice(0, cap);
      };
      const sub: Record<string, unknown> = {};
      sub.select = () => sub;
      sub.eq = (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return sub;
      };
      sub.in = (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
        return sub;
      };
      sub.gte = (col: string, val: string) => {
        filters.push((r) => typeof r[col] === "string" && (r[col] as string) >= val);
        return sub;
      };
      sub.ilike = (col: string, pattern: string) => {
        filters.push((r) => ilikeMatch(r[col], pattern));
        return sub;
      };
      sub.or = (expr: string) => {
        const parts = expr.split(",").map((p) => p.split(".ilike."));
        filters.push((r) => parts.some(([col, pat]) => ilikeMatch(r[col], pat)));
        return sub;
      };
      sub.not = (col: string, op: string, val: unknown) => {
        if (op === "in") {
          const list = [...String(val).matchAll(/"([^"]*)"/g)].map((m) => m[1]);
          filters.push((r) => !list.includes(r[col] as string));
        } else if (op === "is" && val === null) {
          filters.push((r) => r[col] !== null && r[col] !== undefined);
        }
        return sub;
      };
      sub.order = (col: string, opts?: { ascending?: boolean }) => {
        sortBy = { col, asc: opts?.ascending !== false };
        return sub;
      };
      sub.limit = (n: number) => {
        cap = n;
        return sub;
      };
      sub.then = (onFulfilled: (v: { data: Row[] }) => unknown) =>
        Promise.resolve({ data: rows() }).then(onFulfilled);
      return sub;
    },
  },
}));

import { loadAllJobs, searchAllMirrorJobs } from "@/lib/workboard/all-jobs-query";

const TODAY = "2026-08-14";

const jobRow = (over: Row & { uuid: string }): Row => ({
  org_id: "org-1",
  active: 1,
  generated_job_id: "2214",
  status: "Work Order",
  company_uuid: null,
  geo_city: "Mascot",
  category_uuid: null,
  job_description: "Cool room door heater tape failed",
  date: "2026-08-08 09:00:00",
  quote_date: null,
  completion_date: null,
  ...over,
});

const activity = (over: Row): Row => ({
  org_id: "org-1",
  active: 1,
  job_uuid: "j-1",
  ...over,
});

beforeEach(() => {
  tables = {
    sm8_jobs: [jobRow({ uuid: "j-1" })],
    sm8_companies: [],
    sm8_categories: [],
    project_jobs: [],
    sm8_job_activities: [
      // A recorded time-on-site session starting today — NOT a booking.
      activity({ start_date: `${TODAY} 07:00:00`, activity_was_scheduled: 0 }),
      // The actual diary block, six days out.
      activity({ start_date: "2026-08-20 09:00:00", activity_was_scheduled: 1 }),
    ],
  };
});

describe("a recorded session is not a booking", () => {
  it("loadAllJobs takes the scheduled block, not today's recorded session", async () => {
    const { jobs } = await loadAllJobs("org-1", TODAY, { includeMoney: false });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].nextBooking).toBe("2026-08-20 09:00:00");
  });

  it("searchAllMirrorJobs takes the scheduled block, not today's recorded session", async () => {
    const found = await searchAllMirrorJobs("org-1", "2214", TODAY, { includeMoney: false });
    expect(found).toHaveLength(1);
    expect(found[0].nextBooking).toBe("2026-08-20 09:00:00");
  });

  it("a job whose only future diary rows are recorded sessions has no booking", async () => {
    tables.sm8_job_activities = [
      activity({ start_date: `${TODAY} 07:00:00`, activity_was_scheduled: 0 }),
    ];
    const { jobs } = await loadAllJobs("org-1", TODAY, { includeMoney: false });
    expect(jobs[0].nextBooking).toBeNull();
  });
});
