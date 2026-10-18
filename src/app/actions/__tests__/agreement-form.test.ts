/* New agreement opened away from the board (a job's page, a project's
   handover) reads what the board would have handed it: the agreements the
   duplicate guard checks, the categories, the connection and Tiff. */

const reads: { table: string; filters: Record<string, unknown> }[] = [];
let tables: Record<string, Record<string, unknown>[]> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const r = { table, filters: {} as Record<string, unknown> };
      reads.push(r);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (col: string, v: unknown) => {
        r.filters[col] = v;
        return chain;
      };
      chain.in = (col: string, v: unknown) => {
        r.filters[col] = v;
        return chain;
      };
      chain.then = (res: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: tables[table] ?? [], error: null }).then(res);
      return chain;
    },
  },
}));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|me" }, orgId: "org-1" })) },
}));
let caps = new Set<string>();
jest.mock("@/lib/permissions-server", () => ({ can: async (c: string) => caps.has(c) }));
let connection: { status: string } | null = null;
jest.mock("@/lib/integrations/store", () => ({ getConnectionView: async () => connection }));

import { agreementFormContext } from "../agreement-form";

beforeEach(() => {
  reads.length = 0;
  tables = {};
  caps = new Set(["workboard", "workboard_manage"]);
  connection = null;
});

it("is manage-tier: nothing for someone who can't make an agreement", async () => {
  caps = new Set(["workboard"]);
  expect(await agreementFormContext()).toBeNull();
  expect(reads).toHaveLength(0);
});

it("reads this org's active and paused agreements and its categories, by name", async () => {
  tables = {
    maintenance_agreements: [{ id: "a-1", label: "Rooftop", client_name: "Richards Building", site_label: null, status: "active" }],
    agreement_categories: [
      { id: "c-2", name: "Residential", accent: "pink" },
      { id: "c-1", name: "Commercial", accent: "blue" },
    ],
  };
  const ctx = await agreementFormContext();
  expect(ctx?.agreements).toEqual([{ id: "a-1", label: "Rooftop", clientName: "Richards Building", siteLabel: null, status: "active" }]);
  expect(ctx?.categories.map((c) => c.name)).toEqual(["Commercial", "Residential"]);
  expect(reads.find((r) => r.table === "maintenance_agreements")?.filters).toEqual({ org_id: "org-1", status: ["active", "paused"] });
  expect(reads.find((r) => r.table === "agreement_categories")?.filters).toEqual({ org_id: "org-1" });
});

it("says ServiceM8 is connected as the board does, a grant waiting to be signed in again included", async () => {
  connection = { status: "needs_reauth" };
  expect(await agreementFormContext()).toMatchObject({ connected: true });
  connection = null;
  expect(await agreementFormContext()).toMatchObject({ connected: false });
});
