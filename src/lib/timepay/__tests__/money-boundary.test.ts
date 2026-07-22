/* The money boundary is a QUERY boundary. These assert on the column list the
   query asks for, because the guarantee is that the wage is never READ without
   `financials` — not that a component remembers not to print it. */

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

beforeEach(() => {
  selected.length = 0;
  staffRows = [];
});

const columnsOf = (i = 0) => selected[i].split(",").map((c) => c.trim());

describe("everyone's timesheets", () => {
  it("does not select the wage column without `financials`", async () => {
    await listStaffWeeks("org-1", "2026-06-29", { pay: false });
    expect(columnsOf()).not.toContain("hourly_wage");
  });

  it("selects it with `financials`", async () => {
    await listStaffWeeks("org-1", "2026-06-29", { pay: true });
    expect(columnsOf()).toContain("hourly_wage");
  });

  it("leaves every rate null without it — the viewer's own row included", async () => {
    staffRows = [
      { id: "me", full_name: "Isaac", job_title: "Owner", hourly_wage: 58 },
      { id: "other", full_name: "Sam", job_title: "Installer", hourly_wage: 44 },
    ];
    const weeks = await listStaffWeeks("org-1", "2026-06-29", { pay: false });
    // even if a wage somehow rode along on the row, the mapper refuses it —
    // this screen is about other people, so it stays uniformly money-free
    expect(weeks.map((w) => w.rate)).toEqual([null, null]);
  });
});

describe("your own timesheet", () => {
  it("always includes your own rate, with no capability at all", async () => {
    staffRows = [{ id: "me", full_name: "Isaac", job_title: "Owner", hourly_wage: 58 }];
    const me = await getMyWeek("org-1", "me", "2026-06-29");
    expect(columnsOf()).toContain("hourly_wage");
    expect(me?.rate).toBe(58);
  });

  it("reports no rate rather than zero when none is set", async () => {
    // $0.00/h would read as a real wage of nothing
    staffRows = [{ id: "me", full_name: "Isaac", job_title: "Owner", hourly_wage: null }];
    const me = await getMyWeek("org-1", "me", "2026-06-29");
    expect(me?.rate).toBeNull();
  });
});
