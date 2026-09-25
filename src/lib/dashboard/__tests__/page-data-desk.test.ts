/**
 * @jest-environment node
 */

/* Home's loader and the new Home behind HOME_DESK.

   What is pinned: the new Home's reads happen only for a viewer the flag
   names, so the crew on today's Home pay for nothing; the expiry window and
   the org's credentials are read ONCE for the page and handed to the chips
   and the desk alike; which ServiceM8 person the viewer is is known before
   the batch starts; and the day's new fields — connected, where, crew —
   carry the viewer's own jobs and nobody else's. Every other read is stubbed
   with an honest empty answer: they are their own suites'. */

jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ orgId: "org-1", user: { sub: "auth0|me" } })) },
}));
let role = "owner";
jest.mock("@/lib/permissions-server", () => ({
  getCapabilities: jest.fn(async () => new Set<string>(["workboard", "team"])),
  getDbRole: jest.fn(async () => role),
}));
jest.mock("@/lib/fleet/query", () => ({
  staffProfileIdFor: jest.fn(async () => "s-me"),
  getOwnVehicle: jest.fn(async () => null),
  listFleetStaff: jest.fn(async () => []),
  listVehicles: jest.fn(async () => ({ vehicles: [] })),
}));
jest.mock("@/lib/timepay/query", () => ({
  getPaySettings: jest.fn(),
  ownSentBackPeriod: jest.fn(async () => null),
}));
jest.mock("@/lib/timepay/leave-query", () => ({
  approvedInSpan: jest.fn(async () => []),
  holidaysInSpan: jest.fn(async () => []),
  stateFor: jest.fn(async () => "NSW"),
  ownDeclinedLeave: jest.fn(async () => []),
  pendingLeaveCount: jest.fn(async () => 0),
}));
const assembleChips = jest.fn((input: unknown) => ({ self: [], team: [], input }));
jest.mock("../assemble", () => ({ assembleChips: (input: unknown) => assembleChips(input) }));
jest.mock("../query", () => ({ listStaffCompliance: jest.fn(async () => []) }));
jest.mock("@/lib/staff/onboarding", () => ({ ownDetailsGap: jest.fn(async () => null) }));
jest.mock("@/lib/swms/query", () => ({
  isLibraryApproved: jest.fn(async () => true),
  pendingSignons: jest.fn(async () => []),
  raisedIssues: jest.fn(async () => []),
}));
const CRED = { id: "c1", kind: "public_liability", name: "Public liability", number: null, issuer: null, expiryDate: "2026-10-20", color: null };
const listOrgCredentials = jest.fn(async (_orgId: string) => [CRED]);
const orgExpiryWindow = jest.fn(async (_orgId: string) => ({ warnDays: 45, email: true }));
jest.mock("@/lib/org/query", () => ({
  listOrgCredentials: (orgId: string) => listOrgCredentials(orgId),
  orgExpiryWindow: (orgId: string) => orgExpiryWindow(orgId),
}));
jest.mock("@/lib/expenses/query", () => ({
  ownDeclinedClaims: jest.fn(async () => []),
  pendingClaimsCount: jest.fn(async () => 0),
}));
jest.mock("../calendar", () => ({
  buildCalendar: jest.fn(() => ({ spanStart: "", spanEnd: "", days: [] })),
  calendarSpan: jest.fn(() => ({ spanStart: "2026-09-21", spanEnd: "2026-10-18" })),
}));
jest.mock("../journal-query", () => ({ listJournal: jest.fn(async () => []) }));
jest.mock("../job-candidates", () => ({ jobCandidates: jest.fn(async () => []) }));
jest.mock("../issues-query", () => ({ listOpenIssues: jest.fn(async () => []) }));
jest.mock("../tasks-query", () => ({
  myTasks: jest.fn(async () => []),
  teamTasks: jest.fn(async () => []),
  recentlyDoneTasks: jest.fn(async () => []),
  assignedByMeRecentlyDone: jest.fn(async () => []),
  listNotices: jest.fn(async () => []),
  NOTICE_WINDOW: 0,
  loadStaffNames: jest.fn(async () => new Map()),
  mentionableStaff: jest.fn(async () => []),
}));
let vendor = { tz: "Australia/Sydney" as string | null, connected: true };
jest.mock("@/lib/workboard/query", () => ({ sm8VendorOf: jest.fn(async () => vendor) }));

const DAY = "2026-09-24";
const act = (uuid: string, job: string, staff: string, from: string, to: string) => ({
  uuid,
  jobUuid: job,
  staffUuid: staff,
  start: `${DAY} ${from}:00`,
  end: `${DAY} ${to}:00`,
  wasScheduled: 1,
});
const mirror = (remoteId: string) => ({
  remoteId,
  jobNumber: remoteId.toUpperCase(),
  status: "Work Order",
  clientName: null,
  description: null,
  suburb: "Sydney",
  categoryName: null,
  categoryColour: null,
  date: null,
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: null,
  paidCents: 0,
});
/* The viewer (sm8-me) and Luke share j1; j2 is Luke's alone. */
const loadScheduleDay = jest.fn(async (_orgId: string, dayISO: string) => ({
  dayISO,
  activities: [act("a1", "j1", "sm8-me", "09:00", "10:00"), act("a2", "j1", "sm8-luke", "09:00", "10:00"), act("a3", "j2", "sm8-luke", "13:00", "14:00")],
  staff: [
    { uuid: "sm8-me", name: "Isaac Smith" },
    { uuid: "sm8-luke", name: "Luke Ingold" },
  ],
  jobs: [mirror("j1"), mirror("j2")],
  onSite: [],
  addresses: { j1: "Carrington St", j2: "Brightmore St" },
}));
jest.mock("@/lib/workboard/schedule-query", () => ({
  EMPTY_SCHEDULE: { dayISO: "", activities: [], staff: [], jobs: [], onSite: [], addresses: {} },
  loadScheduleDay: (orgId: string, dayISO: string) => loadScheduleDay(orgId, dayISO),
}));
const sm8StaffLinkMap = jest.fn(async (_orgId: string) => new Map([["sm8-me", "s-me"], ["sm8-luke", "s-luke"]]));
jest.mock("@/lib/integrations/links", () => ({ sm8StaffLinkMap: (orgId: string) => sm8StaffLinkMap(orgId) }));
jest.mock("@/lib/integrations/sm8-writes", () => ({ sm8QueueStuck: jest.fn(async () => null) }));
jest.mock("@/lib/integrations/sm8-freshness", () => ({ freshenSm8AfterResponse: jest.fn() }));

/* The desk's own loader, watched but real. */
jest.mock("../desk-data", () => {
  const actual = jest.requireActual("../desk-data");
  return { ...actual, loadDesk: jest.fn(actual.loadDesk) };
});

import { loadDesk } from "../desk-data";
import { loadActionRequired, loadDashboard } from "../page-data";

const chipsInput = () =>
  assembleChips.mock.calls.at(-1)![0] as { warnDays: number; orgCredentials: unknown[] };

const before = process.env.HOME_DESK;
beforeEach(() => {
  role = "owner";
  vendor = { tz: "Australia/Sydney", connected: true };
  delete process.env.HOME_DESK;
  jest.clearAllMocks();
});
afterAll(() => {
  if (before === undefined) delete process.env.HOME_DESK;
  else process.env.HOME_DESK = before;
});

describe("the new Home behind HOME_DESK", () => {
  it("is null, and reads nothing of its own, for a viewer the flag does not name", async () => {
    const data = await loadDashboard();
    expect(data.desk).toBeNull();
    expect(loadDesk).not.toHaveBeenCalled();

    process.env.HOME_DESK = "owner";
    role = "admin";
    expect((await loadDashboard()).desk).toBeNull();
    expect(loadDesk).not.toHaveBeenCalled();
  });

  it("is loaded for the owner on `owner`, and for everyone on `on`", async () => {
    process.env.HOME_DESK = "owner";
    expect((await loadDashboard()).desk).toEqual({ warnDays: 45 });

    process.env.HOME_DESK = "on";
    role = "staff";
    expect((await loadDashboard()).desk).toEqual({ warnDays: 45 });
    expect(loadDesk).toHaveBeenCalledTimes(2);
  });

  it("knows which ServiceM8 person the viewer is before the batch it rides in starts", async () => {
    process.env.HOME_DESK = "owner";
    await loadDashboard();
    expect(loadDesk).toHaveBeenCalledWith(expect.objectContaining({ mineUuid: "sm8-me", viewerStaffId: "s-me", isOwner: true }));
    // the link map is read up front now, not beside the schedule it narrows
    expect(sm8StaffLinkMap.mock.invocationCallOrder[0]).toBeLessThan(loadScheduleDay.mock.invocationCallOrder[0]);
  });
});

describe("the reads the chips and the desk share", () => {
  it("reads the expiry window and the org's credentials once, and hands both the same answer", async () => {
    process.env.HOME_DESK = "owner";
    const data = await loadDashboard();
    expect(orgExpiryWindow).toHaveBeenCalledTimes(1);
    expect(listOrgCredentials).toHaveBeenCalledTimes(1);
    expect(chipsInput()).toMatchObject({ warnDays: 45, orgCredentials: [CRED] });
    expect(data.desk).toEqual({ warnDays: 45 });
    expect(loadDesk).toHaveBeenCalledWith(
      expect.objectContaining({ shared: { expiry: { warnDays: 45, email: true }, orgCredentials: [CRED] } })
    );
  });

  it("reads the same two for the crew on today's Home — moved, not added", async () => {
    await loadDashboard();
    expect(orgExpiryWindow).toHaveBeenCalledTimes(1);
    expect(listOrgCredentials).toHaveBeenCalledTimes(1);
    expect(chipsInput()).toMatchObject({ warnDays: 45, orgCredentials: [CRED] });
  });

  it("still reads the org's credentials for the owner alone", async () => {
    role = "admin";
    await loadDashboard();
    expect(listOrgCredentials).not.toHaveBeenCalled();
    expect(chipsInput().orgCredentials).toEqual([]);
  });

  it("still reads them itself on the action-required page, which has no Home around it", async () => {
    await loadActionRequired();
    expect(orgExpiryWindow).toHaveBeenCalledTimes(1);
    expect(listOrgCredentials).toHaveBeenCalledTimes(1);
    expect(chipsInput()).toMatchObject({ warnDays: 45, orgCredentials: [CRED] });
  });
});

describe("the day's new fields", () => {
  it("carries the street and the crew of the viewer's own jobs, and nobody else's", async () => {
    const { rail } = await loadDashboard();
    expect(rail.blocks.map((b) => b.key)).toEqual(["a1"]);
    expect(rail.where).toEqual({ j1: "Carrington St" });
    expect(rail.crew).toEqual({ j1: ["Luke"] });
    expect(rail.connected).toBe(true);
  });

  it("says whether the workspace has ServiceM8 at all", async () => {
    vendor = { tz: null, connected: false };
    const { rail } = await loadDashboard();
    expect(rail.connected).toBe(false);
  });
});
