/* completeMyOnboarding / skipMyOnboarding — the first run's two exits.

   The field writes are saveMyProfileSection's own (allowlist, date conversion,
   derived full_name — pinned in profile's tests). What this pins is the part the
   first run adds: the name it insists on, that it sends ONLY its own fields, that
   a rejected section stops the stamp, and that both exits record the answer. */

const saveMyProfileSection = jest.fn();
const stamps: Array<{ patch: Record<string, unknown>; eqs: Array<[string, unknown]>; is: [string, unknown] | null }> = [];
let stampError: { message: string } | null = null;

jest.mock("../profile", () => ({
  saveMyProfileSection: (...a: unknown[]) => saveMyProfileSection(...a),
}));
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: jest.fn(() => Promise.resolve({ orgId: "org-1", userId: "auth0|luke" })),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const rec = { patch, eqs: [] as Array<[string, unknown]>, is: null as [string, unknown] | null };
        stamps.push(rec);
        const chain = {
          eq: (c: string, v: unknown) => {
            rec.eqs.push([c, v]);
            return chain;
          },
          is: (c: string, v: unknown) => {
            rec.is = [c, v];
            return Promise.resolve({ error: stampError });
          },
        };
        return chain;
      },
    }),
  },
}));

import { completeMyOnboarding, skipMyOnboarding } from "../onboarding";

const PERSONAL = {
  first_name: "Luke",
  last_name: "Brennan",
  preferred_name: "",
  birthday: "11/02/1994",
  phone: "0412 345 678",
  address: "4 Pitt St, Sydney NSW 2000",
};
const EMERGENCY = { emergency_name: "Sam Brennan", emergency_relationship: "Partner", emergency_phone: "0400 111 222" };

beforeEach(() => {
  saveMyProfileSection.mockReset().mockResolvedValue({ ok: true });
  stamps.length = 0;
  stampError = null;
});

describe("completeMyOnboarding", () => {
  it("saves both sections through the profile's own writer, then stamps the card", async () => {
    await expect(completeMyOnboarding(PERSONAL, EMERGENCY)).resolves.toEqual({ ok: true });
    expect(saveMyProfileSection).toHaveBeenNthCalledWith(1, "personal", PERSONAL);
    expect(saveMyProfileSection).toHaveBeenNthCalledWith(2, "emergency", EMERGENCY);
    expect(stamps).toHaveLength(1);
    expect(stamps[0].patch).toEqual({ onboarded_at: expect.any(String) });
    // YOUR card, and only the first answer
    expect(stamps[0].eqs).toEqual([["org_id", "org-1"], ["user_id", "auth0|luke"]]);
    expect(stamps[0].is).toEqual(["onboarded_at", null]);
  });

  /* The name is the one thing nothing else in the flow can answer. */
  it("refuses to finish without a first and last name, and writes nothing", async () => {
    const res = await completeMyOnboarding({ ...PERSONAL, first_name: "  ", last_name: "" }, EMERGENCY);
    expect(res).toEqual({ ok: false, error: "Add your first and last name.", fields: ["first_name", "last_name"] });
    expect(saveMyProfileSection).not.toHaveBeenCalled();
    expect(stamps).toHaveLength(0);
  });

  /* A direct POST cannot use the first run to set what the business sets. */
  it("sends only the first run's own fields", async () => {
    await completeMyOnboarding(
      { ...PERSONAL, start_date: "01/01/2020", employment_type: "Casual", status: "Inactive" },
      { ...EMERGENCY, emergency_alt_phone: "0499 999 999", payroll_rate: "999" }
    );
    expect(saveMyProfileSection.mock.calls[0][1]).toEqual(PERSONAL);
    expect(saveMyProfileSection.mock.calls[1][1]).toEqual(EMERGENCY);
  });

  it("stops at a rejected section and leaves the first run owed", async () => {
    saveMyProfileSection.mockResolvedValueOnce({
      ok: false,
      error: "Check the date format — use dd/mm/yyyy.",
      fields: ["birthday"],
    });
    const res = await completeMyOnboarding({ ...PERSONAL, birthday: "31/31/1994" }, EMERGENCY);
    expect(res).toEqual({ ok: false, error: "Check the date format — use dd/mm/yyyy.", fields: ["birthday"] });
    expect(saveMyProfileSection).toHaveBeenCalledTimes(1);
    expect(stamps).toHaveLength(0);
  });
});

describe("skipMyOnboarding", () => {
  /* Skipping is a real answer: without the stamp Home would send them back on
     every visit, and a welcome would become a nag. */
  it("records the answer and writes nothing to the card", async () => {
    await expect(skipMyOnboarding()).resolves.toEqual({ ok: true });
    expect(saveMyProfileSection).not.toHaveBeenCalled();
    expect(stamps).toHaveLength(1);
    expect(stamps[0].patch).toEqual({ onboarded_at: expect.any(String) });
    expect(stamps[0].is).toEqual(["onboarded_at", null]);
  });

  it("says so when the stamp fails", async () => {
    stampError = { message: "boom" };
    await expect(skipMyOnboarding()).resolves.toEqual({ ok: false, error: "Couldn’t save — try again." });
  });
});
