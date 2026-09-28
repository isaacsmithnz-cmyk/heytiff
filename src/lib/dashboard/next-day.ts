/* YOUR NEXT DAY, WHEN TODAY HAS NOTHING ON — server only. Isaac, walking
   the new Home on a Saturday (2026-09-26): "when there is nothing on your
   day, it looks very bland… something to put there as a placeholder that
   brings in the color of what your day normally shows". His pick: the next
   day he is booked, drawn as his own slanted bar in its Workboard colours.

   The same read as today's (`loadScheduleDay`, laid out by the board's own
   `layoutScheduleDay`) for the first day in the next fortnight that has a
   booking in the viewer's own lane, narrowed to that lane exactly as
   today's is, with the same mirror rows, streets and crew. Nothing on for
   two weeks is nothing to draw: the day says it is clear, as it always
   has. Asked by Home's loader (page-data) only then, only with `workboard`,
   and only for a viewer ServiceM8 knows.

   OUR BOOKINGS OVER THE MIRROR (two-way phase 3, PR E), only where the
   deployment books: the first read then skips a booking of yours we took
   out — it would pick a day that draws nothing — and finds one we sent that
   the mirror doesn't hold yet, and the day itself is drawn through
   `loadScheduleDay`, which takes the same overlay (PR D). Anywhere else the
   read is exactly what it was. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8BookingsAllowed } from "@/lib/integrations/sm8-kinds";
import { lowUuid, readBookingsOver } from "@/lib/workboard/all-jobs-query";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import { plusDays } from "@/lib/workboard/dates";
import { layoutScheduleDay, type ScheduleBlock } from "@/lib/workboard/schedule";
import { loadScheduleDay } from "@/lib/workboard/schedule-query";
import { jobsOnRail, railCrewOf, railWhereOf, viewerLaneBlocks } from "./day-rail";

/** How far ahead the next day is looked for: a fortnight, the Schedule's
    own reach past this week and the next. */
export const NEXT_DAY_REACH = 14;

/** How many of your bookings in the reach the first read looks over where
    the deployment books: enough to step past the few we took out. */
export const NEXT_DAY_SCAN = 20;

/** The next day with your bookings, as the rail carries today's. */
export type NextDay = {
  /** ISO yyyy-mm-dd, on the account's clock. */
  dayISO: string;
  blocks: ScheduleBlock[];
  jobs: AllJobsMirrorJob[];
  where: Record<string, string>;
  crew: Record<string, string[]>;
};

/** The first day after `dayISO`, within the reach, that has a booking of
    the viewer's — or null. A read that fails is no next day: the day says
    it is clear, which is what it said before this was here. */
export async function loadNextDay(orgId: string, mineUuid: string, dayISO: string): Promise<NextDay | null> {
  const first = sm8BookingsAllowed() ? await firstStartOver(orgId, mineUuid, dayISO) : await firstStart(orgId, mineUuid, dayISO);
  const day = typeof first === "string" && /^\d{4}-\d{2}-\d{2}/.test(first) ? first.slice(0, 10) : null;
  if (!day) return null;

  const schedule = await loadScheduleDay(orgId, day);
  const laid = layoutScheduleDay({
    activities: schedule.activities,
    staff: schedule.staff,
    jobs: schedule.jobs,
    onSite: new Set(schedule.onSite),
  });
  const blocks = viewerLaneBlocks(laid.lanes, mineUuid);
  if (blocks.length === 0) return null;
  return {
    dayISO: day,
    blocks,
    jobs: jobsOnRail(blocks, schedule.jobs),
    where: railWhereOf(blocks, schedule.addresses),
    crew: railCrewOf(laid.lanes, blocks, mineUuid),
  };
}

/** The start of your first booking in the reach, by the mirror alone —
    null for none, or a read that fails. */
async function firstStart(orgId: string, mineUuid: string, dayISO: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("start_date")
    .eq("org_id", orgId)
    .eq("staff_uuid", mineUuid)
    .eq("active", 1)
    .eq("activity_was_scheduled", 1)
    .gte("start_date", `${plusDays(dayISO, 1)} 00:00:00`)
    .lt("start_date", `${plusDays(dayISO, NEXT_DAY_REACH + 1)} 00:00:00`)
    .order("start_date", { ascending: true })
    .limit(1);
  if (error) return null;
  return ((data ?? []) as { start_date: string | null }[])[0]?.start_date ?? null;
}

/** The same, over our bookings (two-way phase 3): up to NEXT_DAY_SCAN of
    your mirror bookings in the reach, less the ones we took out, and your
    bookings we sent that the mirror doesn't hold yet — the soonest start. */
async function firstStartOver(orgId: string, mineUuid: string, dayISO: string): Promise<string | null> {
  const from = plusDays(dayISO, 1);
  const to = plusDays(dayISO, NEXT_DAY_REACH + 1);
  const { data, error } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("uuid, start_date")
    .eq("org_id", orgId)
    .eq("staff_uuid", mineUuid)
    .eq("active", 1)
    .eq("activity_was_scheduled", 1)
    .gte("start_date", `${from} 00:00:00`)
    .lt("start_date", `${to} 00:00:00`)
    .order("start_date", { ascending: true })
    .limit(NEXT_DAY_SCAN);
  if (error) return null;
  const rows = (data ?? []) as { uuid: string | null; start_date: string | null }[];
  const over = await readBookingsOver(orgId, { uuids: rows.map((r) => r.uuid ?? "").filter(Boolean), from, to, rows: false }, Date.now());
  const gone = over?.gone ?? new Set<string>();
  const starts = rows.filter((r) => !gone.has(lowUuid(r.uuid))).map((r) => r.start_date);
  for (const s of over?.sentNotMirrored ?? []) {
    if (lowUuid(s.staffUuid) === lowUuid(mineUuid) && !gone.has(lowUuid(s.uuid))) starts.push(s.start);
  }
  const dated = starts.filter((s): s is string => typeof s === "string" && s >= from && s < to).sort();
  return dated[0] ?? null;
}
