import { auth0 } from "@/lib/auth0";
import { getCapabilities } from "@/lib/permissions-server";
import { todayInAu } from "@/lib/au-dates";
import { getOwnVehicle, listFleetStaff, listVehicles, staffProfileIdFor } from "@/lib/fleet/query";
import type { Vehicle } from "@/components/fleet/logic";
import type { Capability } from "@/lib/permissions";
import { getPaySettings, sheetStates } from "@/lib/timepay/query";
import { periodEnd, periodLabel, periodStartFor } from "@/lib/timepay/period";
import { approvedInSpan, holidaysInSpan, stateFor } from "@/lib/timepay/leave-query";
import { assembleChips, type DashboardChips } from "./assemble";
import { listStaffCompliance, orgInsurance, type StaffCompliance } from "./query";
import { rosterToday, type RosterToday } from "./roster";
import { payRunItem, tallySheets, type MoneyItem } from "./money";
import { myTasks, teamTasks, listNotices } from "./tasks-query";
import { sortNotices, sortTasks, type DashTask, type NoticeWithRead } from "./tasks";

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
  /** Your open tasks (always) and the team's (only with `team`). */
  tasks: { mine: DashTask[]; team: DashTask[] | null };
  /** Recent notices with your read state joined in. */
  notices: NoticeWithRead[];
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
  tasks: { mine: [], team: null },
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

  const [chips, roster, money, tasks, notices, assignable] = await Promise.all([
    loadChips(orgId, viewerStaffId, caps, today),
    canManage ? loadRoster(orgId, today) : Promise.resolve(null),
    caps.has("financials") ? loadMoney(orgId, today) : Promise.resolve([]),
    loadTasks(orgId, viewerStaffId, canManage),
    listNotices(orgId, viewerStaffId).then(sortNotices),
    // the assign picker only needs names, and only when you can assign
    canManage ? listFleetStaff(orgId).then((s) => s.map((x) => ({ id: x.id, name: x.name }))) : Promise.resolve([]),
  ]);

  return { chips, roster, money, tasks, notices, assignable, canManage, viewerStaffId, today };
}

async function loadTasks(
  orgId: string,
  viewerStaffId: string | null,
  canManage: boolean,
): Promise<{ mine: DashTask[]; team: DashTask[] | null }> {
  const [mine, team] = await Promise.all([
    viewerStaffId ? myTasks(orgId, viewerStaffId).then(sortTasks) : Promise.resolve([]),
    canManage ? teamTasks(orgId).then(sortTasks) : Promise.resolve(null),
  ]);
  return { mine, team };
}

/* ---------------- chips ---------------- */

async function loadChips(
  orgId: string,
  viewerStaffId: string | null,
  caps: ReadonlySet<Capability>,
  today: string,
): Promise<DashboardChips> {
  const [selfList, selfVehicle] = await Promise.all([
    viewerStaffId ? listStaffCompliance(orgId, viewerStaffId) : Promise.resolve([]),
    viewerStaffId ? getOwnVehicle(orgId, viewerStaffId) : Promise.resolve(null),
  ]);

  // Team data is only READ when the capability is held — it never reaches here
  // otherwise, so the scoping is enforced at the query, not just in assembly.
  const [teamPeople, org, fleet] = await Promise.all([
    caps.has("team") ? listStaffCompliance(orgId) : Promise.resolve([] as StaffCompliance[]),
    caps.has("team") ? orgInsurance(orgId) : Promise.resolve({ insurer: null, insuranceExpiry: null }),
    caps.has("assets_all") ? listVehicles(orgId).then((r) => r.vehicles) : Promise.resolve([] as Vehicle[]),
  ]);

  return assembleChips(
    { today, viewerStaffId, self: selfList[0] ?? null, selfVehicle, teamPeople, fleet, org },
    caps,
  );
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
