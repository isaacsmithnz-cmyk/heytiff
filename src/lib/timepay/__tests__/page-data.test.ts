/* The approver's screen resolves holidays through the SAME staff→org state
   fallback My timesheet uses. The integration audit found the raw column
   being read on this path — and staff cards historically carried no state, so
   for them every public holiday resolved out of existence: the person's own
   screen said "Public holiday", the approver's said "missing day". These
   tests pin the fallback so the two screens can never read different
   calendars again. */

const ensureHolidays = jest.fn(async (..._a: unknown[]) => {});
const presumptionCtx = jest.fn(async (..._a: unknown[]) => ({
  dates: [],
  holidaysByState: new Map(),
  leaveByStaff: new Map(),
  ownHours: new Map(),
  ownWorkDays: new Map(),
  through: -1,
}));
const presumeFor = jest.fn((..._a: unknown[]) => ({
  days: [],
  sources: [],
  hours: { start: "7:00 AM", end: "3:00 PM" },
  workDays: [0, 1, 2, 3, 4],
  presume: true,
}));

jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ orgId: "org-1", user: { sub: "auth0|me" } })) },
}));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "me") }));
jest.mock("@/lib/au-dates", () => ({ todayInAu: () => "2026-07-27" }));
jest.mock("../query", () => {
  const { DEFAULT_SETTINGS } = jest.requireActual("@/components/timepay/logic");
  return {
    EMPTY_SHEET: { status: "draft" },
    getPaySettings: jest.fn(async () => ({ settings: DEFAULT_SETTINGS, configured: true })),
    listStaffWeeks: jest.fn(async () => [
      // no state of their own — must inherit the org's, not lose holidays
      { id: "me", state: null, employment: "permanent", days: [] },
      // an interstate worker's own state must survive the fallback untouched
      { id: "them", state: "QLD", employment: "permanent", days: [] },
    ]),
    sheetStates: jest.fn(async () => new Map()),
    getMyWeek: jest.fn(),
  };
});
jest.mock("../leave-query", () => ({
  // empty staff id = the org's state; a staff id would be their own lookup
  stateFor: jest.fn(async (_org: string, staffId: string) => (staffId ? null : "NSW")),
  holidaysInSpan: jest.fn(async () => []),
  myUnavailability: jest.fn(async () => []),
}));
// lazy delegation: jest hoists these factories above the const spies, so a
// direct reference would hit the temporal dead zone
jest.mock("../holiday-sync", () => ({
  ensureHolidays: (...a: unknown[]) => ensureHolidays(...(a as [])),
}));
jest.mock("../presume", () => ({
  presumptionCtx: (...a: unknown[]) => presumptionCtx(...(a as [])),
  presumeFor: (...a: unknown[]) => presumeFor(...(a as [])),
}));

import { loadTimepay } from "../page-data";

describe("loadTimepay resolves every person's holiday state staff → org", () => {
  it("feeds the fallback state to the presumption, keeps a personal one, and tops up the calendar", async () => {
    const out = await loadTimepay({ pay: false });
    expect(out).not.toBeNull();

    // the calendar guard runs with the org's state — same as My timesheet
    expect(ensureHolidays).toHaveBeenCalledWith("org-1", "NSW", "2026-07-27");

    // the shared presumption context gets the RESOLVED states, never raw nulls
    const staffArg = presumptionCtx.mock.calls[0][4] as { id: string; state: string | null }[];
    expect(staffArg).toEqual([
      { id: "me", state: "NSW" },
      { id: "them", state: "QLD" },
    ]);

    // and each person is presumed against that same resolved state
    const presumedStates = presumeFor.mock.calls.map((c) => c[1]);
    expect(presumedStates).toEqual(["NSW", "QLD"]);
  });
});
