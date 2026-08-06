import { auth0 } from "@/lib/auth0";
import { getCapabilities } from "@/lib/permissions-server";
import { todayInAu } from "@/lib/au-dates";
import { getOwnVehicle, listFleetStaff, listVehicles, staffProfileIdFor } from "@/lib/fleet/query";
import type { Vehicle } from "@/components/fleet/logic";
import type { Capability } from "@/lib/permissions";
import { getPaySettings, ownSentBackPeriod, sheetStates } from "@/lib/timepay/query";
import { addDays, periodEnd, periodLabel, periodStartFor } from "@/lib/timepay/period";
import { approvedInSpan, holidaysInSpan, stateFor } from "@/lib/timepay/leave-query";
import { assembleChips, type DashboardChips } from "./assemble";
import { CLAIM_NUDGE_DAYS } from "./chips";
import { listStaffCompliance, orgInsurance, type StaffCompliance } from "./query";
import { ownDeclinedClaims, pendingClaimsCount } from "@/lib/expenses/query";
import { rosterToday, type RosterToday } from "./roster";
import { payRunItem, tallySheets, type MoneyItem } from "./money";
import {
  myTasks,
  teamTasks,
  recentlyDoneTasks,
  assignedByMeRecentlyDone,
  listNotices,
  loadStaffNames,
  mentionableStaff,
  type StaffNames,
} from "./tasks-query";
import type { MentionTarget } from "./comments";
import type { BoardNotice } from "./board";
import { RECENT_DONE_DAYS, sortNotices, sortTasks, type DashTask } from "./tasks";

/* Dashboard page loader. The capability scoping and every derivation are pure
   and live in ./assemble, ./roster and ./money; this file is the thin I/O layer
   that resolves the session once, reads only the data the viewer may see, and
   hands it over.

   The three sections mirror the spec:
     chips  — action-required expiries. self is intrinsic; team/fleet gated.
     roster — who's off today. `team` only.
     money  — the pay-run status. `financials` only. */

export type DashboardData = {
  chips: DashboardChips;
  /** Null unless the viewer holds `team`. */
  roster: RosterToday | null;
  /** Empty unless the viewer holds `financials`. */
  money: MoneyItem[];
  /** Your open tasks (always), the team's (only with `team`), and your
      recently-completed ones so finishing something leaves a trace. */
  tasks: { mine: DashTask[]; team: DashTask[] | null; done: DashTask[]; reported: DashTask[] };
  /** Recent notices with your read state joined in. */
  notices: BoardNotice[];
  /** Staff you can assign a task to — populated only with `team`. */
  assignable: { id: string; name: string }[];
  /** `team`: can assign tasks / post notices / see the team's tasks. */
  canManage: boolean;
  /** Null when the account has no staff record — no tasks/acks are possible. */
  viewerStaffId: string | null;
  today: string;
};

const EMPTY: DashboardData = {
  chips: { self: [], team: [] },
  roster: null,
  money: [],
  tasks: { mine: [], team: null, done: [], reported: [] },
  notices: [],
  assignable: [],
  canManage: false,
  viewerStaffId: null,
  today: todayInAu(),
};

export async function loadDashboard(): Promise<DashboardData> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return EMPTY;

  const caps = await getCapabilities();
  const canManage = caps.has("team");
  const today = todayInAu();
  const viewerStaffId = await staffProfileIdFor(orgId, userId);

  /* Five of the queries below label rows with a person's name, and each used to
     read the whole staff table for itself. Read it once and hand the same map
     round — the names cannot disagree between sections either, which they could
     when five reads raced an edit. */
  const names = await loadStaffNames(orgId);

  const [chips, roster, money, tasks, notices, assignable] = await Promise.all([
    loadChips(orgId, viewerStaffId, caps, today),
    canManage ? loadRoster(orgId, today) : Promise.resolve(null),
    caps.has("financials") ? loadMoney(orgId, today) : Promise.resolve([]),
    loadTasks(orgId, viewerStaffId, canManage, names),
    listNotices(orgId, viewerStaffId, 20, names).then(sortNotices),
    // the assign picker only needs names, and only when you can assign
    canManage ? listFleetStaff(orgId).then((s) => s.map((x) => ({ id: x.id, name: x.name }))) : Promise.resolve([]),
  ]);

  return { chips, roster, money, tasks, notices, assignable, canManage, viewerStaffId, today };
}

/* The noticeboard page. Reading happens THERE, not on the dashboard: the
   dashboard only carries a summary card, so arriving here is a deliberate act —
   which is what makes marking everything read defensible. */
export type NoticeBoardData = {
  notices: BoardNotice[];
  canManage: boolean;
  /** false when the account has no staff record — no read can be attributed */
  canRead: boolean;
  /** Today in AU. Expiry is derived, so the board needs the same date the
      server used — never the browser's clock, which may be in another zone. */
  today: string;
  /** Who a comment can @mention, and what to paint. The SAME list the action
      resolves against, so the highlight and the recorded mention agree. */
  staff: MentionTarget[];
  /** Null when the account has no staff record — it can't be mentioned either. */
  viewerStaffId: string | null;
};

export async function loadNoticeBoard(): Promise<NoticeBoardData> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  const today = todayInAu();
  if (!orgId || !userId)
    return {
      notices: [],
      canManage: false,
      canRead: false,
      today,
      staff: [],
      viewerStaffId: null,
    };

  const caps = await getCapabilities();
  const viewerStaffId = await staffProfileIdFor(orgId, userId);
  const [notices, staff] = await Promise.all([
    listNotices(orgId, viewerStaffId, 100).then(sortNotices),
    mentionableStaff(orgId),
  ]);
  return {
    notices,
    canManage: caps.has("team"),
    canRead: viewerStaffId !== null,
    today,
    staff,
    viewerStaffId,
  };
}

/* The action-required page. Like the noticeboard, the dashboard carries only a
   summary (the hero tile) and the full list lives on its own screen — a count
   you click into is honest about being a count, where a truncated list on the
   dashboard would pretend to be the whole picture. */
export async function loadActionRequired(): Promise<DashboardChips> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return { self: [], team: [] };

  const caps = await getCapabilities();
  const viewerStaffId = await staffProfileIdFor(orgId, userId);
  return loadChips(orgId, viewerStaffId, caps, todayInAu());
}

async function loadTasks(
  orgId: string,
  viewerStaffId: string | null,
  canManage: boolean,
  names: StaffNames,
): Promise<{ mine: DashTask[]; team: DashTask[] | null; done: DashTask[]; reported: DashTask[] }> {
  const [mine, team, done, reported] = await Promise.all([
    viewerStaffId ? myTasks(orgId, viewerStaffId, names).then(sortTasks) : Promise.resolve([]),
    canManage ? teamTasks(orgId, names).then(sortTasks) : Promise.resolve(null),
    viewerStaffId
      ? recentlyDoneTasks(orgId, viewerStaffId, RECENT_DONE_DAYS, new Date(), names)
      : Promise.resolve([] as DashTask[]),
    // work you handed out that has come back done — the assigner's report
    viewerStaffId
      ? assignedByMeRecentlyDone(orgId, viewerStaffId, RECENT_DONE_DAYS, new Date(), names)
      : Promise.resolve([] as DashTask[]),
  ]);
  return { mine, team, done, reported };
}

/* ---------------- chips ---------------- */

async function loadChips(
  orgId: string,
  viewerStaffId: string | null,
  caps: ReadonlySet<Capability>,
  today: string,
): Promise<DashboardChips> {
  const [selfList, selfVehicle, ownSheet, ownDeclined] = await Promise.all([
    viewerStaffId ? listStaffCompliance(orgId, viewerStaffId) : Promise.resolve([]),
    viewerStaffId ? getOwnVehicle(orgId, viewerStaffId) : Promise.resolve(null),
    viewerStaffId ? loadOwnSheet(orgId, viewerStaffId) : Promise.resolve(null),
    viewerStaffId
      ? ownDeclinedClaims(orgId, viewerStaffId, addDays(today, -CLAIM_NUDGE_DAYS))
      : Promise.resolve([]),
  ]);

  // Team data is only READ when the capability is held — it never reaches here
  // otherwise, so the scoping is enforced at the query, not just in assembly.
  const [teamPeople, org, fleet, pendingClaims] = await Promise.all([
    caps.has("team") ? listStaffCompliance(orgId) : Promise.resolve([] as StaffCompliance[]),
    caps.has("team") ? orgInsurance(orgId) : Promise.resolve({ insurer: null, insuranceExpiry: null }),
    caps.has("assets_all") ? listVehicles(orgId).then((r) => r.vehicles) : Promise.resolve([] as Vehicle[]),
    // a head count, not the full claims read — the chip needs one integer
    caps.has("approvals") ? pendingClaimsCount(orgId) : Promise.resolve(0),
  ]);

  return assembleChips(
    {
      today,
      viewerStaffId,
      self: selfList[0] ?? null,
      selfVehicle,
      teamPeople,
      fleet,
      org,
      pendingClaims,
      ownSheet,
      ownDeclinedClaims: ownDeclined,
    },
    caps,
  );
}

/* Any sheet of yours sitting in `sent_back`, named the way the timesheet's own
   period switcher names it — the chip's subject has to match the heading you
   land on, or the click feels like it went somewhere else. Settings are read
   only once there is something to name. */
async function loadOwnSheet(
  orgId: string,
  staffProfileId: string,
): Promise<{ status: string; periodStart: string; periodLabel: string } | null> {
  const start = await ownSentBackPeriod(orgId, staffProfileId);
  if (!start) return null;
  const { settings } = await getPaySettings(orgId);
  return { status: "sent_back", periodStart: start, periodLabel: periodLabel(start, settings) };
}

/* ---------------- roster today ---------------- */

async function loadRoster(orgId: string, today: string): Promise<RosterToday> {
  const state = await stateFor(orgId, ""); // "" → the org's home state
  const [approved, holidays] = await Promise.all([
    approvedInSpan(orgId, today, today),
    holidaysInSpan(orgId, state, today, today),
  ]);
  return rosterToday(approved, holidays, today);
}

/* ---------------- money (pay run) ---------------- */

async function loadMoney(orgId: string, today: string): Promise<MoneyItem[]> {
  const { settings } = await getPaySettings(orgId);
  // The current period — informational while open, "due" once it closes. A
  // just-closed run isn't surfaced separately until pay-run records exist.
  const start = periodStartFor(today, settings);
  const sheets = await sheetStates(orgId, start);
  const { submitted, approved } = tallySheets([...sheets.values()].map((s) => s.status));
  const item = payRunItem({
    periodLabel: periodLabel(start, settings),
    periodEnd: periodEnd(start, settings),
    today,
    submitted,
    approved,
  });
  return item ? [item] : [];
}
