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
import { loadJobsList } from "@/lib/workboard/jobs-list-query";
import { sm8BookingsAllowed } from "@/lib/integrations/sm8-kinds";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend } from "@/lib/integrations/sm8-write-plan";
import { BOOKINGS_OPEN_TO_MANAGERS } from "@/lib/integrations/sm8-booking-plan";
import type { Hue, Tone } from "@/components/parts/state";
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
  const view: ScheduleView = one("view") === "week" ? "week" : "day";
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

  const booking = sm8BookingsAllowed();
  const [state, mayPress, list] = await Promise.all([
    booking ? readSm8WriteState(orgId) : Promise.resolve(null),
    booking ? mayPressBookings() : Promise.resolve(false),
    loadJobsList(),
  ]);
  const payloads = await Promise.all(
    days.map((d) => loadScheduleDay(orgId, d, state ? { state, away: true } : { away: true })),
  );

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
  };
}
