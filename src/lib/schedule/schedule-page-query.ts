/* The Schedule page's read (v2, step 5): the days on the board, from the
   same day read the Workboard's Schedule tab makes (loadScheduleDay, with
   our own bookings laid over the mirror and each day's time off), and the
   jobs the Jobs panel offers, from the Jobs list's own rows. NO SESSION
   CHECK of its own beyond the org: the page gates on `workboard` first. */

import { auth0 } from "@/lib/auth0";
import { can, getDbRole } from "@/lib/permissions-server";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { loadScheduleDay, type SchedulePayload } from "@/lib/workboard/schedule-query";
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
  jobs: PanelJob[];
  /** Book in is offered here and the viewer may press it */
  canBook: boolean;
  /** the 4 weeks view: each weekday scored against the crew's hours */
  capacity: CapacityDay[];
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
  const view: ScheduleView = asked === "week" || asked === "weeks" ? asked : "day";
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

  /* 4 weeks: the capacity window's read, and nothing else (no Jobs panel) */
  if (view === "weeks") {
    const window = await loadCapacityWindow(orgId, days[0]);
    const all = capacityWindow({
      days: daysFrom(days[0], CAPACITY_WINDOW_DAYS),
      activities: window.activities,
      allocation: window.allocation,
      staffNames: new Map(window.staffNames),
    });
    const shown = new Set(days);
    return { view, day, today, days, payloads: [], jobs: [], canBook: false, capacity: all.filter((d) => shown.has(d.dayISO)), profiles: {}, canTeam: false };
  }

  const booking = sm8BookingsAllowed();
  const [state, mayPress, list, rules, links, canTeam] = await Promise.all([
    booking ? readSm8WriteState(orgId) : Promise.resolve(null),
    booking ? mayPressBookings() : Promise.resolve(false),
    loadJobsList(),
    readRegularDaysOff(orgId),
    sm8StaffByProfile(orgId),
    can("team"),
  ]);
  /* regular days off (TAFE, RDOs) laid over ServiceM8's own time off */
  const payloads = (
    await Promise.all(days.map((d) => loadScheduleDay(orgId, d, state ? { state, away: true } : { away: true })))
  ).map((p) => ({ ...p, away: withRegular(p.away ?? [], awayOnDay(rules, p.dayISO, links)) }));
  const profiles = Object.fromEntries([...links.entries()].map(([profile, sm8]) => [sm8.toLowerCase(), profile]));

  const jobs: PanelJob[] = (list?.rows ?? [])
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

  return {
    view,
    day,
    today,
    days,
    payloads,
    jobs,
    canBook: !!state && offersSend(state, "booking") && mayPress,
    capacity: [],
    profiles,
    canTeam,
  };
}
