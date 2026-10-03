/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));
let stored: unknown = null;
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: stored === null ? null : { state: stored }, error: null });
      return q;
    },
  },
}));

import { readInstallRate } from "../quote-labour-server";

/* The labour's rate is the business's own, or nothing — never ours. */
describe("the install rate", () => {
  it("is what the business charges, when its Rate Calculator says", async () => {
    stored = { currentRates: { install: 140, service: 160 } };
    expect(await readInstallRate("org-x")).toEqual({ perHourCents: 14000, from: "charged" });
  });

  it("is nothing for a business that has set nothing — no fallback number", async () => {
    stored = null;
    expect(await readInstallRate("org-new")).toBeNull();
    stored = {};
    expect(await readInstallRate("org-new")).toBeNull();
  });
});
