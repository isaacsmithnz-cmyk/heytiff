/**
 * @jest-environment node
 */

/* The bell's loader and ServiceM8: files stuck on their way there are read
   for the OWNER only — the one person who can unstick them — handed to the
   chips, and a read that fails raises no chip rather than taking the bell
   down. assemble.test and chips.test cover what the chip says once it has
   `sm8Stuck`; this pins that the loader reads it, for whom, and passes it on.
   Every other read is stubbed empty: they are their own suites'. */

jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ orgId: "org-1", user: { sub: "auth0|me" } })) },
}));
let role = "owner";
jest.mock("@/lib/permissions-server", () => ({
  getCapabilities: jest.fn(async () => new Set<string>()),
  getDbRole: jest.fn(async () => role),
}));
jest.mock("@/lib/fleet/query", () => ({
  staffProfileIdFor: jest.fn(async () => null),
  getOwnVehicle: jest.fn(async () => null),
  listFleetStaff: jest.fn(async () => []),
  listVehicles: jest.fn(async () => ({ vehicles: [] })),
}));
jest.mock("@/lib/timepay/query", () => ({ getPaySettings: jest.fn(), ownSentBackPeriod: jest.fn() }));
jest.mock("@/lib/timepay/leave-query", () => ({
  approvedInSpan: jest.fn(),
  holidaysInSpan: jest.fn(),
  stateFor: jest.fn(),
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
jest.mock("@/lib/org/query", () => ({
  listOrgCredentials: jest.fn(async () => []),
  orgExpiryWindow: jest.fn(async () => ({ warnDays: 30 })),
}));
jest.mock("@/lib/expenses/query", () => ({
  ownDeclinedClaims: jest.fn(async () => []),
  pendingClaimsCount: jest.fn(async () => 0),
}));
jest.mock("../calendar", () => ({ buildCalendar: jest.fn(), calendarSpan: jest.fn() }));
jest.mock("../journal-query", () => ({ listJournal: jest.fn() }));
jest.mock("../job-candidates", () => ({ jobCandidates: jest.fn() }));
jest.mock("../issues-query", () => ({ listOpenIssues: jest.fn() }));
jest.mock("../tasks-query", () => ({
  myTasks: jest.fn(),
  teamTasks: jest.fn(),
  recentlyDoneTasks: jest.fn(),
  assignedByMeRecentlyDone: jest.fn(),
  listNotices: jest.fn(),
  NOTICE_WINDOW: 0,
  loadStaffNames: jest.fn(),
  mentionableStaff: jest.fn(),
}));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: jest.fn() }));
jest.mock("@/lib/workboard/schedule-query", () => ({ EMPTY_SCHEDULE: {}, loadScheduleDay: jest.fn() }));
jest.mock("@/lib/integrations/links", () => ({ sm8StaffLinkMap: jest.fn() }));
const sm8QueueStuck = jest.fn();
jest.mock("@/lib/integrations/sm8-writes", () => ({ sm8QueueStuck: (...a: unknown[]) => sm8QueueStuck(...a) }));

import { loadActionRequired } from "../page-data";

const handed = () => (assembleChips.mock.calls.at(-1)![0] as { sm8Stuck: unknown }).sm8Stuck;

beforeEach(() => {
  role = "owner";
  assembleChips.mockClear();
  sm8QueueStuck.mockReset().mockResolvedValue({ reason: "billing", waiting: 2 });
});

describe("the bell's ServiceM8 line", () => {
  it("reads what is stuck for an owner, and hands it to the chips", async () => {
    await loadActionRequired();
    expect(sm8QueueStuck).toHaveBeenCalledWith("org-1");
    expect(handed()).toEqual({ reason: "billing", waiting: 2 });
  });

  it("never reads it for anybody else", async () => {
    role = "admin";
    await loadActionRequired();
    expect(sm8QueueStuck).not.toHaveBeenCalled();
    expect(handed()).toBeNull();
  });

  it("raises no chip, and keeps the bell, when the read fails", async () => {
    sm8QueueStuck.mockRejectedValue(new Error("down"));
    await loadActionRequired();
    expect(handed()).toBeNull();
  });
});
