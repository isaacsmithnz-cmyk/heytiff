/**
 * @jest-environment node
 */
/* Saving how a business's jobs are counted: money is the grant, the row is
   the business's own, and anything unreadable is saved as not set. */

const requireOrg = jest.fn();
jest.mock("@/lib/permissions-server", () => ({ requireOrg: (...a: unknown[]) => requireOrg(...a) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const upserts: unknown[] = [];
let writeError: { code?: string; message: string } | null = null;
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>, opts: unknown) => {
        const { updated_at, ...rest } = row;
        upserts.push({ table, row: rest, opts, at: typeof updated_at });
        return { error: writeError };
      },
    }),
  },
}));

import { saveAnalyticsSettings } from "../analytics-settings";

beforeEach(() => {
  upserts.length = 0;
  writeError = null;
  requireOrg.mockReset().mockResolvedValue({ orgId: "org-1", userId: "user-1" });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it("asks the money grant, and saves nothing without it", async () => {
  requireOrg.mockRejectedValue(new Error("no"));
  expect((await saveAnalyticsSettings({ lapseAfterDays: 120 })).ok).toBe(false);
  expect(requireOrg).toHaveBeenCalledWith("workboard_money");
  expect(upserts).toEqual([]);
});

it("saves the business's row, anything unreadable as not set", async () => {
  const res = await saveAnalyticsSettings({
    lapseAfterDays: 120,
    quoteFromCents: "nope",
    autoCloseDays: 0,
    categoryRoles: { "c-1": "warranty", "c-2": "boiler" },
    notCustomers: ["co-1"],
  });
  expect(res).toEqual({
    ok: true,
    settings: { lapseAfterDays: 120, quoteFromCents: null, autoCloseDays: 0, categoryRoles: { "c-1": "warranty" }, notCustomers: ["co-1"] },
  });
  expect(upserts).toEqual([
    {
      table: "analytics_settings",
      row: {
        org_id: "org-1",
        lapse_after_days: 120,
        quote_from_cents: null,
        auto_close_days: 0,
        category_roles: { "c-1": "warranty" },
        not_customers: ["co-1"],
        updated_by: "user-1",
      },
      opts: { onConflict: "org_id" },
      at: "string",
    },
  ]);
});

it("says plainly when the table isn't there yet", async () => {
  writeError = { code: "PGRST205", message: "Could not find the table" };
  expect(await saveAnalyticsSettings({})).toEqual({ ok: false, reason: "These can't be kept until the database is updated for them." });
  expect(console.error).not.toHaveBeenCalled();
});
