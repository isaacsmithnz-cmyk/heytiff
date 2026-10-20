import type { ReactElement } from "react";
import type { PersonPageData } from "@/components/team/person-page";

/* /dashboard/team/[staff]: the gate, the 404, and each group read only
   under today's gate for it. */

const caps = new Set<string>();
const can = jest.fn(async (c: string) => caps.has(c));
let ownership = { role: "admin", userId: "auth0|me", primaryOwnerUserId: "auth0|owner" };
jest.mock("@/lib/permissions-server", () => ({
  can: (c: string) => can(c),
  getCapabilities: async () => caps,
  getOwnership: async () => ownership,
  getOrgName: async () => "Coastal Air",
  getOrgState: async () => "NSW",
}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => ({ orgId: "org-1", user: { sub: "auth0|me" } }) } }));
jest.mock("next/navigation", () => ({
  redirect: (to: string): never => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: (): never => {
    throw new Error("NOT_FOUND");
  },
}));
jest.mock("@/app/actions/staff", () => new Proxy({}, { get: () => ({ bind: () => jest.fn() }) }));

const row = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  userId: "auth0|lyle",
  initials: "LI",
  name: "Lyle Irving",
  email: "lyle@coastalair.com.au",
  role: "Senior tech",
  employmentType: "Full time",
  started: "Mar 2021",
  years: "5",
  licenceCount: 0,
  status: "Active",
  compliance: { label: "Compliant", state: "ok", expiresDays: 99 },
  orgRole: "staff",
  isMaster: false,
  importedFrom: null,
  ...over,
});
const getStaff = jest.fn(async (..._a: unknown[]) => ({ row: row(), profile: { notes: "Good on commissioning", hourly_wage: 45 }, licences: [] }) as unknown);
const staffCardsInUse = jest.fn(async () => new Set<string>());
jest.mock("@/lib/staff/query", () => ({
  getStaff: (...a: unknown[]) => getStaff(...a),
  listLicenceTerms: async () => ({}),
  listWorkRightsChecks: async () => [],
  permissionsOf: async () => null,
  staffCardsInUse: () => staffCardsInUse(),
}));
jest.mock("@/lib/fleet/query", () => ({ assignedVehicleFor: async () => null }));
jest.mock("@/lib/documents/query", () => ({ documentsForStaffLicences: async () => new Map(), documentsForWorkRights: async () => [] }));
jest.mock("@/lib/staff/photo", () => ({ signPhotoUrl: async () => null }));
jest.mock("@/lib/timepay/query", () => ({
  getPaySettings: async () => ({ settings: { defaultStart: "7:00 AM", defaultEnd: "3:30 PM", workDays: [0, 1, 2, 3, 4], breakMinutes: 30, breakPaid: false } }),
  shiftDefaultsFor: async () => ({ hours: new Map(), workDays: new Map() }),
}));
const balancesFor = jest.fn(async () => ({
  balances: [{ kind: "annual", balanceHours: 120, asAt: "2026-07-01", source: "manual", syncedAt: null }],
  requests: [{ id: "r1", staffId: "s1", kind: "annual", startDate: "2026-10-28", endDate: "2026-10-28", hours: 8, status: "approved", certificate: { fileName: "cert.pdf" } }],
}));
jest.mock("@/lib/timepay/leave-query", () => ({ balancesFor: () => balancesFor() }));
const sm8StaffLinkMap = jest.fn(async () => new Map([["sm8-lyle", "s1"]]));
jest.mock("@/lib/integrations/links", () => ({ sm8StaffLinkMap: () => sm8StaffLinkMap() }));
const capacityRowFor = jest.fn(async () => ({ included: true, dailyMinutes: 480 }));
jest.mock("@/lib/workboard/capacity-query", () => ({ capacityRowFor: () => capacityRowFor() }));
jest.mock("@/lib/team/regular-days-off-query", () => ({ readRegularDaysOff: async () => [] }));
jest.mock("@/lib/org/query", () => ({ orgExpiryWindow: async () => ({ warnDays: 30 }) }));
jest.mock("@/lib/staff/aliases-query", () => ({ aliasesOf: async () => [] }));
jest.mock("@/components/team/person-page", () => ({ PersonPage: () => null }));

async function dataOf(id = "s1"): Promise<PersonPageData> {
  const { default: Page } = await import("@/app/dashboard/team/[staff]/page");
  const el = (await Page({ params: Promise.resolve({ staff: id }), searchParams: Promise.resolve({}) })) as ReactElement<{ data: PersonPageData }>;
  return el.props.data;
}

beforeEach(() => {
  caps.clear();
  caps.add("team");
  ownership = { role: "admin", userId: "auth0|me", primaryOwnerUserId: "auth0|owner" };
  jest.clearAllMocks();
});

describe("a person's page", () => {
  it("sends a reader without `team` back to Home, and reads nothing", async () => {
    caps.clear();
    await expect(dataOf()).rejects.toThrow("REDIRECT:/dashboard");
    expect(getStaff).not.toHaveBeenCalled();
  });

  it("is a 404 for a card this org doesn't hold", async () => {
    getStaff.mockResolvedValueOnce(null);
    await expect(dataOf("elsewhere")).rejects.toThrow("NOT_FOUND");
  });

  it("asks for pay only with `financials`, and leaves Pay out without it", async () => {
    const d = await dataOf();
    expect(getStaff).toHaveBeenCalledWith("org-1", "s1", { pay: false, notes: true }, 30);
    expect(d.payroll).toBeNull();
    caps.add("financials");
    const withPay = await dataOf();
    expect(withPay.payroll).not.toBeNull();
  });

  it("keeps the notes off your own page", async () => {
    expect((await dataOf()).notes).toEqual({ notes: "Good on commissioning" });
    getStaff.mockResolvedValueOnce({ row: row({ userId: "auth0|me" }), profile: { notes: "x" }, licences: [] });
    const own = await dataOf();
    expect(own.isSelf).toBe(true);
    expect(own.notes).toBeNull();
  });

  it("reads leave only with `timepay_all`, and sends no certificate to the page", async () => {
    expect((await dataOf()).leave).toBeNull();
    expect(balancesFor).not.toHaveBeenCalled();
    caps.add("timepay_all");
    const d = await dataOf();
    expect(d.leave?.annual).toEqual({ available: 112, balanceHours: 120, asAt: "2026-07-01", source: "manual" });
    expect(JSON.stringify(d.leave)).not.toMatch(/cert/);
  });

  it("reads the crew row only with `workboard`, through the person's ServiceM8 link", async () => {
    const without = await dataOf();
    expect(without.crew).toBeNull();
    expect(sm8StaffLinkMap).not.toHaveBeenCalled();
    caps.add("workboard");
    const d = await dataOf();
    expect(d.crew).toEqual({ staffUuid: "sm8-lyle", included: true, dailyMinutes: 480 });
    expect(d.canManageCrew).toBe(false);
    caps.add("workboard_manage");
    expect((await dataOf()).canManageCrew).toBe(true);
  });

  it("offers Delete to an owner only, on a card nothing on the records points at", async () => {
    expect((await dataOf()).deletable).toBe(false);
    expect(staffCardsInUse).not.toHaveBeenCalled();
    ownership = { role: "owner", userId: "auth0|me", primaryOwnerUserId: "auth0|me" };
    expect((await dataOf()).deletable).toBe(true);
    staffCardsInUse.mockResolvedValueOnce(new Set(["s1"]));
    expect((await dataOf()).deletable).toBe(false);
    // a failed read offers it on none
    staffCardsInUse.mockResolvedValueOnce(null as never);
    expect((await dataOf()).deletable).toBe(false);
  });

  it("lays out the normal week from Time & Pay's hours", async () => {
    const d = await dataOf();
    expect(d.week).toMatchObject({ start: "7:00 AM", end: "3:30 PM", days: [0, 1, 2, 3, 4], perDay: 8, weekHours: 40, ownHours: false });
  });
});
