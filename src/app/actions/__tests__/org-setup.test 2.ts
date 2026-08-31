/* completeOrgSetup / skipOrgSetup — the first-run flow's two exits.

   The profile writes are saveOrgSection's own (allowlists, ABN checksum, GST
   conversion — all pinned in org.test.ts); what this file pins is the part
   setup adds: the owner gate, the required trading name, a rejected section
   stopping the stamp, and the stamp itself preserving its first value. */

const update = jest.fn();
const isFilter = jest.fn();

let updateError: { message: string } | null = null;
let stampError: { message: string } | null = null;

const from = jest.fn((table: string) => {
  const chain: Record<string, unknown> = {};
  chain.eq = () => chain;
  chain.select = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.update = (patch: Record<string, unknown>) => {
    update(patch, table);
    /* saveOrgSection awaits `.update().eq()`; the stamp awaits
       `.update().eq().is()`. One thenable serves both: awaiting it settles
       the section write, and `.is` hangs off it for the stamp's filter. */
    const settled = Object.assign(Promise.resolve({ error: updateError }), {
      is: (column: string, value: unknown) => {
        isFilter(column, value);
        return Promise.resolve({ error: stampError });
      },
    });
    return { eq: () => settled };
  };
  return chain;
});

let dbRole: string | null = "owner";

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (...a: unknown[]) => from(...(a as [string])) },
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
  can: jest.fn(() => Promise.resolve(true)),
}));
jest.mock("../documents", () => ({ deleteDocument: jest.fn() }));
jest.mock("@/lib/org/query", () => ({ orgBrand: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { completeOrgSetup, skipOrgSetup } from "../org-setup";

const IDENTITY = { trading_name: "Smith Air", abn: "51 824 753 556", gst_registered: "Yes" };
const CONTACT = { email: "office@smithair.com.au", state: "VIC", postcode: "3000" };

beforeEach(() => {
  update.mockClear();
  isFilter.mockClear();
  from.mockClear();
  dbRole = "owner";
  updateError = null;
  stampError = null;
});

describe("completeOrgSetup", () => {
  it("saves both sections and stamps the org set up", async () => {
    const res = await completeOrgSetup(IDENTITY, CONTACT);
    expect(res).toEqual({ ok: true });

    // both section writes went through saveOrgSection's machinery
    expect(update.mock.calls[0][0]).toMatchObject({
      trading_name: "Smith Air",
      abn: "51824753556",
      gst_registered: true,
    });
    expect(update.mock.calls[1][0]).toMatchObject({ email: "office@smithair.com.au", state: "VIC" });

    // and the stamp landed last, guarded to the first completion only
    expect(update.mock.calls[2][0]).toHaveProperty("setup_completed_at");
    expect(isFilter).toHaveBeenCalledWith("setup_completed_at", null);
  });

  /* Finishing without a name would end the flow in exactly the state the
     flow exists to prevent — an org whose only name is the signup email. */
  it("refuses to finish without a trading name", async () => {
    const res = await completeOrgSetup({ trading_name: "   " }, CONTACT);
    expect(res).toMatchObject({ ok: false, fields: ["trading_name"] });
    expect(update).not.toHaveBeenCalled();
  });

  it("stops at a rejected section — no stamp over a refused save", async () => {
    const res = await completeOrgSetup({ ...IDENTITY, abn: "51824753557" }, CONTACT);
    expect(res).toMatchObject({ ok: false, fields: ["abn"] });
    expect(update).not.toHaveBeenCalled();
    expect(isFilter).not.toHaveBeenCalled();
  });

  it("refuses a non-owner, same bar as every org write", async () => {
    dbRole = "admin";
    const res = await completeOrgSetup(IDENTITY, CONTACT);
    expect(res).toEqual({ ok: false, error: "Only an owner can change organisation settings." });
    expect(update).not.toHaveBeenCalled();
  });

  it("reports a stamp that could not be written", async () => {
    stampError = { message: "nope" };
    const res = await completeOrgSetup(IDENTITY, CONTACT);
    expect(res).toEqual({ ok: false, error: "Couldn't finish setup — try again." });
  });
});

describe("skipOrgSetup", () => {
  it("stamps without touching the profile", async () => {
    const res = await skipOrgSetup();
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toHaveProperty("setup_completed_at");
    expect(update.mock.calls[0][0]).not.toHaveProperty("trading_name");
    expect(isFilter).toHaveBeenCalledWith("setup_completed_at", null);
  });

  it("refuses a non-owner", async () => {
    dbRole = "staff";
    const res = await skipOrgSetup();
    expect(res).toEqual({ ok: false, error: "Only an owner can change organisation settings." });
    expect(update).not.toHaveBeenCalled();
  });
});
