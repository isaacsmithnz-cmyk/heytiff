/* A VEHICLE'S OWN PAGE, /dashboard/vehicles/[id] (v2): gated as today's
   vehicle card is. `assets_all` opens any vehicle in the org at the
   register's width; a driver without it opens the vehicle assigned to them
   at own-vehicle width (no money, no paper, no roster); every other id is a
   404. `?tab=` names a section the viewer has. */

let held: Set<string> = new Set();
const can = jest.fn(async (c: string) => held.has(c));
const redirect = jest.fn((to: string): never => {
  throw new Error(`REDIRECT:${to}`);
});
jest.mock("@/lib/permissions-server", () => ({ can: (c: string) => can(c) }));
jest.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  notFound: (): never => {
    throw new Error("NOT_FOUND");
  },
}));
let orgId: string | null = "org-1";
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => (orgId ? { user: { sub: "auth0|me" }, orgId } : null)) } }));
jest.mock("@/lib/org/query", () => ({ orgExpiryWindow: jest.fn(async () => ({ warnDays: 30 })) }));
jest.mock("@/lib/au-dates", () => ({ todayInAu: () => "2026-10-18" }));

/* this org's fleet holds two vehicles; the viewer (s-lyle) drives v1 */
const vehicle = (id: string) => ({ id, name: id === "v1" ? "Hilux" : "Pool ute", plate: id.toUpperCase(), motorised: true, status: "active", assignedTo: id === "v1" ? "s-lyle" : null });
const listVehicles = jest.fn(async () => ({ vehicles: [vehicle("v1"), vehicle("v2")], aiValues: { v1: { point: 39500 } } }));
const getOwnVehicle = jest.fn(async (_o: string, staff: string | null) => (staff === "s-lyle" ? vehicle("v1") : null));
const listLogs = jest.fn(async () => []);
jest.mock("@/lib/fleet/query", () => ({
  staffProfileIdFor: jest.fn(async () => "s-lyle"),
  listVehicles: () => listVehicles(),
  getOwnVehicle: (o: string, s: string | null) => getOwnVehicle(o, s),
  listLogs: () => listLogs(),
  listFleetStaff: jest.fn(async () => [{ id: "s-lyle", name: "Lyle Irving", status: "Active" }]),
  listPolicies: jest.fn(async () => ({ v1: [{ id: "p1" }] })),
  listFinance: jest.fn(async () => ({ v1: [{ id: "f1" }] })),
  listVehiclePicker: jest.fn(async () => [vehicle("v1"), vehicle("v2")]),
}));
const documentsForVehicles = jest.fn(async () => new Map([["v1", [{ id: "d1" }]]]));
jest.mock("@/lib/documents/query", () => ({ documentsForVehicles: () => documentsForVehicles() }));
jest.mock("@/components/fleet/vehicle-page/vehicle-page", () => ({ VehiclePage: () => null }));

import VehiclePageRoute from "../vehicles/[id]/page";

type Props = { data: Record<string, unknown> & { lens: string }; sections: string[]; section: string };
const visit = async (id: string, search: Record<string, string | string[] | undefined> = {}) =>
  (await VehiclePageRoute({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) })) as { props: Props };

beforeEach(() => {
  held = new Set(["assets_all"]);
  orgId = "org-1";
  can.mockClear();
  redirect.mockClear();
  listVehicles.mockClear();
  getOwnVehicle.mockClear();
  documentsForVehicles.mockClear();
});

describe("a manager, with the register", () => {
  it("opens any vehicle in the org at the register's width, with the money", async () => {
    const page = await visit("v2");
    expect(can).toHaveBeenCalledWith("assets_all");
    expect(page.props.data).toMatchObject({ lens: "register", vehicle: { id: "v2" }, staff: [{ id: "s-lyle" }], today: "2026-10-18", warnDays: 30 });
    expect(page.props.sections).toEqual(["overview", "service", "fuel", "issues", "documents", "money"]);
    expect(page.props.section).toBe("overview");
  });

  it("hands down the vehicle's own paper, renewals, finance and Tiff's value", async () => {
    const page = await visit("v1");
    expect(page.props.data).toMatchObject({ documents: [{ id: "d1" }], policies: [{ id: "p1" }], finance: [{ id: "f1" }], valuation: { point: 39500 } });
  });

  it("is a 404 for an id the org's register doesn't hold", async () => {
    await expect(visit("someone-elses")).rejects.toThrow("NOT_FOUND");
    await expect(visit("   ")).rejects.toThrow("NOT_FOUND");
  });

  it("opens the section ?tab= names, Money included", async () => {
    expect((await visit("v1", { tab: "money" })).props.section).toBe("money");
    expect((await visit("v1", { tab: "Service" })).props.section).toBe("service");
    expect((await visit("v1", { tab: "ledger" })).props.section).toBe("overview");
  });

  it("opens Service for an old ?tab=kilometres, where the readings went (24 October 2026)", async () => {
    expect((await visit("v1", { tab: "kilometres" })).props.section).toBe("service");
    expect((await visit("v1", { tab: "Kilometres" })).props.section).toBe("service");
  });
});

describe("a driver, without the register", () => {
  beforeEach(() => {
    held = new Set();
  });

  it("opens their own vehicle at own-vehicle width, read-only, with no money and no paper", async () => {
    const page = await visit("v1");
    expect(page.props.data).toMatchObject({ lens: "driver", vehicle: { id: "v1" }, viewerStaffId: "s-lyle" });
    expect(page.props.data).not.toHaveProperty("staff");
    expect(page.props.data).not.toHaveProperty("documents");
    expect(page.props.data).not.toHaveProperty("finance");
    expect(page.props.data).not.toHaveProperty("valuation");
    expect(page.props.sections).toEqual(["overview", "service", "fuel", "issues"]);
    expect(listVehicles).not.toHaveBeenCalled();
    expect(documentsForVehicles).not.toHaveBeenCalled();
  });

  it("is a 404 for a vehicle that isn't theirs, the pool ute included", async () => {
    await expect(visit("v2")).rejects.toThrow("NOT_FOUND");
  });

  it("lands Money and Documents on Overview", async () => {
    expect((await visit("v1", { tab: "money" })).props.section).toBe("overview");
    expect((await visit("v1", { tab: "documents" })).props.section).toBe("overview");
    expect((await visit("v1", { tab: "fuel" })).props.section).toBe("fuel");
    expect((await visit("v1", { tab: "kilometres" })).props.section).toBe("service");
  });
});

it("sends a session with no workspace back to /dashboard before it reads a vehicle", async () => {
  orgId = null;
  await expect(visit("v1")).rejects.toThrow("REDIRECT:/dashboard");
  expect(listVehicles).not.toHaveBeenCalled();
  expect(getOwnVehicle).not.toHaveBeenCalled();
});
