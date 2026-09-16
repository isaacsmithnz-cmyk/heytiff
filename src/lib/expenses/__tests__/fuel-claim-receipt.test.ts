/* THE DOCKET IS THE CLAIM'S RECEIPT WHEN THE CLAIM IS A FILL'S REIMBURSEMENT.

   "Log fuel · my own money" writes two rows: the vehicle log, which is the
   purchase's tax line, and the claim, which is how the money gets back. The
   photo is filed against the LOG — it belongs with litres, the odometer and
   the vehicle — and the claim reader only ever looked for documents filed
   against itself. So every personal-card fill reached the claimant and the
   approver marked "No receipt": the one fact that decides whether a claim is
   paid without a conversation, reported as missing on the claims that always
   have one. */

type Row = Record<string, unknown>;
const tableData: Record<string, Row[]> = {};
const seen: { table: string; column: string; value: unknown }[] = [];

const chain = (table: string) => {
  const pass = () => c;
  const c: Record<string, unknown> = {
    select: pass,
    eq: (column: string, value: unknown) => {
      seen.push({ table, column, value });
      return c;
    },
    in: (column: string, value: unknown) => {
      seen.push({ table, column, value });
      return c;
    },
    not: pass,
    is: pass,
    order: pass,
    then: (res: (v: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve({ data: tableData[table] ?? [], error: null }).then(res),
  };
  return c;
};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (name: string) => chain(name),
    storage: {
      from: () => ({
        createSignedUrls: async (refs: string[]) => ({
          data: refs.map((path) => ({ path, signedUrl: `https://signed/${path}` })),
        }),
      }),
    },
  },
}));

import { myClaims } from "../query";

beforeEach(() => {
  seen.length = 0;
  for (const k of Object.keys(tableData)) delete tableData[k];
});

const FUEL_CLAIM: Row = {
  id: "claim-1",
  staff_profile_id: "staff-1",
  vehicle_log_id: "log-9",
  expense_date: "2026-07-31",
  description: "Fuel — BP Kingsford",
  category: "fuel",
  amount: 158.4,
  gst_amount: 14.4,
  supplier: "BP Kingsford",
  paid_with: "own",
  status: "pending",
  created_at: "2026-07-31T04:00:00Z",
};

it("shows the docket filed against the fuel log as the claim's receipt", async () => {
  tableData.expense_claims = [FUEL_CLAIM];
  tableData.documents = [
    { vehicle_log_id: "log-9", storage_ref: "org-1/fuel/docket.jpg", mime_type: "image/jpeg" },
  ];
  const [claim] = await myClaims("org-1", "staff-1");
  expect(claim?.receipts).toEqual([{ url: "https://signed/org-1/fuel/docket.jpg", image: true }]);
  // and it asked for it by the log the claim names
  expect(seen).toContainEqual({ table: "documents", column: "vehicle_log_id", value: ["log-9"] });
});

it("still reports a fill with no docket as having none", async () => {
  tableData.expense_claims = [FUEL_CLAIM];
  tableData.documents = [];
  const [claim] = await myClaims("org-1", "staff-1");
  expect(claim?.receipts ?? []).toEqual([]);
});

it("asks nothing of the documents table for a claim with no fuel log", async () => {
  tableData.expense_claims = [{ ...FUEL_CLAIM, vehicle_log_id: null, category: "materials" }];
  tableData.documents = [];
  await myClaims("org-1", "staff-1");
  expect(seen.some((s) => s.column === "vehicle_log_id")).toBe(false);
});
