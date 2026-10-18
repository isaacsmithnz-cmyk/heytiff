import type { ReactElement } from "react";
import type { TeamPageData } from "@/components/team/team-page";
import { readTeamView, teamViewHref, teamViewsFor } from "@/lib/team/views";

/* /dashboard/team: the gate, and each view asked for only under today's
   gate for it. Time & Pay's load needs `timepay_all`, the register
   `assets_all`; People and Notices come with Team. */

const caps = new Set<string>();
const can = jest.fn(async (c: string) => caps.has(c));
jest.mock("@/lib/permissions-server", () => ({
  can: (c: string) => can(c),
  getCapabilities: async () => caps,
  getDbRole: async () => "admin",
}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => ({ orgId: "org-1", user: { sub: "auth0|me" } }) } }));
jest.mock("next/headers", () => ({ headers: async () => new Map([["host", "app.test"]]) }));
jest.mock("next/navigation", () => ({
  redirect: (to: string): never => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
const listStaff = jest.fn(async () => []);
jest.mock("@/lib/staff/query", () => ({
  listStaff: () => listStaff(),
  listMembersWithoutCard: async () => [],
  listPendingInvites: async (_o: string, opts: { withLinks: boolean }) => (opts.withLinks ? [{ id: "i", token: "t" }] : [{ id: null, token: null }]),
}));
jest.mock("@/lib/org/query", () => ({ orgExpiryWindow: async () => ({ warnDays: 30 }) }));
const loadTimepaySection = jest.fn(async (_p?: string) => ({ sheets: {}, leave: {}, claims: [] }));
jest.mock("@/lib/timepay/section", () => ({ loadTimepaySection: (p?: string) => loadTimepaySection(p) }));
const loadFleetPage = jest.fn(async () => ({
  register: { vehicles: [{ id: "v1", assignedTo: "s1", status: "active", model: "Hilux", name: "", make: "Toyota", plate: "XQG 41B" }], staff: [] },
  today: "2026-10-19",
  warnDays: 30,
}));
jest.mock("@/lib/fleet/page-data", () => ({ loadFleetPage: () => loadFleetPage() }));
jest.mock("@/lib/dashboard/page-data", () => ({
  loadNoticeBoard: async () => ({ notices: [], canManage: true, canRead: true, today: "2026-10-19", staff: [], viewerStaffId: null }),
}));
jest.mock("@/components/team/team-page", () => ({ TeamPage: () => null }));

async function bodyOf(search: Record<string, string> = {}) {
  const { default: TeamRoute } = await import("@/app/dashboard/team/page");
  const page = (await TeamRoute({ searchParams: Promise.resolve(search) })) as ReactElement<{ children: ReactElement }>;
  const body = page.props.children;
  return (await (body.type as (p: unknown) => Promise<ReactElement<{ data: TeamPageData; view: string }>>)(body.props)).props;
}

beforeEach(() => {
  caps.clear();
  jest.clearAllMocks();
});

describe("the route", () => {
  it("sends a reader without `team` back to Home, and reads nothing", async () => {
    const { default: TeamRoute } = await import("@/app/dashboard/team/page");
    await expect(TeamRoute({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/dashboard");
    expect(can).toHaveBeenCalledWith("team");
    expect(listStaff).not.toHaveBeenCalled();
  });

  it("reads Time & Pay and the register only under their own gates", async () => {
    caps.add("team");
    const { data, view } = await bodyOf({ view: "timesheets" });
    expect(loadTimepaySection).not.toHaveBeenCalled();
    expect(loadFleetPage).not.toHaveBeenCalled();
    expect(data.views).toEqual(["people", "notices"]);
    expect(data.people.vehicles).toBeNull();
    // a view this reader doesn't have opens People
    expect(view).toBe("people");
  });

  it("with both, reads them, keeps the period, and maps who drives what", async () => {
    caps.add("team").add("timepay_all").add("assets_all");
    const { data, view } = await bodyOf({ view: "timesheets", period: "2026-10-13" });
    expect(loadTimepaySection).toHaveBeenCalledWith("2026-10-13");
    expect(data.views).toEqual(["people", "timesheets", "leave", "expenses", "vehicles", "notices"]);
    expect(data.people.vehicles).toEqual({ s1: "Hilux XQG 41B" });
    expect(view).toBe("timesheets");
  });

  it("hands the invite links and actions only to someone who may invite", async () => {
    caps.add("team");
    const { data } = await bodyOf();
    // invitableRoles(admin, no `invites`) is nobody
    expect(data.people.canInvite).toBe(false);
    expect(data.people.pending[0].token).toBeNull();
  });
});

describe("the views", () => {
  it("follow the gates, in the board's order", () => {
    expect(teamViewsFor({ timepay: false, fleet: false })).toEqual(["people", "notices"]);
    expect(teamViewsFor({ timepay: true, fleet: false })).toEqual(["people", "timesheets", "leave", "expenses", "notices"]);
  });

  it("read the address against what the reader has", () => {
    expect(readTeamView("leave", ["people", "leave"])).toBe("leave");
    expect(readTeamView("left", ["people", "leave"])).toBe("people");
    expect(readTeamView(["vehicles"], ["people", "vehicles"])).toBe("vehicles");
  });

  it("write their address", () => {
    expect(teamViewHref("people")).toBe("/dashboard/team");
    expect(teamViewHref("timesheets", { period: "2026-10-13" })).toBe("/dashboard/team?view=timesheets&period=2026-10-13");
  });
});
