/* The Schedule page's read (v2, step 5): the days on the board, from the
   same day read the Workboard's Schedule tab makes (loadScheduleDay, with
   our own bookings laid over the mirror and each day's time off). The jobs
   the Jobs panel offers are read on their own (`schedulePanelJobs`). NO SESSION
   CHECK of its own beyond the org: the page gates on `workboard` first. */

import { auth0 } from "@/lib/auth0";
import { can, getDbRole } from "@/lib/permissions-server";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { loadScheduleDay, readAvailabilitySpan, type SchedulePayload } from "@/lib/workboard/schedule-query";
import { availabilityOnDay } from "@/lib/workboard/away";
import { calendarEventsInSpan, noticeEventsInSpan } from "@/lib/calendar/query";
import { teamDay, type TeamDay } from "./month-team";
import { loadCapacityWindow } from "@/lib/workboard/capacity-query";
import { CAPACITY_WINDOW_DAYS, capacityWindow, daysFrom, type CapacityDay } from "@/lib/workboard/capacity";
import { loadJobsList } from "@/lib/workboard/jobs-list-query";
import { sm8BookingsAllowed } from "@/lib/integrations/sm8-kinds";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend } from "@/lib/integrations/sm8-write-plan";
import { BOOKINGS_OPEN_TO_MANAGERS } from "@/lib/integrations/sm8-booking-plan";
import type { Hue, Tone } from "@/components/parts/state";
import { awayOnDay, withRegular } from "@/lib/team/regular-days-off";
import { readRegularDaysOff, sm8StaffByProfile } from "@/lib/team/regular-days-off-query";
import { daysFor, isDay, isWeekend, stepDay, type ScheduleView } from "./board";

/** A job the panel offers: a ServiceM8 job, which is what Book in books. */
export type PanelJob = {
  uuid: string;
  number: string | null;
  client: string;
  site: string | null;
  kind: string;
  hue: Hue;
  state: string;
  tone: Tone;
  toBook: boolean;
  words: string;
};

export type SchedulePage = {
  view: ScheduleView;
  day: string;
  today: string;
  days: string[];
  payloads: SchedulePayload[];
  /** Book in is offered here and the viewer may press it */
  canBook: boolean;
  /** the 4 weeks view: each weekday scored against the crew's hours, less
      whoever is off and nothing on a public holiday */
  capacity: CapacityDay[];
  /** 4 weeks and Month: each weekday's public holiday, who's off and its
      events (the Team filter, Isaac, 24 October 2026) */
  team: TeamDay[];
  /** ServiceM8 staff uuid (lower case) → their HeyTiff person, where linked */
  profiles: Record<string, string>;
  /** may set the team's regular days off */
  canTeam: boolean;
};

const SM8 = "sm8:";

async function mayPressBookings(): Promise<boolean> {
  try {
    if (!(await can("workboard_manage"))) return false;
    return BOOKINGS_OPEN_TO_MANAGERS || (await getDbRole()) === "owner";
  } catch {
    return false;
  }
}

export function readScheduleParams(params: Record<string, string | string[] | undefined>, today: string): { view: ScheduleView; day: string } {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const asked = one("view");
  const view: ScheduleView = asked === "week" || asked === "weeks" || asked === "month" ? asked : "day";
  let day = isDay(one("day")) ? one("day")! : today;
  /* a weekend asked for the day view shows the Monday after */
  if (view === "day" && isWeekend(day)) day = stepDay("day", day, 1);
  return { view, day };
}

export async function loadSchedulePage(params: Record<string, string | string[] | undefined>): Promise<SchedulePage | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) return null;

  const today = todayInZone(await getSm8Timezone(orgId));
  const { view, day } = readScheduleParams(params, today);
  const days = daysFor(view, day);

  /* 4 weeks and Month: the capacity window's read, and nothing else (no
     Jobs panel). A month runs past one window's 28 days, so it reads two. */
  if (view === "weeks" || view === "month") {
    const starts = [days[0], ...(daysFrom(days[0], CAPACITY_WINDOW_DAYS + 1)[CAPACITY_WINDOW_DAYS] <= days[days.length - 1] ? [daysFrom(days[0], CAPACITY_WINDOW_DAYS + 1)[CAPACITY_WINDOW_DAYS]] : [])];
    const first = days[0];
    const last = days[days.length - 1];
    const [windows, rows, rules, links, events, notices] = await Promise.all([
      Promise.all(starts.map((s) => loadCapacityWindow(orgId, s))),
      readAvailabilitySpan(orgId, first, last),
      readRegularDaysOff(orgId),
      sm8StaffByProfile(orgId),
      calendarEventsInSpan(orgId, first, last),
      noticeEventsInSpan(orgId, first, last),
    ]);
    const staffNames = new Map(windows.flatMap((w) => w.staffNames));
    const names = new Map<string, string>();
    for (const a of windows[0].allocation) if (a.name) names.set(a.staffUuid.toLowerCase(), a.name);
    for (const [uuid, name] of staffNames) if (name) names.set(uuid.toLowerCase(), name);
    /* who's off, the business shut and its events, day by day: ServiceM8's
       time off (where its mirror can answer for all of it) with the team's
       regular days off laid over, as the Day and Week views read them */
    const team = days.map((d) => {
      const placed = rows ? availabilityOnDay(rows, d) : { away: [], closed: [] };
      return teamDay({ dayISO: d, away: withRegular(placed.away, awayOnDay(rules, d, links)), closed: placed.closed, names, events, notices });
    });
    const byDay = new Map(team.map((t) => [t.dayISO, t]));
    const all = capacityWindow({
      days: starts.flatMap((s) => daysFrom(s, CAPACITY_WINDOW_DAYS)),
      activities: windows.flatMap((w) => w.activities),
      allocation: windows[0].allocation,
      staffNames,
      offMinutes: (d, u) => byDay.get(d)?.off.find((o) => o.staffUuid.toLowerCase() === u.toLowerCase())?.minutes ?? 0,
      closed: new Set(team.filter((t) => t.holiday).map((t) => t.dayISO)),
    });
    const shown = new Set(days);
    return { view, day, today, days, payloads: [], canBook: false, capacity: all.filter((d) => shown.has(d.dayISO)), team, profiles: {}, canTeam: false };
  }

  const booking = sm8BookingsAllowed();
  const [state, mayPress, rules, links, canTeam] = await Promise.all([
    booking ? readSm8WriteState(orgId) : Promise.resolve(null),
    booking ? mayPressBookings() : Promise.resolve(false),
    readRegularDaysOff(orgId),
    sm8StaffByProfile(orgId),
    can("team"),
  ]);
  /* regular days off (TAFE, RDOs) laid over ServiceM8's own time off */
  const payloads = (
    await Promise.all(days.map((d) => loadScheduleDay(orgId, d, state ? { state, away: true } : { away: true })))
  ).map((p) => ({ ...p, away: withRegular(p.away ?? [], awayOnDay(rules, p.dayISO, links)) }));
  const profiles = Object.fromEntries([...links.entries()].map(([profile, sm8]) => [sm8.toLowerCase(), profile]));

  return {
    view,
    day,
    today,
    days,
    payloads,
    canBook: !!state && offersSend(state, "booking") && mayPress,
    capacity: [],
    team: [],
    profiles,
    canTeam,
  };
}

/** THE JOBS PANEL, READ ON ITS OWN (Isaac, 20 October: "The week switcher is
    very slow"). It is the Jobs list's whole read, about three seconds, and
    it doesn't change with the day or week on the board, so the board reads
    its days and the panel reads this once, kept in the browser between
    switches and read again behind them (app/actions/schedule-panel). */
export async function schedulePanelJobs(): Promise<PanelJob[]> {
  const list = await loadJobsList();
  return (list?.rows ?? [])
    .filter((r) => r.key.startsWith(SM8))
    .map((r) => ({
      uuid: r.key.slice(SM8.length),
      number: r.number,
      client: r.client,
      site: r.site,
      kind: r.kind,
      hue: r.hue,
      state: r.state,
      tone: r.tone,
      toBook: r.views.includes("to-book"),
      words: r.words,
    }));
}
