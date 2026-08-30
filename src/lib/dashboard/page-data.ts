import { auth0 } from "@/lib/auth0";
import { getCapabilities } from "@/lib/permissions-server";
import { todayInAu } from "@/lib/au-dates";
import { getOwnVehicle, listFleetStaff, listVehicles, staffProfileIdFor } from "@/lib/fleet/query";
import type { Vehicle } from "@/components/fleet/logic";
import type { Capability } from "@/lib/permissions";
import { getPaySettings, ownSentBackPeriod } from "@/lib/timepay/query";
import { addDays, periodLabel } from "@/lib/timepay/period";
import { approvedInSpan, holidaysInSpan, stateFor } from "@/lib/timepay/leave-query";
import { assembleChips, type DashboardChips } from "./assemble";
import { CLAIM_NUDGE_DAYS } from "./chips";
import { listStaffCompliance, orgInsurance, type StaffCompliance } from "./query";
import { ownDeclinedClaims, pendingClaimsCount } from "@/lib/expenses/query";
import { ownDeclinedLeave, pendingLeaveCount } from "@/lib/timepay/leave-query";
import { buildCalendar, calendarSpan, type LeaveCalendar } from "./calendar";
import { listJournal } from "./journal-query";
import { jobCandidates } from "./job-candidates";
import type { JobCandidate } from "@/lib/workboard/note-match";
import type { JournalEntry } from "./journal";
import {
  myTasks,
  teamTasks,
  recentlyDoneTasks,
  assignedByMeRecentlyDone,
  listNotices,
  NOTICE_WINDOW,
  loadStaffNames,
  mentionableStaff,
  type StaffNames,
} from "./tasks-query";
import type { MentionTarget } from "./comments";
import type { BoardNotice } from "./board";
import { RECENT_DONE_DAYS, sortNotices, sortTasks, type DashTask } from "./tasks";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { EMPTY_SCHEDULE, loadScheduleDay } from "@/lib/workboard/schedule-query";
import { layoutScheduleDay, type ScheduleBlock } from "@/lib/workboard/schedule";
import { nowMinInZone, railTasksOf, type RailTask } from "./day-rail";
import { phaseOf, type DayPhase } from "./debrief-voice";

/* Dashboard page loader. The capability scoping and every derivation are pure
   and live in ./assemble and ./calendar; this file is the thin I/O layer
   that resolves the session once, reads only the data the viewer may see, and
   hands it over.

   The two sections mirror the spec:
     chips    — action-required expiries. self is intrinsic; team/fleet gated.
     calendar — your leave and the office closures (everyone), plus who else is
                off (`team` only). It replaced `roster`, which answered the same
                question for today alone.

   MONEY IS NOT HERE ANY MORE. Home carried a pay-run strip under the card
   until the desk rebuild took it off (Isaac, 2026-08-30) — the day, the
   record and the work you owe are what this screen is for, and a pay-run
   status is none of them. The read outlived the strip by a round; a gated
   query nothing renders is the kind of thing that rots quietly, so it went
   with `lib/dashboard/money.ts`. Payroll lives on the pay screens. */

export type DashboardData = {
  chips: DashboardChips;
  /** Your leave and the org's closures — for everyone. Colleagues' leave is
      in it only with `team`. */
  calendar: LeaveCalendar;
  /** Your open tasks (always), the team's (only with `team`), and your
      recently-completed ones so finishing something leaves a trace. */
  tasks: { mine: DashTask[]; team: DashTask[] | null; done: DashTask[]; reported: DashTask[] };
  /** Recent notices with your read state joined in. */
  notices: BoardNotice[];
  /** Everything you've told Tiff, newest first — the Journal tab's record.
      Empty for an account with no staff profile, which has no captures. */
  journal: JournalEntry[];
  /** Staff you can assign a task to — populated only with `team`. */
  assignable: { id: string; name: string }[];
  /** Open work a captured note can be pinned to. Home is not the board, so
      these do not arrive from a board payload — see ./job-candidates. Gated
      on `workboard`: the picker offers jobs, and a viewer without the board
      may not see them. */
  jobs: JobCandidate[];
  /** `team`: can assign tasks / post notices / see the team's tasks. */
  canManage: boolean;
  /** Null when the account has no staff record — no tasks/acks are possible. */
  viewerStaffId: string | null;
  today: string;
  /** The day beside the diary: today's bookings and the tasks that named an
      hour. See ./day-rail for what earns a place on it. */
  rail: HomeRail;
  /** Which of the day's three questions the Debrief tab is asking. Resolved
      here, in the workspace's zone, so no component reads a clock. */
  phase: DayPhase;
};

export type HomeRail = {
  /** The day the rail draws. NOT `today`: that one is anchored to Sydney for
      timesheets and leave, while every ServiceM8 stamp is written in the
      connected account's own zone — a Brisbane workspace reads an hour
      different for part of the year, and the bookings must be the ones the
      dispatcher sees. */
  dayISO: string;
  tz: string | null;
  /** Every booking on the day, chronological. Crew-wide: ServiceM8 staff are
      not linked to HeyTiff accounts on the live workspace (integration_links
      holds no staff rows), so "just mine" would show everyone an empty rail.
      When those links exist this becomes a filter, not a rewrite. */
  blocks: ScheduleBlock[];
  /** The viewer's own tasks that named an hour on this day. */
  tasks: RailTask[];
  /** Minutes past midnight when the page was built, in `tz`. The live marker
      is the browser's (see use-now-min); this one dates the rows. */
  nowMin: number | null;
  /** False without `workboard`. The rail says so rather than drawing a day
      that only looks empty. */
  enabled: boolean;
};

const EMPTY_RAIL: HomeRail = {
  dayISO: "",
  tz: null,
  blocks: [],
  tasks: [],
  nowMin: null,
  enabled: false,
};

const EMPTY: DashboardData = {
  chips: { self: [], team: [] },
  calendar: { spanStart: "", spanEnd: "", days: [] },
  tasks: { mine: [], team: null, done: [], reported: [] },
  notices: [],
  journal: [],
  assignable: [],
  jobs: [],
  canManage: false,
  viewerStaffId: null,
  today: todayInAu(),
  rail: EMPTY_RAIL,
  phase: "morning",
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
  /* The zone comes from the connected ServiceM8 account, and the rail's day
     with it. Read alongside the names rather than after them: neither depends
     on the other, and this one gates a query in the batch below. */
  const [names, railTz] = await Promise.all([loadStaffNames(orgId), getSm8Timezone(orgId)]);
  const railDay = todayInZone(railTz);
  const railNowMin = nowMinInZone(railTz);

  const [chips, calendar, tasks, notices, assignable, journal, jobs, schedule] = await Promise.all([
    loadChips(orgId, viewerStaffId, caps, today),
    loadCalendar(orgId, today, viewerStaffId, canManage),
    loadTasks(orgId, viewerStaffId, canManage, names),
    listNotices(orgId, viewerStaffId, NOTICE_WINDOW, names).then(sortNotices),
    // the assign picker only needs names, and only when you can assign
    canManage ? listFleetStaff(orgId).then((s) => s.map((x) => ({ id: x.id, name: x.name }))) : Promise.resolve([]),
    /* An account with no staff record has never captured anything — there is
       no author_id it could have been filed under, so don't go and ask. */
    viewerStaffId ? listJournal(orgId, viewerStaffId) : Promise.resolve([]),
    /* Rides the same Promise.all rather than adding a wait. Absent without
       `workboard` — the same capability the board itself is behind. */
    caps.has("workboard") ? jobCandidates(orgId) : Promise.resolve([] as JobCandidate[]),
    /* The day rail. Same gate as the board it mirrors — a viewer without
       `workboard` may not see the crew's bookings, on Home or anywhere. */
    caps.has("workboard") ? loadScheduleDay(orgId, railDay) : Promise.resolve(EMPTY_SCHEDULE),
  ]);

  /* The board's own layout, then flattened: it knows what a block IS — the
     closure rule, the on-site join, the midnight clamp — and Home differs
     only in wanting one chronological column instead of a lane per person.
     `tracked` is not passed: the project/maintenance labels come from board
     payloads Home doesn't load, so a category name is the honest fallback. */
  const railBlocks: ScheduleBlock[] = caps.has("workboard")
    ? layoutScheduleDay({
        activities: schedule.activities,
        staff: schedule.staff,
        jobs: schedule.jobs,
        onSite: new Set(schedule.onSite),
      })
        .lanes.flatMap((lane) => lane.blocks)
        .sort((a, b) => a.startMin - b.startMin || a.key.localeCompare(b.key))
    : [];

  return {
    chips, calendar, tasks, notices, assignable, journal, jobs, canManage, viewerStaffId, today,
    rail: {
      dayISO: railDay,
      tz: railTz,
      blocks: railBlocks,
      tasks: railTasksOf(tasks.mine, railDay, railTz, railNowMin),
      nowMin: railNowMin,
      enabled: caps.has("workboard"),
    },
    phase: phaseOf(railNowMin),
  };
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
    listNotices(orgId, viewerStaffId, NOTICE_WINDOW).then(sortNotices),
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
  const [selfList, selfVehicle, ownSheet, ownDeclined, ownDeclinedLv] = await Promise.all([
    viewerStaffId ? listStaffCompliance(orgId, viewerStaffId) : Promise.resolve([]),
    viewerStaffId ? getOwnVehicle(orgId, viewerStaffId) : Promise.resolve(null),
    viewerStaffId ? loadOwnSheet(orgId, viewerStaffId) : Promise.resolve(null),
    viewerStaffId
      ? ownDeclinedClaims(orgId, viewerStaffId, addDays(today, -CLAIM_NUDGE_DAYS))
      : Promise.resolve([]),
    // the same window, because it is the same kind of news — see chips.ts
    viewerStaffId
      ? ownDeclinedLeave(orgId, viewerStaffId, addDays(today, -CLAIM_NUDGE_DAYS))
      : Promise.resolve([]),
  ]);

  // Team data is only READ when the capability is held — it never reaches here
  // otherwise, so the scoping is enforced at the query, not just in assembly.
  const [teamPeople, org, fleet, pendingClaims, pendingLeave] = await Promise.all([
    caps.has("team") ? listStaffCompliance(orgId) : Promise.resolve([] as StaffCompliance[]),
    caps.has("team") ? orgInsurance(orgId) : Promise.resolve({ insurer: null, insuranceExpiry: null }),
    caps.has("assets_all") ? listVehicles(orgId).then((r) => r.vehicles) : Promise.resolve([] as Vehicle[]),
    // a head count, not the full claims read — the chip needs one integer
    caps.has("approvals") ? pendingClaimsCount(orgId) : Promise.resolve(0),
    // the other queue that belongs to whoever can decide it
    caps.has("approvals") ? pendingLeaveCount(orgId) : Promise.resolve(0),
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
      pendingLeave,
      ownSheet,
      ownDeclinedClaims: ownDeclined,
      ownDeclinedLeave: ownDeclinedLv,
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

/* ---------------- the calendar ---------------- */

/* THE SAME TWO QUERIES THE ROSTER RAN. It passed `today, today` to both and got
   one day back; the span it always accepted is what makes four weeks free.

   Not gated. Your own leave and the days the business closes are yours whatever
   your role — it was the `team` gate on the old roster that left the office
   closure announced to managers only. What `team` buys is everyone ELSE's
   leave, and that is cut here rather than in the view: without it, a colleague's
   row never reaches the browser. */
async function loadCalendar(
  orgId: string,
  today: string,
  viewerStaffId: string | null,
  canManage: boolean,
): Promise<LeaveCalendar> {
  const { spanStart, spanEnd } = calendarSpan(today);
  const state = await stateFor(orgId, ""); // "" → the org's home state
  const [approved, holidays] = await Promise.all([
    approvedInSpan(orgId, spanStart, spanEnd),
    holidaysInSpan(orgId, state, spanStart, spanEnd),
  ]);
  const visible = canManage
    ? approved
    : approved.filter((r) => viewerStaffId !== null && r.staffId === viewerStaffId);
  return buildCalendar(visible, holidays, today, viewerStaffId);
}

