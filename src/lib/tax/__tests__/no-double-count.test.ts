/* ONE PURCHASE, ONE LINE ON THE TAX REPORT — in BOTH directions.

   Filling the ute on a personal card produces TWO rows by design: a vehicle
   log (the record of the fuel) and an expense claim (how the money gets back
   to the person). The tax screen reads both tables, so each purchase has two
   ways to go wrong:

   TWICE — the claim carries `vehicle_log_id`, and if the claim read kept it
   alongside the log, one tank would sit in the year's total as fuel AND as a
   staff expense: the double count lib/documents/files.ts warns about.

   NEVER — deleteLog only ever soft-deletes the log and deliberately leaves the
   claim standing. The fuel read skips deleted rows; if the claim read skipped
   every linked claim unconditionally, a deleted log's purchase would vanish
   from the export entirely, with real money behind it. (There is no undelete,
   so there is no path back that would need un-counting.)

   The rule under test: a linked claim yields only to a log that is still
   ALIVE, and stands in as the tax line the moment its log is withdrawn. These
   tests feed rows through the real query module and count what comes out. */

type Call = { table: string; method: string; args: unknown[] };
const calls: Call[] = [];

/* What each table returns, set per test. Both reads of vehicle_logs (the fuel
   items and the claim read's liveness check) filter on `deleted_at is null`,
   so one per-table answer stays consistent: a live log appears in both, a
   deleted one in neither. */
const tableData: Record<string, unknown[]> = {};

const chain = (table: string) => {
  const record = (method: string) =>
    (...args: unknown[]) => {
      calls.push({ table, method, args });
      return c;
    };
  const c: Record<string, unknown> = {
    select: record("select"),
    eq: record("eq"),
    is: record("is"),
    in: record("in"),
    gte: record("gte"),
    lte: record("lte"),
    not: record("not"),
    gt: record("gt"),
    order: record("order"),
    // every read in this module is awaited as a list
    then: (res: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: tableData[table] ?? [], error: null }).then(res),
  };
  return c;
};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => chain(t),
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
  },
}));

import { taxYear } from "../query";

const on = (table: string, method: string) =>
  calls.filter((c) => c.table === table && c.method === method);

const FUEL_LOG = {
  id: "log-1",
  vehicle_id: "veh-1",
  staff_profile_id: "staff-1",
  kind: "fuel",
  logged_on: "2025-09-02",
  litres: 62,
  cost: 118.4,
  gst: 10.76,
  supplier_abn: "11222333444",
  station: "BP Frankston",
};

const ITS_CLAIM = {
  id: "claim-1",
  staff_profile_id: "staff-1",
  vehicle_log_id: "log-1",
  expense_date: "2025-09-02",
  description: "Fuel — BP Frankston",
  category: "fuel",
  amount: 118.4,
  gst_amount: 10.76,
  supplier: "BP Frankston",
  status: "pending",
};

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(tableData)) delete tableData[k];
});

describe("an own-money fill: one log, one linked claim", () => {
  it("appears exactly once while the log is alive — as the fuel line", async () => {
    tableData.vehicle_logs = [FUEL_LOG];
    tableData.expense_claims = [ITS_CLAIM];

    const { items, totals } = await taxYear("org-1", 2026);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("fuel:log-1");
    expect(items[0].source).toBe("fuel");
    expect(totals.amount).toBe(118.4);
  });

  it("appears exactly once after the log is soft-deleted — as the claim", async () => {
    /* deleteLog sets deleted_at, so BOTH vehicle_logs reads (each filtered on
       `deleted_at is null`) come back empty; the claim it deliberately left
       alive is now the only record of the purchase, and must count. Zero here
       is a deduction silently lost; two is the double count. */
    tableData.vehicle_logs = [];
    tableData.expense_claims = [ITS_CLAIM];

    const { items, totals } = await taxYear("org-1", 2026);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("expense:claim-1");
    expect(items[0].source).toBe("expense");
    expect(totals.amount).toBe(118.4);

    // the skip must be a LIVENESS decision, not a blanket filter on the column
    // — the blanket filter is exactly the blind spot this test exists to hold
    // shut
    expect(on("expense_claims", "is")).not.toContainEqual(
      expect.objectContaining({ args: ["vehicle_log_id", null] }),
    );
    expect(on("vehicle_logs", "in")).toContainEqual(
      expect.objectContaining({ args: ["id", ["log-1"]] }),
    );
  });

  it("looks for the surviving claim's docket where it was filed — against the log", async () => {
    /* The receipt was photographed onto the LOG (documents.vehicle_log_id) and
       deleteLog leaves it attached there. A claim standing in for its deleted
       log must still show as substantiated. */
    tableData.vehicle_logs = [];
    tableData.expense_claims = [ITS_CLAIM];
    tableData.documents = [
      { vehicle_log_id: "log-1", expense_claim_id: null, storage_ref: "org-1/r.jpg", mime_type: "image/jpeg" },
    ];

    const { items } = await taxYear("org-1", 2026);
    expect(items).toHaveLength(1);
    expect(items[0].hasReceipt).toBe(true);
  });
});

describe("the reads themselves", () => {
  it("still reads fuel logs unfiltered by vehicle_log_id — they ARE the tax line", async () => {
    /* The yield belongs on the claim side only. Applying it to the fuel read
       as well would drop personally-funded fills from the report entirely,
       which is the opposite error and a worse one. */
    await taxYear("org-1", 2026);
    expect(on("vehicle_logs", "is")).not.toContainEqual(
      expect.objectContaining({ args: ["vehicle_log_id", null] }),
    );
    expect(on("vehicle_logs", "eq")).toContainEqual(
      expect.objectContaining({ args: ["kind", "fuel"] }),
    );
  });

  it("keeps excluding declined and cancelled claims, and keeps card receipts", async () => {
    /* A declined claim is the business saying "that wasn't ours", which is
       exactly what must not appear in a deduction.

       `recorded` is the other half of this guard and pulls the opposite way: a
       company-card docket is business spend that nothing else in the app will
       ever substantiate — the bank feed carries an amount and no receipt — and
       dropping it here would lose it from the only report built to look for
       it. Company-paid FUEL has always been in this report for the same
       reason; the two must not disagree. */
    await taxYear("org-1", 2026);
    expect(on("expense_claims", "in")[0]?.args).toEqual([
      "status",
      ["pending", "approved", "reimbursed", "recorded"],
    ]);
  });
});
