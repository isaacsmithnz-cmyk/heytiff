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

import { readCalcDay } from "../org-day-server";

/* What the business's own Rate Calculator says, or nothing — never ours. */
describe("the Rate Calculator's day", () => {
  it("is the rate the business charges and its working hours", async () => {
    stored = { currentRates: { install: 140, service: 160 }, settings: { working_hours: 7.5 } };
    expect(await readCalcDay("org-x")).toMatchObject({ chargedCents: 14000, workingHours: 7.5 });
  });

  it("is nothing for a business with no Rate Calculator", async () => {
    stored = null;
    expect(await readCalcDay("org-new")).toBeNull();
  });
});
