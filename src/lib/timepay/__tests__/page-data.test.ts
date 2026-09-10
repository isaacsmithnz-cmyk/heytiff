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
/** A presumption's result, with whatever days it filled in. */
const presumed = (days: unknown[] = [], sources: string[] = []) => ({
  days,
  sources,
  absences: new Map(),
  hours: { start: "7:00 AM", end: "3:00 PM" },
  workDays: [0, 1, 2, 3, 4],
  presume: true,
  holidayDays: [],
  certMissing: [],
});
const presumeFor = jest.fn((..._a: unknown[]) => presumed());
const sendThemselves = jest.fn(async (..._a: unknown[]) => true);
/* The AU clock the loaders read. Mon 27 Jul 2026, mid-morning: last week
   (Mon 20 – Sun 26 Jul) sent itself yesterday at 3:00 PM on the defaults, and
   this week's moment hasn't come. */
let auNow = { today: "2026-07-27", minutes: 10 * 60 };

jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ orgId: "org-1", user: { sub: "auth0|me" } })) },
}));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "me") }));
jest.mock("@/lib/au-dates", () => ({
  todayInAu: () => auNow.today,
  auMinutesNow: () => auNow.minutes,
}));
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
      // a subcontractor has no timesheet — must never reach the review screen
      { id: "sub", state: null, employment: "subbie", days: [] },
    ]),
    // "me" has already submitted — their week is frozen on every screen
    sheetStates: jest.fn(async () => new Map([["me", { status: "submitted" }]])),
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
jest.mock("../submit", () => ({
  sendThemselves: (...a: unknown[]) => sendThemselves(...(a as [])),
  momentInstant: () => "2026-07-26T05:00:00.000Z",
}));

import { loadMyTimesheet, loadTimepay } from "../page-data";
import { getMyWeek, sheetStates } from "../query";

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

  it("freezes a submitted sheet, keeps the rest live, and drops subcontractors", async () => {
    const out = await loadTimepay({ pay: false });

    // a subbie has no timesheet — not presumed, not listed, not "delinquent"
    const staffArg = presumptionCtx.mock.calls[0][4] as { id: string }[];
    expect(staffArg.map((s) => s.id)).toEqual(["me", "them"]);
    expect((out!.staff as { id: string }[]).map((s) => s.id)).toEqual(["me", "them"]);

    // the submitted week is a record — stored rows only; the other stays live
    const frozenByStaff = new Map(
      presumeFor.mock.calls.map((c) => [(c[0] as { id: string }).id, (c[5] as { frozen?: boolean })?.frozen]),
    );
    expect(frozenByStaff.get("me")).toBe(true);
    expect(frozenByStaff.get("them")).toBe(false);
  });
});

/* "IF YOU DON'T, IT SENDS ITSELF SUN 3:00 PM AND LOCKS." Nothing did, until
   now. There is no scheduler: the first read after the moment sends the draft,
   and a Monday-morning approver is as good a first read as the person. */
const W8 = { t: "work", in: "7:00 AM", out: "3:00 PM", h: 8 };

describe("a week nobody sent sends itself at the workspace's moment", () => {
  beforeEach(() => {
    sendThemselves.mockClear();
    sendThemselves.mockResolvedValue(true);
    auNow = { today: "2026-07-27", minutes: 10 * 60 };
    // "them" has a presumed Monday on it; "me" is already submitted
    presumeFor.mockImplementation((s) =>
      (s as { id: string }).id === "them" ? presumed([W8], ["presumed"]) : presumed(),
    );
  });
  afterEach(() => presumeFor.mockImplementation(() => presumed()));

  it("sends every draft with days on it, once, and hands the screen a sent sheet", async () => {
    const out = await loadTimepay({ pay: false }, "2026-07-20");
    expect(sendThemselves).toHaveBeenCalledTimes(1);
    const [org, period, sent] = sendThemselves.mock.calls[0] as [string, string, { staffId: string }[]];
    expect([org, period]).toEqual(["org-1", "2026-07-20"]);
    expect(sent.map((x) => x.staffId)).toEqual(["them"]);
    expect(out!.sheets.them).toMatchObject({ status: "submitted", submittedAt: "2026-07-26T05:00:00.000Z" });
  });

  it("sends nothing a minute before the moment", async () => {
    auNow = { today: "2026-07-26", minutes: 15 * 60 - 1 };
    await loadTimepay({ pay: false }, "2026-07-20");
    expect(sendThemselves).not.toHaveBeenCalled();
  });

  it("leaves a sent-back sheet with its owner — the approver reopened it", async () => {
    (sheetStates as unknown as jest.Mock).mockResolvedValueOnce(new Map([["them", { status: "sent_back" }]]));
    await loadTimepay({ pay: false }, "2026-07-20");
    expect(sendThemselves).not.toHaveBeenCalled();
  });

  it("doesn't call a sheet sent when the write didn't land", async () => {
    sendThemselves.mockResolvedValue(false);
    const out = await loadTimepay({ pay: false }, "2026-07-20");
    expect(out!.sheets.them).toBeUndefined();
  });
});

describe("your own week sends itself the first time you look after the moment", () => {
  beforeEach(() => {
    sendThemselves.mockClear();
    sendThemselves.mockResolvedValue(true);
    auNow = { today: "2026-07-27", minutes: 10 * 60 };
    (getMyWeek as unknown as jest.Mock).mockResolvedValue({
      id: "me",
      state: null,
      employment: "permanent",
      days: [],
    });
    // nothing sent yet this time
    (sheetStates as unknown as jest.Mock).mockResolvedValueOnce(new Map());
  });
  afterEach(() => presumeFor.mockImplementation(() => presumed()));

  it("writes it down, and the screen gets it as sent", async () => {
    presumeFor.mockImplementation(() => presumed([W8], ["presumed"]));
    const out = await loadMyTimesheet("2026-07-20");
    expect(sendThemselves).toHaveBeenCalledWith(
      "org-1",
      "2026-07-20",
      [expect.objectContaining({ staffId: "me" })],
      "2026-07-26T05:00:00.000Z",
    );
    expect(out).toMatchObject({ pastSend: true, sheet: { status: "submitted" } });
  });

  it("closes a week with nothing on it without sending it", async () => {
    const out = await loadMyTimesheet("2026-07-20");
    expect(sendThemselves).not.toHaveBeenCalled();
    expect(out).toMatchObject({ pastSend: true, sheet: { status: "draft" } });
  });

  it("is neither sent nor closed before its moment", async () => {
    presumeFor.mockImplementation(() => presumed([W8], ["presumed"]));
    const out = await loadMyTimesheet(); // this week: its Sunday hasn't come
    expect(sendThemselves).not.toHaveBeenCalled();
    expect(out).toMatchObject({ pastSend: false, sheet: { status: "draft" } });
  });
});
