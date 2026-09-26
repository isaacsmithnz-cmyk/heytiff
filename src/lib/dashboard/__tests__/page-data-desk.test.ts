/**
 * @jest-environment node
 */

/* Home's loader and the desk's reads.

   What is pinned: the desk's reads happen for everyone (the new Home is
   everyone's since 2026-09-26, and the HOME_DESK switch went with the old
   one), and nothing the old Home alone read is read any more; the expiry
   window and the org's credentials are read ONCE for the page and handed to
   the chips and the desk alike; the link map (two reads in a row) holds up
   nobody's batch, and within the desk only the reads that take the viewer's
   ServiceM8 person from it; and the day's new fields — connected, where,
   crew — carry the viewer's own jobs and nobody else's. The list's own
   reads join the desk's batch, told whether the workspace has ServiceM8 at
   all, and so do the Calendar's, on the workspace's day and the page's
   shared reads, started with the batch rather than behind the link map,
   and the diary's, which asks for your ServiceM8 conversations as the
   ServiceM8 person the link map names — in a workspace that holds a
   ServiceM8 copy to read them from, and the Tasks face's, told which
   ServiceM8 person you are. Every other read is stubbed with an honest
   empty answer: they are their own suites'. */

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
jest.mock("../journal-query", () => ({ listJournal: jest.fn(async () => []) }));
jest.mock("../job-candidates", () => ({ jobCandidates: jest.fn(async () => []) }));
jest.mock("../issues-query", () => ({ listOpenIssues: jest.fn(async () => []) }));
jest.mock("../tasks-query", () => ({
  myTasks: jest.fn(async () => []),
  teamTasks: jest.fn(async () => []),
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
const sm8StaffLinkMap = jest.fn(
  async (_orgId: string): Promise<Map<string, string>> => new Map([["sm8-me", "s-me"], ["sm8-luke", "s-luke"]])
);
jest.mock("@/lib/integrations/links", () => ({ sm8StaffLinkMap: (orgId: string) => sm8StaffLinkMap(orgId) }));
/* Your next booked day, when today has nothing on (./next-day). */
const NEXT = { dayISO: "2026-09-28", blocks: [], jobs: [], where: {}, crew: {} };
const loadNextDay = jest.fn(async (..._a: unknown[]) => NEXT);
jest.mock("../next-day", () => ({ loadNextDay: (...a: unknown[]) => loadNextDay(...a) }));
jest.mock("@/lib/integrations/sm8-writes", () => ({ sm8QueueStuck: jest.fn(async () => null) }));
jest.mock("@/lib/integrations/sm8-freshness", () => ({ freshenSm8AfterResponse: jest.fn() }));

/* The list's reads are their own suite's (home-list-query): here, what they
   were asked and that their answer is the desk's. */
const LIST_READS = {
  day: "2026-09-24",
  tz: "Australia/Sydney",
  warnDays: 45,
  caps: { assetsAll: false, placeVisits: false, money: false, sm8: true },
  names: {},
  wins: [],
  visits: [],
};
const loadHomeList = jest.fn(async (_ctx: unknown) => LIST_READS);
jest.mock("../home-list-query", () => ({ loadHomeList: (ctx: unknown) => loadHomeList(ctx) }));

/* A task's Done (two-way phase 2, PR C): the bell's item is read only where
   the deployment sends notes — the module isn't even loaded otherwise. The
   Tasks face's lines are the desk's (`loadTaskLines`, below). */
const readTaskDoneLines = jest.fn(async (..._a: unknown[]) => ({ lines: { t1: [] }, sender: null }));
const myUnsentDones = jest.fn(async (..._a: unknown[]) => [{ taskId: "t1", title: "Order the grilles", noteId: "n1", op: "post" }]);
jest.mock("../task-done-query", () => ({
  readTaskDoneLines: (...a: unknown[]) => readTaskDoneLines(...a),
  myUnsentDones: (...a: unknown[]) => myUnsentDones(...a),
}));

/* The Calendar's reads are their own suite's too (lib/calendar/query). */
const CAL = {
  today: "2026-09-24",
  windowStart: "2026-09-01",
  windowEnd: "2027-08-31",
  stateName: "NSW",
  items: [],
  warnDays: 45,
  canAdd: true,
  hasSchool: true,
};
const loadCompanyCalendar = jest.fn(async (_ctx: unknown) => CAL);
jest.mock("@/lib/calendar/query", () => ({ loadCompanyCalendar: (ctx: unknown) => loadCompanyCalendar(ctx) }));

/* The diary's read is its own suite's (diary-query): here, what it was
   asked and that its answer is the desk's. One entry of today, whose two
   tasks are on Luke and on nobody. */
const DIARY_FEED: DiaryFeed = {
  day: "2026-09-24",
  today: [
    {
      kind: "entry",
      key: "entry:e1",
      sortAt: "2026-09-24 08:42:00",
      entry: {
        id: "e1",
        said: "Luke, grab the spare remote from the office before tomorrow.",
        day: "2026-09-24",
        at: "8:42 am",
        outcomes: [],
        spoken: true,
        stamp: "2026-09-24 08:42",
        routed: true,
        taskFor: { t1: "s-luke", t2: null },
        turns: [],
        undo: false,
        undone: false,
      },
    },
  ],
  earlier: [],
  mentions: false,
  syncedAt: null,
};
const loadDiaryFeed = jest.fn(async (_ctx: unknown) => DIARY_FEED);
jest.mock("../diary-query", () => ({ loadDiaryFeed: (ctx: unknown) => loadDiaryFeed(ctx) }));

/* The Tasks face's reads are their own suite's too (task-record-query). */
const TASKS = { open: [], done: [], doneCapped: false, about: {}, people: {} };
const loadTasksFace = jest.fn(async (_ctx: unknown) => TASKS);
const TASK_LINES = { lines: { t9: [] }, sender: null };
const loadTaskLines = jest.fn(async (_ctx: unknown, _record: unknown) => TASK_LINES);
jest.mock("../task-record-query", () => ({
  loadTasksFace: (ctx: unknown) => loadTasksFace(ctx),
  loadTaskLines: (ctx: unknown, record: unknown) => loadTaskLines(ctx, record),
}));

/* The desk as the loader hands it over, with the names stub's empty map:
   no initials to be had for a card it does not name, and no first name for
   Luke's task. */
const DESK = {
  warnDays: 45,
  list: LIST_READS,
  tasks: TASKS,
  taskLines: TASK_LINES,
  calendar: CAL,
  diary: { feed: DIARY_FEED, you: "?", names: {} },
};

/* The desk's own loader, watched but real. */
jest.mock("../desk-data", () => {
  const actual = jest.requireActual("../desk-data");
  return { ...actual, loadDesk: jest.fn(actual.loadDesk) };
});

import { loadDesk } from "../desk-data";
import type { DiaryFeed } from "../diary-feed";
import { jobCandidates } from "../job-candidates";
import { listNotices, loadStaffNames } from "../tasks-query";
import { approvedInSpan, holidaysInSpan } from "@/lib/timepay/leave-query";
import { loadActionRequired, loadDashboard } from "../page-data";

/* A read held open until the test lets it go. */
const held = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};
/* Every read that is not held has answered once this returns: the stubs are
   all promises, and a macrotask runs only when their chains have drained. */
const settle = () => new Promise<void>((res) => setImmediate(res));
const LINKS = () => new Map([["sm8-me", "s-me"], ["sm8-luke", "s-luke"]]);

const chipsInput = () =>
  assembleChips.mock.calls.at(-1)![0] as { warnDays: number; orgCredentials: unknown[] };

beforeEach(() => {
  role = "owner";
  vendor = { tz: "Australia/Sydney", connected: true };
  jest.clearAllMocks();
});

describe("the desk's reads", () => {
  it.each(["owner", "admin", "staff"])("are loaded for everyone — here, a viewer who is %s", async (who) => {
    role = who;
    expect((await loadDashboard()).desk).toEqual(DESK);
    expect(loadDesk).toHaveBeenCalledTimes(1);
  });

  it("are no reads at all for a visitor with no workspace", async () => {
    const { auth0 } = jest.requireMock("@/lib/auth0") as { auth0: { getSession: jest.Mock } };
    auth0.getSession.mockResolvedValueOnce(null);
    expect((await loadDashboard()).desk).toBeNull();
    expect(loadDesk).not.toHaveBeenCalled();
  });

  it("tells the desk which ServiceM8 person the viewer is, and nobody when the viewer is unlinked", async () => {
    await loadDashboard();
    expect(loadDesk).toHaveBeenCalledWith(expect.objectContaining({ viewerStaffId: "s-me", isOwner: true }), expect.any(Promise));
    expect(loadHomeList).toHaveBeenCalledWith(expect.objectContaining({ mineUuid: "sm8-me", viewerStaffId: "s-me" }));

    sm8StaffLinkMap.mockImplementationOnce(async () => new Map([["sm8-luke", "s-luke"]]));
    await loadDashboard();
    expect(loadHomeList).toHaveBeenLastCalledWith(expect.objectContaining({ mineUuid: null }));
  });

  /* The link map is two reads one after the other; the wait before the batch
     is one. Waiting for the map there would start every read in the batch a
     round trip late. */
  it("start with the batch, which does not wait for the link map", async () => {
    const links = held<Map<string, string>>();
    sm8StaffLinkMap.mockImplementationOnce(() => links.promise);

    const page = loadDashboard();
    await settle();
    expect(loadScheduleDay).toHaveBeenCalledTimes(1);
    expect(assembleChips).toHaveBeenCalledTimes(1);
    // only the desk's reads that take the viewer's ServiceM8 person wait for it
    expect(loadHomeList).not.toHaveBeenCalled();

    links.resolve(LINKS());
    const { rail, desk } = await page;
    expect(rail.linked).toBe(true);
    expect(rail.blocks.map((b) => b.key)).toEqual(["a1"]);
    expect(desk).toEqual(DESK);
    expect(loadHomeList).toHaveBeenCalledWith(expect.objectContaining({ mineUuid: "sm8-me" }));
  });

  /* Started before a wait that is not for it, the map could fail with
     nothing yet listening — an unhandled rejection, which fails this test. */
  it("fails the page on a link map that fails while the first wait is still out, and leaves no rejection unhandled", async () => {
    const names = held<Map<string, string>>();
    (loadStaffNames as jest.Mock).mockImplementationOnce(() => names.promise);
    sm8StaffLinkMap.mockImplementationOnce(async () => {
      throw new Error("links down");
    });

    // the page's own failure is listened for from the start: it is not the one under test
    const failed = loadDashboard().then(
      () => null,
      (err: unknown) => err
    );
    await settle();
    expect(sm8StaffLinkMap).toHaveBeenCalledTimes(1);
    expect(loadScheduleDay).not.toHaveBeenCalled();

    names.resolve(new Map());
    expect(await failed).toEqual(new Error("links down"));
  });
});

describe("the reads the chips and the desk share", () => {
  it("reads the expiry window and the org's credentials once, and hands both the same answer", async () => {
    const data = await loadDashboard();
    expect(orgExpiryWindow).toHaveBeenCalledTimes(1);
    expect(listOrgCredentials).toHaveBeenCalledTimes(1);
    expect(chipsInput()).toMatchObject({ warnDays: 45, orgCredentials: [CRED] });
    expect(data.desk).toEqual(DESK);
    expect(loadDesk).toHaveBeenCalledWith(
      expect.objectContaining({ shared: { expiry: { warnDays: 45, email: true }, orgCredentials: [CRED] } }),
      expect.any(Promise)
    );
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

describe("the list's reads", () => {
  it("are the desk's", async () => {
    const { desk } = await loadDashboard();
    expect(loadHomeList).toHaveBeenCalledTimes(1);
    expect(desk?.list).toBe(LIST_READS);
  });

  /* Whether there are won jobs to read at all is the vendor row's answer —
     the one the day already reads — never a guess from the zone: a vendor
     read that fails comes back connected with no zone. */
  it.each([
    [{ tz: "Australia/Sydney", connected: true }],
    [{ tz: null, connected: true }],
    [{ tz: null, connected: false }],
  ])("are told whether the workspace has ServiceM8, from the vendor row (%o)", async (v) => {
    vendor = v;
    await loadDashboard();
    expect(loadDesk).toHaveBeenCalledWith(expect.objectContaining({ connected: v.connected }), expect.any(Promise));
    expect(loadHomeList).toHaveBeenCalledWith(
      expect.objectContaining({ connected: v.connected, orgId: "org-1", railDay: expect.any(String) }),
    );
  });
});

describe("the Calendar's reads", () => {
  it("are the desk's", async () => {
    const { desk } = await loadDashboard();
    expect(loadCompanyCalendar).toHaveBeenCalledTimes(1);
    expect(desk?.calendar).toBe(CAL);
  });

  /* The calendar counts late on the workspace's day and draws the org's
     papers from the page's own read of them, never a second one. */
  it("are handed the workspace's day and the page's shared reads, and read neither again", async () => {
    await loadDashboard();
    expect(loadCompanyCalendar).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        isOwner: true,
        railDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        shared: { expiry: { warnDays: 45, email: true }, orgCredentials: [CRED] },
      }),
    );
    expect(orgExpiryWindow).toHaveBeenCalledTimes(1);
    expect(listOrgCredentials).toHaveBeenCalledTimes(1);
  });

  it("run beside the list's, not after them", async () => {
    const list = held<typeof LIST_READS>();
    loadHomeList.mockImplementationOnce(() => list.promise);
    const page = loadDashboard();
    await settle();
    expect(loadCompanyCalendar).toHaveBeenCalledTimes(1);
    list.resolve(LIST_READS);
    expect((await page).desk).toEqual(DESK);
  });

  /* The calendar asks nothing of the link map, and its own reads are two in
     a row: behind the map's two, it was the page's slowest path by a round
     trip. */
  it("start with the batch, not behind the link map", async () => {
    const links = held<Map<string, string>>();
    sm8StaffLinkMap.mockImplementationOnce(() => links.promise);
    const page = loadDashboard();
    await settle();
    expect(loadCompanyCalendar).toHaveBeenCalledTimes(1);
    expect(loadCompanyCalendar.mock.calls[0]![0]).not.toHaveProperty("mineUuid");
    expect(loadHomeList).not.toHaveBeenCalled();
    links.resolve(LINKS());
    expect((await page).desk).toEqual(DESK);
  });
});

describe("what the old Home alone read", () => {
  /* It went with the old Home (2026-09-26): its leave calendar (leave lives
     on Time & Pay; the desk draws its own Calendar), the noticeboard's rows
     it counted unread, and its Tasks face's done lists and their lines
     (the desk's Tasks face reads its own). And with the old capture UI
     (2026-09-27), the open jobs the capture card's picker offered: the Tiff
     modal asks "Which job is this for?" from its own read, on the server.
     Nothing draws them, so nothing reads them — and nothing ships them to
     the browser. */
  it("(F) is read no more, and is not on the page's data", async () => {
    const data = await loadDashboard();
    expect(approvedInSpan).not.toHaveBeenCalled();
    expect(holidaysInSpan).not.toHaveBeenCalled();
    expect(listNotices).not.toHaveBeenCalled();
    expect(readTaskDoneLines).not.toHaveBeenCalled();
    expect(jobCandidates).not.toHaveBeenCalled();
    expect(Object.keys(data).sort()).toEqual(
      ["assignable", "canManage", "chips", "desk", "issues", "journal", "rail", "tasks", "today", "viewerStaffId"],
    );
    expect(Object.keys(data.tasks).sort()).toEqual(["mine", "team"]);
    expect(data.desk?.calendar).toBe(CAL);
  });
});

describe("the diary's reads", () => {
  it("are the desk's", async () => {
    const { desk } = await loadDashboard();
    expect(loadDiaryFeed).toHaveBeenCalledTimes(1);
    expect(desk?.diary.feed).toBe(DIARY_FEED);
  });

  /* The conversations of those who @mention you (H17): asked for as the
     ServiceM8 person the link map says you are, on the workspace's day. */
  it("ask for your conversations as the ServiceM8 person you are, on the workspace's day", async () => {
    await loadDashboard();
    expect(loadDiaryFeed).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", viewerStaffId: "s-me", mineUuid: "sm8-me", tz: "Australia/Sydney", railDay: expect.any(String) }),
    );
  });

  /* Without a copy of ServiceM8 there is nothing to read the mentions
     from, and a person left in the link map is no reason to try: the
     diary is your own entries, and not cut at the mentions' reach. */
  it("ask for your own entries alone in a workspace with no ServiceM8 copy, and for a viewer ServiceM8 doesn't know", async () => {
    vendor = { tz: null, connected: false };
    await loadDashboard();
    expect(loadDiaryFeed).toHaveBeenLastCalledWith(expect.objectContaining({ mineUuid: null }));

    vendor = { tz: "Australia/Sydney", connected: true };
    sm8StaffLinkMap.mockImplementationOnce(async () => new Map([["sm8-luke", "s-luke"]]));
    await loadDashboard();
    expect(loadDiaryFeed).toHaveBeenLastCalledWith(expect.objectContaining({ mineUuid: null }));
  });

  it("carry your initials, and the first names of the people its tasks are on and nobody else's", async () => {
    (loadStaffNames as jest.Mock).mockResolvedValueOnce(
      new Map([
        ["s-me", "Isaac Smith"],
        ["s-luke", "Luke Ingold"],
        ["s-leo", "Leo Park"],
      ]),
    );
    const { desk } = await loadDashboard();
    expect(desk?.diary).toEqual({ feed: DIARY_FEED, you: "IS", names: { "s-luke": "Luke" } });
  });

  it("carry the whole name of each of two people its tasks are on who share a first name", async () => {
    const [today] = DIARY_FEED.today;
    const twoLukes: DiaryFeed = {
      ...DIARY_FEED,
      today: [
        today!.kind === "entry"
          ? { ...today!, entry: { ...today!.entry, taskFor: { t1: "s-luke", t2: "s-luke-2" } } }
          : today!,
      ],
    };
    loadDiaryFeed.mockResolvedValueOnce(twoLukes);
    (loadStaffNames as jest.Mock).mockResolvedValueOnce(
      new Map([
        ["s-me", "Isaac Smith"],
        ["s-luke", "Luke Ingold"],
        ["s-luke-2", "Luke Moreau"],
      ]),
    );
    const { desk } = await loadDashboard();
    expect(desk?.diary.names).toEqual({ "s-luke": "Luke Ingold", "s-luke-2": "Luke Moreau" });
  });
});

describe("the Tasks face's reads", () => {
  it("are the desk's", async () => {
    const { desk } = await loadDashboard();
    expect(loadTasksFace).toHaveBeenCalledTimes(1);
    expect(desk?.tasks).toBe(TASKS);
  });

  it("are told who the viewer is, what they may see, and which ServiceM8 person they are", async () => {
    await loadDashboard();
    const ctx = loadTasksFace.mock.calls[0]![0] as { orgId: string; viewerStaffId: string; caps: Set<string>; mineUuid: string };
    expect(ctx).toMatchObject({ orgId: "org-1", viewerStaffId: "s-me", mineUuid: "sm8-me" });
    expect([...ctx.caps].sort()).toEqual(["team", "workboard"]);
  });

  /* Where each task's Done stands is read over the tasks the face holds —
     which reach back 90 days — once it holds them, told the same. */
  it("read where each of the face's own tasks' Done stands, once the face holds them", async () => {
    const { desk } = await loadDashboard();
    expect(loadTaskLines).toHaveBeenCalledTimes(1);
    const [ctx, rec] = loadTaskLines.mock.calls[0]!;
    expect(ctx).toMatchObject({ orgId: "org-1", viewerStaffId: "s-me", mineUuid: "sm8-me" });
    expect(rec).toBe(TASKS);
    expect(desk?.taskLines).toBe(TASK_LINES);
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

  /* "when there is nothing on your day, it looks very bland" (Isaac,
     2026-09-26): the new Home draws your next booked day instead — the
     crew's as well as the owner's, since the new Home is everyone's. */
  it("reads your next booked day when today has nothing on for you, and only then", async () => {
    role = "staff";
    // today has the viewer's a1: nothing more is read
    expect((await loadDashboard()).rail.next).toBeNull();
    expect(loadNextDay).not.toHaveBeenCalled();

    // today is Luke's alone
    loadScheduleDay.mockImplementationOnce(async (_o: string, dayISO: string) => ({
      dayISO,
      activities: [act("a3", "j2", "sm8-luke", "13:00", "14:00")],
      staff: [{ uuid: "sm8-luke", name: "Luke Ingold" }],
      jobs: [mirror("j2")],
      onSite: [],
      addresses: { j1: "Carrington St", j2: "Brightmore St" },
    }));
    const { rail } = await loadDashboard();
    expect(rail.blocks).toEqual([]);
    expect(loadNextDay).toHaveBeenCalledWith("org-1", "sm8-me", rail.dayISO);
    expect(rail.next).toBe(NEXT);
  });

  it("reads no next day for a viewer ServiceM8 doesn't know", async () => {
    loadScheduleDay.mockImplementationOnce(async (_o: string, dayISO: string) => ({
      dayISO,
      activities: [],
      staff: [],
      jobs: [],
      onSite: [],
      addresses: { j1: "Carrington St", j2: "Brightmore St" },
    }));
    sm8StaffLinkMap.mockImplementationOnce(async () => new Map([["sm8-luke", "s-luke"]]));
    expect((await loadDashboard()).rail.next).toBeNull();
    expect(loadNextDay).not.toHaveBeenCalled();
  });
});

describe("a task's Done (two-way phase 2, PR C)", () => {
  const was = process.env.SM8_WRITES;
  afterEach(() => {
    if (was === undefined) delete process.env.SM8_WRITES;
    else process.env.SM8_WRITES = was;
  });
  const unsentOf = () => (assembleChips.mock.calls.at(-1)![0] as { ownUnsentDones: unknown }).ownUnsentDones;

  it("(F) where the deployment sends files only, Home reads no bell item, and hands the empty answer", async () => {
    process.env.SM8_WRITES = "1";
    await loadDashboard();
    expect(myUnsentDones).not.toHaveBeenCalled();
    expect(unsentOf()).toEqual([]);
  });

  /* The Tasks face reads its own lines, over its own tasks
     (`desk.taskLines`); the page reads none of its own. The bell's item is
     everyone's. */
  it("where notes are sent, reads the viewer's own unsent Dones for the bell, and leaves the lines to the desk", async () => {
    process.env.SM8_WRITES = "attachment,note";
    const data = await loadDashboard();
    expect(readTaskDoneLines).not.toHaveBeenCalled();
    expect(data.desk?.taskLines).toBe(TASK_LINES);
    expect(myUnsentDones).toHaveBeenCalledWith("org-1", "s-me", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(unsentOf()).toEqual([{ taskId: "t1", title: "Order the grilles", noteId: "n1", op: "post" }]);
  });

  it("a read that fails raises no item, and keeps the page", async () => {
    process.env.SM8_WRITES = "attachment,note";
    myUnsentDones.mockRejectedValueOnce(new Error("down"));
    await loadDashboard();
    expect(unsentOf()).toEqual([]);
  });
});
