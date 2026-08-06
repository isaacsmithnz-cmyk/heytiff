/* ONE PURCHASE, ONE LINE ON THE TAX REPORT.

   Filling the ute on a personal card produces TWO rows by design: a vehicle
   log (the record of the fuel) and an expense claim (how the money gets back
   to the person). The tax screen reads both tables. Without the exclusion
   below, that one tank appears in the year's total twice — once as fuel, once
   as a staff expense — which is exactly the double count
   lib/documents/files.ts warns about when it explains why `receipt` and
   `fuel_receipt` are two document kinds.

   The claim carries `vehicle_log_id`; the tax read skips any claim that has
   one, because the log is already that purchase's line. This is a filter on a
   query, so it fails silently and only ever in the direction of overstating a
   deduction — hence a test that watches the query itself get built. */

type Call = { table: string; method: string; args: unknown[] };
const calls: Call[] = [];

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
      Promise.resolve({ data: [], error: null }).then(res),
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

beforeEach(() => {
  calls.length = 0;
});

describe("the tax year's claim read", () => {
  it("skips claims that are the reimbursement half of a fuel log", async () => {
    await taxYear("org-1", 2026);
    expect(on("expense_claims", "is")).toContainEqual(
      expect.objectContaining({ args: ["vehicle_log_id", null] }),
    );
  });

  it("still reads fuel logs unfiltered — they ARE the tax line", async () => {
    /* The exclusion belongs on the claim side only. Applying it to the fuel
       read as well would drop personally-funded fills from the report
       entirely, which is the opposite error and a worse one. */
    await taxYear("org-1", 2026);
    expect(on("vehicle_logs", "is")).not.toContainEqual(
      expect.objectContaining({ args: ["vehicle_log_id", null] }),
    );
    expect(on("vehicle_logs", "eq")).toContainEqual(
      expect.objectContaining({ args: ["kind", "fuel"] }),
    );
  });

  it("keeps excluding declined and cancelled claims", async () => {
    // a declined claim is the business saying "that wasn't ours", which is
    // exactly what must not appear in a deduction
    await taxYear("org-1", 2026);
    expect(on("expense_claims", "in")[0]?.args).toEqual([
      "status",
      ["pending", "approved", "reimbursed"],
    ]);
  });
});
