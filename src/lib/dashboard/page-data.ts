import { auth0 } from "@/lib/auth0";
import { getCapabilities, getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { todayInAu } from "@/lib/au-dates";
import { getOwnVehicle, listFleetStaff, listVehicles, staffProfileIdFor } from "@/lib/fleet/query";
import type { Vehicle } from "@/components/fleet/logic";
import type { Capability } from "@/lib/permissions";
import { getPaySettings, ownSentBackPeriod } from "@/lib/timepay/query";
import { addDays, periodLabel } from "@/lib/timepay/period";
import { approvedInSpan, holidaysInSpan, stateFor } from "@/lib/timepay/leave-query";
import { assembleChips, type DashboardChips } from "./assemble";
import { CLAIM_NUDGE_DAYS } from "./chips";
import { listStaffCompliance, type StaffCompliance } from "./query";
import { ownDetailsGap } from "@/lib/staff/onboarding";
import { isLibraryApproved, pendingSignons, raisedIssues } from "@/lib/swms/query";
import { ownDeclinedClaims, pendingClaimsCount } from "@/lib/expenses/query";
import { ownDeclinedLeave, pendingLeaveCount } from "@/lib/timepay/leave-query";
import { buildCalendar, calendarSpan, type LeaveCalendar } from "./calendar";
import { listJournal } from "./journal-query";
import { jobCandidates } from "./job-candidates";
import { listOpenIssues } from "./issues-query";
import type { HomeIssue } from "./issues";
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
import { sm8VendorOf } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { EMPTY_SCHEDULE, loadScheduleDay } from "@/lib/workboard/schedule-query";
import { layoutScheduleDay, type ScheduleBlock } from "@/lib/workboard/schedule";
import {
  jobsOnRail,
  nowMinInZone,
  railCrewOf,
  railTasksOf,
  railWhereOf,
  type RailTask,
} from "./day-rail";
import { deskOn } from "./desk-flag";
import { loadDesk, readHomeShared, type DeskData, type HomeShared } from "./desk-data";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { sm8QueueStuck } from "@/lib/integrations/sm8-writes";
import { freshenSm8AfterResponse } from "@/lib/integrations/sm8-freshness";

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
  /** Every open issue in the workspace — the "this keeps happening" rows the
      note router writes. Gated on `workboard` like the jobs: the row was made
      under that gate and names a job. Empty without it. */
  issues: HomeIssue[];
  /** `team`: can assign tasks / post notices / see the team's tasks. */
  canManage: boolean;
  /** Null when the account has no staff record — no tasks/acks are possible. */
  viewerStaffId: string | null;
  today: string;
  /** The day beside the diary: today's bookings and the tasks that named an
      hour. See ./day-rail for what earns a place on it. */
  rail: HomeRail;
  /** The new Home's own data, or null for a viewer still on today's Home
      (`HOME_DESK`, ./desk-flag). Nothing reads it for them. */
  desk: DeskData | null;
};

export type HomeRail = {
  /** The day the rail draws. NOT `today`: that one is anchored to Sydney for
      timesheets and leave, while every ServiceM8 stamp is written in the
      connected account's own zone — a Brisbane workspace reads an hour
      different for part of the year, and the bookings must be the ones the
      dispatcher sees. */
  dayISO: string;
  tz: string | null;
  /** The viewer's OWN bookings on the day, chronological.

      It was crew-wide, because nothing linked a HeyTiff account to a
      ServiceM8 person and "just mine" would have shown everyone an empty
      rail. Isaac asked for his own day (2026-08-31), and the honest way to
      give it is to narrow when we know who he is and SAY SO when we don't —
      never to quietly widen back to everyone, which would make the rail mean
      two different things depending on a row in a table nobody can see.

      Empty here therefore means "nothing booked for you", and only that. See
      `linked` for the other case. */
  blocks: ScheduleBlock[];
  /** Does `integration_links` say which ServiceM8 person the viewer is?

      False is the ordinary answer on a workspace where nobody has linked
      themselves yet, and it is NOT the same as an empty day: the rail cannot
      narrow at all, so it says that instead of drawing nothing and letting
      the reader conclude they are free. */
  linked: boolean;
  /** Where to go and fix that, or null for a viewer who may not. */
  linkHref: string | null;
  /** The viewer's own tasks that named an hour on this day. */
  tasks: RailTask[];
  /** Minutes past midnight when the page was built, in `tz`. The live marker
      is the browser's (see use-now-min); this one dates the rows. */
  nowMin: number | null;
  /** False without `workboard`. The rail says so rather than drawing a day
      that only looks empty. */
  enabled: boolean;
  /** The mirror rows behind the bookings drawn — what a pill opens the job
      card on, the same row shape the board's sheet opens on. Only the jobs
      on this band; the day's other jobs are other people's. */
  jobs: AllJobsMirrorJob[];
  /** Does anyone on this account record time on site today — the board's
      own `tracksTime`, read off the WHOLE day before it is narrowed to the
      viewer's lane. The hollow/late reading means nothing on a crew that
      never clocks on, and it is the crew's habit that decides, not whether
      the viewer clocked on themselves. */
  tracksTime: boolean;
  /** `workboard_manage` — the card's promotion menu and its checklist
      writes, exactly as the board decides them. */
  manage: boolean;
  /** `workboard_money` — whether the card may show a Money face at all. */
  moneyVisible: boolean;
  /** Does this workspace hold a ServiceM8 copy at all (`sm8VendorOf`)?
      Without one there are no bookings for the day to be missing, so the
      day says nothing about ServiceM8 — see `railMissing`. */
  connected: boolean;
  /** job uuid → its street line, for the jobs on this day only. */
  where: Record<string, string>;
  /** job uuid → everyone else booked on it today, by first name; a job
      nobody else is on has no entry. This day's jobs only. */
  crew: Record<string, string[]>;
};

const EMPTY_RAIL: HomeRail = {
  dayISO: "",
  tz: null,
  blocks: [],
  linked: false,
  linkHref: null,
  tasks: [],
  nowMin: null,
  enabled: false,
  jobs: [],
  tracksTime: false,
  manage: false,
  moneyVisible: false,
  connected: false,
  where: {},
  crew: {},
};

const EMPTY: DashboardData = {
  chips: { self: [], team: [] },
  calendar: { spanStart: "", spanEnd: "", days: [] },
  tasks: { mine: [], team: null, done: [], reported: [] },
  notices: [],
  journal: [],
  assignable: [],
  jobs: [],
  issues: [],
  canManage: false,
  viewerStaffId: null,
  today: todayInAu(),
  rail: EMPTY_RAIL,
  desk: null,
};

export async function loadDashboard(): Promise<DashboardData> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return EMPTY;

  /* Opening Home tops ServiceM8 up behind the response: what is waiting to
     go is sent, and a stale mirror synced. Not awaited, and it reads nothing
     before the response — every check runs in after(). */
  freshenSm8AfterResponse(orgId);

  const caps = await getCapabilities();
  const canManage = caps.has("team");
  /* Two screens on this page's chips admit the OWNER only — the Organisation
     screen and the ServiceM8 people screen — so the owner question is asked
     once here and travelled, rather than each chip guessing from a
     capability that does not gate the page it points at. */
  const role = await getDbRole();
  const isOwner = hasMinRole(role, "owner");
  /* The new Home is built behind HOME_DESK and shown to whoever the flag
     names; everyone else gets today's Home and none of its reads. */
  const desk = deskOn(role);
  const today = todayInAu();
  const viewerStaffId = await staffProfileIdFor(orgId, userId);

  /* WHICH OF THE CREW THE VIEWER IS. One cheap read on the table that is the
     app's law for it — never a name match, which is exactly the guessing
     `integration_links` exists to end (see lib/integrations/links and the
     one-truth-per-staff-member rule).

     Started now and awaited by nothing up front: it is two reads one after
     the other (the connection, then its links), and the wait below is one,
     so holding the whole page for it would start every read in the batch a
     round trip late. It is needed only after the batch, for the rail, and by
     the new Home's loader, which waits for it on its own. Caught at once so
     a failure while the first wait is still out is no unhandled rejection;
     the batch below still awaits the promise itself, so it fails the page as
     it always did. */
  const linksP =
    caps.has("workboard") && viewerStaffId
      ? sm8StaffLinkMap(orgId)
      : Promise.resolve(new Map<string, string>());
  linksP.catch(() => {});
  /* The map is remote-uuid → staff card, so finding the viewer is a scan of
     something with one row per linked person: small by construction, and the
     alternative is a second query for a fact already in hand. */
  const mineOf = (links: Map<string, string>): string | null =>
    [...links.entries()].find(([, staffId]) => staffId === viewerStaffId)?.[0] ?? null;

  /* Five of the queries below label rows with a person's name, and each used to
     read the whole staff table for itself. Read it once and hand the same map
     round — the names cannot disagree between sections either, which they could
     when five reads raced an edit. */
  /* The zone comes from the connected ServiceM8 account, and the rail's day
     with it. Read alongside the names rather than after them: neither depends
     on the other, and this one gates a query in the batch below.

     And the expiry window and the org's credentials, which the chips have
     always read for themselves: read once here and shared, so the new Home's
     areas never read them a second time (./desk-data). They are one round
     trip, as the names are, so this wait takes no longer for them. */
  const [names, vendor, shared] = await Promise.all([
    loadStaffNames(orgId),
    sm8VendorOf(orgId),
    readHomeShared(orgId, isOwner),
  ]);
  const railTz = vendor.tz;
  const railDay = todayInZone(railTz);
  const railNowMin = nowMinInZone(railTz);

  const [chips, calendar, tasks, notices, assignable, journal, jobs, issues, schedule, sm8Links, deskData] = await Promise.all([
    loadChips(orgId, viewerStaffId, caps, today, isOwner, shared),
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
    /* The open issues, with their targets named — same gate, same reason. */
    caps.has("workboard") ? listOpenIssues(orgId) : Promise.resolve([] as HomeIssue[]),
    /* The day rail. Same gate as the board it mirrors — a viewer without
       `workboard` may not see the crew's bookings, on Home or anywhere. */
    caps.has("workboard") ? loadScheduleDay(orgId, railDay) : Promise.resolve(EMPTY_SCHEDULE),
    linksP,
    /* The new Home's reads, in this same wait — and only for its viewers.
       It waits for the link map itself, so nobody else does. */
    desk
      ? linksP.then((links) =>
          loadDesk({
            orgId,
            viewerStaffId,
            caps,
            isOwner,
            today,
            railDay,
            tz: railTz,
            mineUuid: mineOf(links),
            names,
            shared,
          })
        )
      : Promise.resolve(null),
  ]);
  const mineUuid = mineOf(sm8Links);

  /* The board's own layout, then flattened: it knows what a block IS — the
     closure rule, the on-site join, the midnight clamp — and Home differs
     only in wanting one chronological column instead of a lane per person.
     `tracked` is not passed: the project/maintenance labels come from board
     payloads Home doesn't load, so a category name is the honest fallback. */
  const day = caps.has("workboard")
    ? layoutScheduleDay({
        activities: schedule.activities,
        staff: schedule.staff,
        jobs: schedule.jobs,
        onSite: new Set(schedule.onSite),
      })
    : null;
  /* NARROWED TO ONE LANE — the viewer's. A lane already IS a person's day,
     so "just mine" is a filter on the board's own answer rather than a
     second way of deciding who owns a booking.

     An unknown viewer keeps NOTHING, deliberately. Falling back to the whole
     crew would make the rail mean "my day" or "everyone's day" depending on
     a table row the reader cannot see, and the two look identical. `linked`
     says which case this is instead. */
  const railBlocks: ScheduleBlock[] = day
    ? day.lanes
        .filter((lane) => mineUuid !== null && lane.staffUuid === mineUuid)
        .flatMap((lane) => lane.blocks)
        .sort((a, b) => a.startMin - b.startMin || a.key.localeCompare(b.key))
    : [];

  return {
    chips, calendar, tasks, notices, assignable, journal, jobs, issues, canManage, viewerStaffId, today,
    rail: {
      dayISO: railDay,
      tz: railTz,
      blocks: railBlocks,
      linked: mineUuid !== null,
      /* The door only opens for someone who can walk through it. The
         ServiceM8 people screen admits the OWNER — not `team`, which is what
         this read and which every admin holds, so an admin was offered "Link
         yourself to the crew" and bounced back to Home by the page. The band
         tells everyone else who can do it instead. */
      linkHref: isOwner ? "/dashboard/admin/integrations/servicem8" : null,
      tasks: railTasksOf(tasks.mine, railDay, railTz, railNowMin),
      nowMin: railNowMin,
      enabled: caps.has("workboard"),
      jobs: jobsOnRail(railBlocks, schedule.jobs),
      /* THE WHOLE DAY'S ANSWER, not the viewer's lane: whether this account
         clocks on is a fact about the crew, and asking it of one person's
         bookings said "no" for anyone who had not clocked on themselves —
         so their pills never went hollow or late (walked 2026-09-15). */
      tracksTime: day?.tracksTime ?? false,
      manage: caps.has("workboard_manage"),
      moneyVisible: caps.has("workboard_money"),
      connected: vendor.connected,
      /* Both cut to the viewer's own jobs, as `jobs` is: the day's payload
         knows every booking on it, and the rest are other people's. */
      where: railWhereOf(railBlocks, schedule.addresses),
      crew: day ? railCrewOf(day.lanes, railBlocks, mineUuid) : {},
    },
    desk: deskData,
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
  return loadChips(orgId, viewerStaffId, caps, todayInAu(), hasMinRole(await getDbRole(), "owner"));
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
  /** the Organisation screen admits the owner only — see `assembleChips` */
  isOwner: boolean,
  /** The expiry window and the org's credentials, when Home has already read
      them for the whole page; read here when not (the action-required page). */
  shared?: HomeShared,
): Promise<DashboardChips> {
  const [selfList, selfVehicle, ownSheet, ownDeclined, ownDeclinedLv, detailsGap, swmsSignons, swmsIssues, swmsTemplatePending, sm8Stuck] = await Promise.all([
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
    // your own card's required gaps — the reminder after a skipped first run
    viewerStaffId ? ownDetailsGap(orgId, viewerStaffId) : Promise.resolve(null),
    // a SWMS that names you and waits for your sign-on; a read that fails
    // raises no chip rather than taking the bell down with it
    viewerStaffId ? pendingSignons(orgId, viewerStaffId).catch(() => []) : Promise.resolve([]),
    // what a worker raised at sign-on, for whoever is in charge of that SWMS
    viewerStaffId ? raisedIssues(orgId, viewerStaffId).catch(() => []) : Promise.resolve([]),
    // the SWMS template, for the one person who can approve it; a read that
    // fails says nothing is pending rather than nagging on a guess
    isOwner ? isLibraryApproved(orgId).then((approved) => !approved).catch(() => false) : Promise.resolve(false),
    // files stuck on their way to ServiceM8, for the one person who can
    // unstick them; a read that fails raises no chip
    isOwner ? sm8QueueStuck(orgId).catch(() => null) : Promise.resolve(null),
  ]);

  // Team data is only READ when the capability is held — it never reaches here
  // otherwise, so the scoping is enforced at the query, not just in assembly.
  const [teamPeople, { orgCredentials, expiry }, fleet, pendingClaims, pendingLeave] = await Promise.all([
    caps.has("team") ? listStaffCompliance(orgId) : Promise.resolve([] as StaffCompliance[]),
    /* every org card, not the soonest policy — the bell shows each one inside
       the window — and ONE NUMBER for every chip below (lib/expiry.ts) */
    shared ? Promise.resolve(shared) : readHomeShared(orgId, isOwner),
    caps.has("assets_all") ? listVehicles(orgId).then((r) => r.vehicles) : Promise.resolve([] as Vehicle[]),
    // a head count, not the full claims read — the chip needs one integer
    caps.has("approvals") ? pendingClaimsCount(orgId) : Promise.resolve(0),
    // the other queue that belongs to whoever can decide it
    caps.has("approvals") ? pendingLeaveCount(orgId) : Promise.resolve(0),
  ]);

  return assembleChips(
    {
      isOwner,
      today,
      warnDays: expiry.warnDays,
      viewerStaffId,
      self: selfList[0] ?? null,
      selfVehicle,
      teamPeople,
      fleet,
      orgCredentials,
      pendingClaims,
      pendingLeave,
      ownSheet,
      ownDeclinedClaims: ownDeclined,
      ownDeclinedLeave: ownDeclinedLv,
      selfCompleteness: detailsGap,
      selfName: detailsGap?.name || null,
      ownSwmsSignons: swmsSignons,
      ownSwmsIssues: swmsIssues,
      swmsTemplatePending,
      sm8Stuck,
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

