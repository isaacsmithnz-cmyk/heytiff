import "server-only";

import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { crewNotBooked } from "@/lib/mobile/schedule-crew";
import { layoutScheduleDay } from "@/lib/workboard/schedule";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";
import { teamDayOf, type TeamDay } from "./team-day";

/* HOME'S SCHEDULE, the read (./team-day is the pure half). A day as the
   Schedule tab lays it out, and Schedule capacity's people with nothing
   booked and no time off, as the phone's Schedule says who's free
   (lib/mobile/schedule-crew). The day must have been read with its time
   off (`loadScheduleDay(…, { away: true })`), or someone away would read
   as free. */
export async function teamDayFor(
  orgId: string,
  payload: SchedulePayload,
  opts: { dayISO: string; today: boolean; nowMin: number | null; mine: string | null },
): Promise<TeamDay> {
  const day = layoutScheduleDay({
    activities: payload.activities,
    staff: payload.staff,
    jobs: payload.jobs,
    onSite: new Set(payload.onSite),
  });
  const low = (u: string | null | undefined) => (u ?? "").toLowerCase();
  const crew = await crewNotBooked(orgId, payload, async () => (await readSm8WriteState(orgId)).tenantId).catch(() => ({ free: [] }));
  /* you first, where you're free too */
  const free = crew.free
    .map((p) => (opts.mine && low(p.uuid) === low(opts.mine) ? "you" : p.name))
    .sort((a, b) => (a === "you" ? -1 : b === "you" ? 1 : 0));
  return teamDayOf(day, { ...opts, places: payload.places, free });
}
