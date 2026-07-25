/* The money boundary is a QUERY boundary. These assert on the column list the
   query asks for, because the guarantee is that the wage is never READ where
   it doesn't belong — not that a component remembers not to print it.

   Exactly one query in this module may reach the wage column: listStaffWeeks,
   and only with `pay: true` (the caller's `financials`). Neither timesheet
   screen reads a rate, your own included. */

const selected: string[] = [];
let staffRows: Record<string, unknown>[] = [];

const chain = () => {
  const c: Record<string, unknown> = {};
  for (const m of ["eq", "neq", "in", "gte", "lte", "order", "limit"]) c[m] = () => c;
  c.select = (cols: string) => {
    selected.push(cols);
    return c;
  };
  c.maybeSingle = async () => ({ data: staffRows[0] ?? null });
  c.then = (res: (v: { data: unknown[] }) => unknown) =>
    Promise.resolve({ data: staffRows }).then(res);
  return c;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: () => chain() } }));

import { getMyWeek, listStaffWeeks } from "../query";
import type { PeriodConfig } from "../period";

const WEEKLY: PeriodConfig = { cycle: "Weekly", weekStart: "Mon", fortnightAnchor: null, monthStartDay: 1 };

beforeEach(() => {
  selected.length = 0;
  staffRows = [];
});

const columnsOf = (i = 0) => selected[i].split(",").map((c) => c.trim());

describe("everyone's timesheets", () => {
  it("does not select the wage column without `financials`", async () => {
    await listStaffWeeks("org-1", "2026-06-29", { pay: false, cfg: WEEKLY });
    expect(columnsOf()).not.toContain("hourly_wage");
  });

  it("selects it with `financials`", async () => {
    await listStaffWeeks("org-1", "2026-06-29", { pay: true, cfg: WEEKLY });
    expect(columnsOf()).toContain("hourly_wage");
  });

  it("leaves every rate null without it — the viewer's own row included", async () => {
    staffRows = [
      { id: "me", full_name: "Isaac", job_title: "Owner", hourly_wage: 58 },
      { id: "other", full_name: "Sam", job_title: "Installer", hourly_wage: 44 },
    ];
    const weeks = await listStaffWeeks("org-1", "2026-06-29", { pay: false, cfg: WEEKLY });
    // even if a wage somehow rode along on the row, the mapper refuses it —
    // this screen is about other people, so it stays uniformly money-free
    expect(weeks.map((w) => w.rate)).toEqual([null, null]);
  });
});

describe("your own timesheet", () => {
  it("does not read your wage either — a timesheet is hours", async () => {
    // your rate is yours to see, but on My profile → My Pay, which asks for
    // it in its own query. Here it would only make a gross one multiplication
    // away from a screen that must not state one.
    staffRows = [{ id: "me", full_name: "Isaac", job_title: "Owner", hourly_wage: 58 }];
    const me = await getMyWeek("org-1", "me", "2026-06-29", WEEKLY);
    expect(columnsOf()).not.toContain("hourly_wage");
    // and if a wage somehow rode along on the row, the mapper still refuses it
    expect(me?.rate).toBeNull();
  });

  it("still returns the identity and the days", async () => {
    staffRows = [{ id: "me", full_name: "Isaac", job_title: "Owner", hourly_wage: 58 }];
    const me = await getMyWeek("org-1", "me", "2026-06-29", WEEKLY);
    expect(me?.name).toBe("Isaac");
    expect(me?.role).toBe("Owner");
    expect(me?.days).toHaveLength(7);
  });
});
