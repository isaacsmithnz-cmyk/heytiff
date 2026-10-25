/* Reports lets in whoever holds the permission one of its views needs (rule
   7), and reads only the views that viewer holds: the jobs' three on
   `workboard_money`, Tax and EOFY on `financials` (25 October 2026, it was
   Admin, Tax & EOFY). The views themselves are analytics-screen.test's. */

let grants = new Set<string>();
const can = jest.fn(async (c: string) => grants.has(c));
const redirect = jest.fn((to: string): never => {
  throw new Error(`REDIRECT:${to}`);
});
const taxYear = jest.fn(async (_org: string, fy: number) => ({ fy, items: [], totals: { amount: 0, gst: 0, count: 0, withReceipt: 0, provisionalAmount: 0, byCategory: [] } }));

jest.mock("@/lib/permissions-server", () => ({ can: (c: string) => can(c) }));
jest.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|me" }, orgId: "org-1" })) } }));
/* no ServiceM8: the jobs' views are the standalone state, read without a copy */
jest.mock("@/lib/integrations/store", () => ({ getConnectionView: jest.fn(async () => null) }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: jest.fn(async () => null) }));
jest.mock("@/lib/analytics/analytics-query", () => ({
  readAnalyticsJobs: jest.fn(),
  readAnalyticsSettings: jest.fn(),
  readClientNames: jest.fn(),
  readDecisions: jest.fn(),
}));
jest.mock("@/lib/analytics/cleanup-offer", () => ({ lostOffer: jest.fn(), workOrderOffer: jest.fn() }));
jest.mock("@/lib/tax/query", () => ({ taxYear: (org: string, fy: number) => taxYear(org, fy) }));
jest.mock("@/components/analytics/analytics-screen", () => ({ AnalyticsScreen: () => null }));
jest.mock("@/lib/au-dates", () => ({ ...jest.requireActual("@/lib/au-dates"), todayInAu: () => "2026-10-25" }));

import AnalyticsPage from "../page";

type Props = { state: unknown; tax: { year: { fy: number }; choices: number[] } | null; initialView?: string; period: string };
const propsOf = async (search: Record<string, string> = {}) =>
  ((await AnalyticsPage({ searchParams: Promise.resolve(search) })) as { props: Props }).props;

beforeEach(() => {
  taxYear.mockClear();
  redirect.mockClear();
});

describe("Reports", () => {
  it("sends someone with neither grant away", async () => {
    grants = new Set();
    await expect(propsOf()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("gives someone with the jobs' money its three views, and no Tax and EOFY", async () => {
    grants = new Set(["workboard_money"]);
    const props = await propsOf({ view: "tax" });
    expect(props.state).toEqual({ kind: "standalone" });
    expect(props.tax).toBeNull();
    expect(taxYear).not.toHaveBeenCalled();
  });

  it("gives someone with the business's money Tax and EOFY alone, the running year by default", async () => {
    grants = new Set(["financials"]);
    const props = await propsOf();
    expect(props.state).toBeNull();
    expect(props.tax?.year.fy).toBe(2027);
    expect(props.tax?.choices).toEqual([2027, 2026, 2025, 2024, 2023]);
  });

  it("opens on the year the address names, if the picker offers it", async () => {
    grants = new Set(["workboard_money", "financials"]);
    const props = await propsOf({ view: "tax", fy: "2025" });
    expect(props.initialView).toBe("tax");
    expect(props.tax?.year.fy).toBe(2025);
    expect(taxYear).toHaveBeenCalledWith("org-1", 2025);
    expect((await propsOf({ fy: "1999" })).tax?.year.fy).toBe(2027);
  });

  it("keeps the period the address names, and the default otherwise", async () => {
    grants = new Set(["workboard_money"]);
    expect((await propsOf({ period: "fy" })).period).toBe("fy");
    expect((await propsOf({ period: "nonsense" })).period).toBe("12m");
  });
});
