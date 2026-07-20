/* saveOrgSection — owner-only, section-allowlisted, ABN-checked. */

const eq = jest.fn().mockResolvedValue({ error: null });
const update = jest.fn().mockReturnValue({ eq });
const from = jest.fn().mockReturnValue({ update });

let dbRole: string | null = "owner";

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (...a: unknown[]) => from(...a) },
}));
jest.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: jest.fn().mockResolvedValue({
      user: { sub: "auth0|owner" },
      orgId: "org-1",
    }),
  },
}));
jest.mock("@/lib/permissions-server", () => ({
  getDbRole: jest.fn(() => Promise.resolve(dbRole)),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { saveOrgSection } from "../org";

beforeEach(() => {
  update.mockClear();
  from.mockClear();
  dbRole = "owner";
});

describe("saveOrgSection", () => {
  it("saves an identity patch for an owner", async () => {
    const res = await saveOrgSection("identity", { trading_name: "Smith Air" });
    expect(res).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith("organizations");
    expect(update.mock.calls[0][0]).toMatchObject({ trading_name: "Smith Air" });
    expect(update.mock.calls[0][0]).toHaveProperty("updated_at");
  });

  it("refuses a non-owner — admins don't edit the company profile", async () => {
    dbRole = "admin";
    const res = await saveOrgSection("identity", { trading_name: "x" });
    expect(res).toEqual({ ok: false, error: "Only an owner can change organisation settings." });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses an unknown section without touching the database", async () => {
    const res = await saveOrgSection("payroll", { hourly_wage: "999" });
    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a bad ABN before writing", async () => {
    const res = await saveOrgSection("identity", { abn: "51824753557" });
    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("normalizes a valid spaced ABN", async () => {
    await saveOrgSection("identity", { abn: "51 824 753 556" });
    expect(update.mock.calls[0][0]).toMatchObject({ abn: "51824753556" });
  });

  it("converts the GST segmented control to a boolean, and empty to null", async () => {
    await saveOrgSection("identity", { gst_registered: "Yes" });
    expect(update.mock.calls[0][0]).toMatchObject({ gst_registered: true });
    update.mockClear();
    await saveOrgSection("identity", { gst_registered: "No" });
    expect(update.mock.calls[0][0]).toMatchObject({ gst_registered: false });
    update.mockClear();
    await saveOrgSection("identity", { gst_registered: "", trading_name: "keep" });
    expect(update.mock.calls[0][0]).toMatchObject({ gst_registered: null });
  });

  it("reports a bad insurance date instead of writing", async () => {
    const res = await saveOrgSection("compliance", { insurance_expiry: "31/02/2027" });
    expect(res).toEqual({ ok: false, error: "Check the date format — use dd/mm/yyyy." });
    expect(update).not.toHaveBeenCalled();
  });

  it("never lets a patch reach ownership or the legacy name", async () => {
    await saveOrgSection("identity", {
      trading_name: "Smith Air",
      primary_owner_user_id: "auth0|attacker",
      name: "overwrite-seed",
    });
    const patch = update.mock.calls[0][0];
    expect(patch).not.toHaveProperty("primary_owner_user_id");
    expect(patch).not.toHaveProperty("name");
  });
});
