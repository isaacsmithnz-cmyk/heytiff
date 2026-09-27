/**
 * @jest-environment node
 */
/* WHO IS ASKING, read once from the membership row. Fails closed, as the
   permission checks do: no row, or an error, is no capabilities. */

let membership: { data: unknown; error: unknown } = { data: null, error: null };
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => membership }) }) }),
    }),
  },
}));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => "staff-1" }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));
jest.mock("@/lib/workboard/dates", () => ({ todayInZone: () => "2026-09-27" }));

import { viewerForUser } from "../viewer";

describe("viewerForUser", () => {
  it("resolves the role's capabilities with the person's own overrides", async () => {
    membership = { data: { role: "staff", permissions: { team: true } }, error: null };
    const v = await viewerForUser("org-1", "auth0|u1");
    expect(v).toMatchObject({ orgId: "org-1", userId: "auth0|u1", staffId: "staff-1", role: "staff", today: "2026-09-27" });
    expect(v.caps.has("workboard")).toBe(true);
    expect(v.caps.has("team")).toBe(true);
    expect(v.caps.has("financials")).toBe(false);
  });

  it("is no capabilities and no role without a membership", async () => {
    membership = { data: null, error: null };
    const v = await viewerForUser("org-1", "auth0|u1");
    expect(v.role).toBeNull();
    expect(v.caps.size).toBe(0);
  });

  it("is no capabilities when the read fails", async () => {
    membership = { data: { role: "owner", permissions: null }, error: { message: "down" } };
    const v = await viewerForUser("org-1", "auth0|u1");
    expect(v.caps.size).toBe(0);
  });
});
