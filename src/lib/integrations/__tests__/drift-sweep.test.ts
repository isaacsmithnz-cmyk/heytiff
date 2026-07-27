/* The sweep's honesty rules. The count is the only thing stored, so the one
   way it can lie is by being computed over reads that never happened — the
   audit found a transient Xero failure writing drift_count = 0 and taking the
   Time & Pay warning down. These tests pin the rule: a run with ANY failed
   read records nothing. */

const updates: { table: string; patch: Record<string, unknown> }[] = [];

let wageRows: { id: string; hourly_wage: number | null }[] = [];
let storedCount: number | null = null;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      const self = () => c;
      c.select = self;
      c.eq = self;
      c.in = self;
      c.maybeSingle = async () => ({ data: { drift_count: storedCount } });
      c.update = (patch: Record<string, unknown>) => {
        updates.push({ table, patch });
        return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      };
      c.then = (res: (v: { error: null; data: unknown[] }) => unknown) =>
        Promise.resolve({ error: null, data: table === "staff_profiles" ? wageRows : [] }).then(res);
      return c;
    },
  },
}));

let linkRows: { staffProfileId: string; remoteId: string }[] = [];
jest.mock("../links", () => ({
  listPayrollLinks: jest.fn(async () => linkRows),
}));

type Line = {
  earningsRateID: string;
  calculationType: string | null;
  ratePerUnit: number | null;
  annualSalary: number | null;
  numberOfUnitsPerWeek: number | null;
};
let lines: Record<string, { ok: true; data: Line } | { ok: false; error: string }> = {};
let ratesResult: { ok: true; data: unknown[] } | { ok: false; error: string } = { ok: true, data: [] };
let changedSince: { ok: true; data: { employeeId: string }[] } | { ok: false; error: string } = {
  ok: true,
  data: [],
};
jest.mock("../xero-read", () => ({
  getOrdinaryPayLine: jest.fn(async (_org: string, remoteId: string) => lines[remoteId]),
  listEarningsRates: jest.fn(async () => ratesResult),
  listPayrollEmployees: jest.fn(async () => changedSince),
}));

import { clearDrift, compareWages, sweepOrg } from "../drift-sweep";

const hourly = (rate: number): Line => ({
  earningsRateID: "er-1",
  calculationType: "ENTEREARNINGSRATE",
  ratePerUnit: rate,
  annualSalary: null,
  numberOfUnitsPerWeek: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  updates.length = 0;
  storedCount = null;
  wageRows = [
    { id: "s1", hourly_wage: 58 },
    { id: "s2", hourly_wage: 60 },
  ];
  linkRows = [
    { staffProfileId: "s1", remoteId: "x1" },
    { staffProfileId: "s2", remoteId: "x2" },
  ];
  lines = {
    x1: { ok: true, data: hourly(58) },
    x2: { ok: true, data: hourly(61.5) },
  };
  ratesResult = { ok: true, data: [] };
  changedSince = { ok: true, data: [] };
});

const driftWrites = () => updates.filter((u) => u.table === "integration_connections");

describe("compareWages keeps a failed read distinguishable", () => {
  it("one person's failed read is unreadable, not silently comparable", async () => {
    lines.x2 = { ok: false, error: "Xero didn't answer." };
    const out = await compareWages("org-1", "t-1");
    expect(out!.byStaff.get("s1")!.kind).toBe("match");
    expect(out!.byStaff.get("s2")!.kind).toBe("unreadable");
  });

  it("a failed org-rates read makes inherited-rate people unreadable — not 'not found'", async () => {
    ratesResult = { ok: false, error: "Xero didn't answer." };
    lines.x2 = {
      ok: true,
      data: { ...hourly(0), calculationType: "USEEARNINGSRATE", ratePerUnit: null },
    };
    const out = await compareWages("org-1", "t-1");
    // the template-rate person is unaffected — their number never needed the list
    expect(out!.byStaff.get("s1")!.kind).toBe("match");
    // the inherited-rate person's failure is OUR fetch, not Xero's data
    expect(out!.byStaff.get("s2")!.kind).toBe("unreadable");
  });
});

describe("sweepOrg records nothing on a partial read", () => {
  it("a clean full sweep records the count", async () => {
    const res = await sweepOrg("org-1", "t-1", null);
    expect(res).toMatchObject({ kind: "checked", count: 1 }); // s2 differs
    expect(driftWrites()).toHaveLength(1);
    expect(driftWrites()[0].patch).toMatchObject({ drift_count: 1 });
  });

  it("a sweep with a failed read reports partial and leaves the flag alone", async () => {
    lines.x2 = { ok: false, error: "Xero didn't answer." };
    const res = await sweepOrg("org-1", "t-1", null);
    expect(res).toMatchObject({ kind: "partial", unreadable: 1 });
    // no write: the old count and cursor stand, so next run retries the window
    expect(driftWrites()).toHaveLength(0);
  });
});

describe("clearDrift forgets count and cursor together", () => {
  it("writes both nulls — a cursor without a count would fake an 'unchanged' next sweep", async () => {
    await clearDrift("org-1");
    expect(driftWrites()[0].patch).toEqual({ drift_count: null, drift_checked_at: null });
  });
});

describe("archived staff leave the comparison", () => {
  /* Their link survives (a restore brings the match back), but their wage
     pays nothing, their drift would be an unresolvable nag, and each one
     cost a Xero call per sweep. */
  it("spends no call on them and reports no drift for them", async () => {
    wageRows = [{ id: "s1", hourly_wage: 58 }]; // s2 is archived — not returned
    const out = await compareWages("org-1", "t-1");
    expect(out!.byStaff.has("s2")).toBe(false);
    expect(out!.byStaff.get("s1")!.kind).toBe("match");
    const { getOrdinaryPayLine } = jest.requireMock("../xero-read");
    expect(getOrdinaryPayLine).toHaveBeenCalledTimes(1);
    expect(getOrdinaryPayLine).toHaveBeenCalledWith("org-1", "x1");
  });
});
