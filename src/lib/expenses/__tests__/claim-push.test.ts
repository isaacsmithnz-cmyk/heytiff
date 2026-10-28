/**
 * @jest-environment node
 */

/* Who hears of a claim: everyone in the workspace who may approve one (an
   owner, a role with `approvals`, or someone granted it), never the person
   who sent it, and nobody whose grant was taken away. */

jest.mock("server-only", () => ({}));
jest.mock("next/server", () => ({ after: () => { throw new Error("outside a request"); } }));
const sent: { staff: readonly string[]; title: string; body?: string | null; path?: string | null }[] = [];
jest.mock("@/lib/mobile/push", () => ({
  pushToStaff: async (_org: string, staff: readonly string[], m: { title: string; body?: string | null; path?: string | null }) => {
    sent.push({ staff, ...m });
    return staff.length;
  },
}));
const members = [
  { user_id: "u-isaac", role: "owner", permissions: null },
  { user_id: "u-alex", role: "member", permissions: null },
  { user_id: "u-luke", role: "member", permissions: { approvals: true } },
  { user_id: "u-cut", role: "admin", permissions: { approvals: false } },
];
const staff: Record<string, { id: string; first_name: string }> = {
  "u-isaac": { id: "card-isaac", first_name: "Isaac" },
  "u-alex": { id: "card-alex", first_name: "Alex" },
  "u-luke": { id: "card-luke", first_name: "Luke" },
  "u-cut": { id: "card-cut", first_name: "Cut" },
};
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const f: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        in: (c: string, v: unknown) => ((f[c] = v), q),
        maybeSingle: async () => ({ data: Object.values(staff).find((s) => s.id === f.id) ?? null }),
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve(
            table === "memberships"
              ? { data: members }
              : { data: ((f.user_id as string[]) ?? []).map((u) => ({ id: staff[u]!.id })) },
          ).then(res),
      };
      return q;
    },
  },
}));

import { approverStaffIds, pushClaimDecided, pushClaimSent } from "@/lib/expenses/claim-push";

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  sent.length = 0;
});

it("finds whoever may approve, less the person who sent it", async () => {
  expect(await approverStaffIds("org-1", null)).toEqual(["card-isaac", "card-luke"]);
  expect(await approverStaffIds("org-1", "card-luke")).toEqual(["card-isaac"]);
});

it("tells the approvers who sent what, opening Approvals", async () => {
  pushClaimSent("org-1", { staffId: "card-alex", description: "Copper fittings", amount: 96.8 });
  await settle();
  await settle();
  expect(sent).toEqual([{ staff: ["card-isaac", "card-luke"], title: "Alex sent an expense claim", body: "Copper fittings, $96.80", path: "/approvals" }]);
});

it("tells the person who sent it, with the reason for a no", async () => {
  pushClaimDecided("org-1", { staffId: "card-alex", description: "Copper fittings", amount: 96.8 }, { status: "declined", note: "No receipt" });
  pushClaimDecided("org-1", { staffId: "card-alex", description: "Parking", amount: 28 }, { status: "approved", note: null });
  await settle();
  expect(sent).toEqual([
    { staff: ["card-alex"], title: "Your expense claim was declined", body: "Copper fittings: No receipt", path: "/expenses" },
    { staff: ["card-alex"], title: "Your expense claim was approved", body: "Parking, $28.00", path: "/expenses" },
  ]);
});
