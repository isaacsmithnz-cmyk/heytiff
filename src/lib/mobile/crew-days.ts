import "server-only";

import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { plusDays } from "@/lib/workboard/dates";
import type { MobileCtx } from "./auth";
import { readDaysOf } from "./free-days";
import { dayFull, type FreeDay } from "./free-days-plan";
import { crewOf, titlesOf } from "./schedule-crew";

/* THE CREW'S WEEK, for Book a visit and Change the visit on a job's card
   (Isaac, 17 November 2026: "select the day or date. Then select the
   duration and then select the people. Once you've selected the date, it
   will tell you who's free on that day"; then "When selecting the date, it
   can probably tell you how full it is ... tapping on that date will show
   who's booked in on what days").

   Each of the crew (Schedule capacity's people) with their days from
   `from`: their bookings, the gaps in their normal day and their time off,
   as Change the day or time reads one person's (lib/mobile/free-days). The
   visit being changed is left out (`skip`), so its own time reads free. And
   each day's fullness across them, for the week's dates.

   A read only: the bookings themselves are schedule-change's. */

export type CrewDays = { uuid: string; name: string; title: string | null; days: FreeDay[] };
export type CrewWeek = { crew: CrewDays[]; full: { day: string; full: number | null }[] };

const low = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export async function readCrewWeek(
  ctx: MobileCtx,
  ask: { from: string; count: number; job: string | null; skip: readonly string[]; minutes: number | null },
  now: number = Date.now()
): Promise<CrewWeek | null> {
  const crew = await crewOf(ctx.orgId);
  if (!crew) return null;
  if (crew.length === 0) return { crew: [], full: [] };
  const [days, state] = await Promise.all([
    readDaysOf(ctx, { staff: crew.map((p) => p.uuid), skip: ask.skip, job: ask.job, minutes: ask.minutes, from: ask.from, count: ask.count }, now),
    readSm8WriteState(ctx.orgId).catch(() => null),
  ]);
  if (!days) return null;
  const titles = await titlesOf(ctx.orgId, state?.tenantId ?? null, crew.map((p) => p.uuid)).catch(() => new Map<string, string>());
  const people: CrewDays[] = crew.map((p) => ({ uuid: p.uuid, name: p.name, title: titles.get(low(p.uuid)) ?? null, days: days.get(low(p.uuid))?.days ?? [] }));
  const full = Array.from({ length: ask.count }, (_, i) => {
    const day = plusDays(ask.from, i);
    return { day, full: dayFull(people.map((p) => p.days.find((d) => d.day === day))) };
  });
  return { crew: people, full };
}
