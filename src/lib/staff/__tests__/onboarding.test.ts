/* onboardingPending and ownDetailsGap — the two reads behind the first run and
   the reminder that outlives it. Both fail SOFT: a read that goes wrong must
   land somebody on Home, never in a redirect loop or under a false warning. */

let result: { data: unknown; error: { message: string } | null } = { data: null, error: null };
const eqs: Array<[string, unknown]> = [];
let selected = "";

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => {
        selected = cols;
        return chain;
      };
      chain.eq = (c: string, v: unknown) => {
        eqs.push([c, v]);
        return chain;
      };
      chain.maybeSingle = async () => result;
      return chain;
    },
  },
}));

import { onboardingPending, ownDetailsGap } from "../onboarding";

beforeEach(() => {
  result = { data: null, error: null };
  eqs.length = 0;
  selected = "";
});

describe("onboardingPending", () => {
  it("is owed while the card carries no stamp", async () => {
    result = { data: { onboarded_at: null }, error: null };
    await expect(onboardingPending("org-1", "auth0|luke")).resolves.toBe(true);
    expect(eqs).toEqual([["org_id", "org-1"], ["user_id", "auth0|luke"]]);
  });

  it("is answered once stamped", async () => {
    result = { data: { onboarded_at: "2026-09-16T01:00:00Z" }, error: null };
    await expect(onboardingPending("org-1", "auth0|luke")).resolves.toBe(false);
  });

  /* Including the window before the migration reaches a database: the select
     of a column that does not exist is an error, and it must not block Home. */
  it("fails open on an error or a missing card", async () => {
    result = { data: null, error: { message: 'column "onboarded_at" does not exist' } };
    await expect(onboardingPending("org-1", "auth0|luke")).resolves.toBe(false);
    result = { data: null, error: null };
    await expect(onboardingPending("org-1", "auth0|luke")).resolves.toBe(false);
  });
});

describe("ownDetailsGap", () => {
  const complete = {
    first_name: "Luke",
    last_name: "Brennan",
    birthday: "1994-02-11",
    address: "4 Pitt St, Sydney NSW 2000",
    start_date: "2026-09-15",
    employment_type: "Full-time",
    work_rights_status: "Australian citizen",
    phone: null,
    emergency_name: null,
    emergency_phone: null,
    photo_url: null,
    full_name: "Luke Brennan",
  };

  it("counts only the REQUIRED gaps, and names the first", async () => {
    result = { data: { ...complete, first_name: "luke", last_name: null, birthday: null }, error: null };
    const gap = await ownDetailsGap("org-1", "sp-1");
    expect(gap).toEqual({ requiredMissing: 2, firstLabel: "Last name", name: "luke" });
    expect(eqs).toEqual([["org_id", "org-1"], ["id", "sp-1"]]);
  });

  /* A card short only of wanted details — no mobile, no photo — is not short
     of anything the business must hold, so there is nothing to remind about. */
  it("reads zero when only wanted details are blank", async () => {
    result = { data: complete, error: null };
    await expect(ownDetailsGap("org-1", "sp-1")).resolves.toMatchObject({ requiredMissing: 0, firstLabel: null });
  });

  it("reads only the columns the model counts, plus the name", async () => {
    result = { data: complete, error: null };
    await ownDetailsGap("org-1", "sp-1");
    expect(selected.split(", ").sort()).toEqual(
      [
        "first_name", "last_name", "birthday", "address", "start_date", "employment_type",
        "work_rights_status", "phone", "emergency_name", "emergency_phone", "photo_url", "full_name",
      ].sort()
    );
  });

  it("is silent when the read fails", async () => {
    result = { data: null, error: { message: "boom" } };
    await expect(ownDetailsGap("org-1", "sp-1")).resolves.toBeNull();
  });
});
