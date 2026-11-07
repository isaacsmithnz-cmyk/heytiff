import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { listSm8StaffLinks } from "@/lib/integrations/links";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import { localNow } from "@/lib/integrations/sm8-booking-plan";
import { readBookingsOver } from "@/lib/workboard/all-jobs-query";
import { sm8CategoryColour } from "@/lib/workboard/all-jobs";
import { readAvailabilitySpan } from "@/lib/workboard/schedule-query";
import { availabilityOnDay, awaySpanOnDay, awayWord } from "@/lib/workboard/away";
import { plusDays } from "@/lib/workboard/dates";
import { getPaySettings, shiftDefaultsFor } from "@/lib/timepay/query";
import { normalHours, parseClock } from "@/components/timepay/logic";
import type { MobileCtx } from "./auth";
import { GAP_MIN, placeDays, type FreeDays, type Job } from "./free-days-plan";

export type { CloseBy, FreeBooking, FreeDay, FreeDays, FreeGap } from "./free-days-plan";

/* SOMEONE'S DAYS, FREE AND BOOKED, for moving a visit to another day on the
   phone (Isaac, 2 November 2026: "how could you do it so that you could see
   what days are actually free? ... if you just pick a random day on
   ServiceM8 ... it just says booking conflicts. But there's no way of
   telling you before you make the booking").

   Each day from `from` on: their bookings (job number, suburb, its colour),
   the gaps in their normal day around them, and the time off or the shut
   day that takes it. Their normal day is Time & Pay's (their own start and
   finish, or the workspace's), their days the roster's; a day off the
   roster is still listed, as ServiceM8 still books it. Time off is the
   Schedule's, ServiceM8's availability. Today's gaps start from now.

   The visit being moved is left out (`skip`), so its own time reads free.
   And "close by": a gap long enough for it, right after or before a
   booking in the job's own suburb, the likely place to put it.

   A read only: the move itself is schedule-change's, which checks again. */

const low = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const spellings = (uuids: readonly string[]) => [...new Set(uuids.flatMap((u) => [u, u.toLowerCase(), u.toUpperCase()]))];

/** At most this many days in one read: a month on the calendar. */
export const MOST_DAYS = 42;

/** Someone's days from `from`, for `count` days, with the visit `skip` left out. */
export async function readFreeDays(
  ctx: MobileCtx,
  ask: { staff: string; skip: string | null; job: string | null; minutes: number | null; from: string; count: number },
  now: number = Date.now()
): Promise<FreeDays | null> {
  const orgId = ctx.orgId;
  const count = Math.max(1, Math.min(MOST_DAYS, Math.floor(ask.count)));
  const last = plusDays(ask.from, count - 1);
  const floor = `${ask.from} 00:00:00`;
  const ceil = `${plusDays(last, 1)} 00:00:00`;

  const [acts, zone, state, pay, availability] = await Promise.all([
    supabaseAdmin
      .from("sm8_job_activities")
      .select("uuid, job_uuid, start_date, end_date")
      .eq("org_id", orgId)
      .eq("active", 1)
      .eq("activity_was_scheduled", 1)
      .in("staff_uuid", spellings([ask.staff]))
      .gte("start_date", floor)
      .lt("start_date", ceil)
      .order("start_date", { ascending: true }),
    bookingZone(orgId),
    readSm8WriteState(orgId).catch(() => null),
    getPaySettings(orgId),
    readAvailabilitySpan(orgId, ask.from, last),
  ]);
  if (acts.error) return null;
  type Act = { uuid: string; job_uuid: string | null; start_date: string | null; end_date: string | null };
  const mirrored = ((acts.data ?? []) as Act[]).filter((a): a is Act & { job_uuid: string; start_date: string; end_date: string } => !!a.job_uuid && !!a.start_date && !!a.end_date);

  /* our bookings over the mirror, as the Schedule draws them */
  const over = await readBookingsOver(orgId, { uuids: mirrored.map((a) => a.uuid), from: ask.from, to: plusDays(last, 1), rows: false }, now).catch(() => null);
  const bookings = mirrored
    .filter((a) => !over?.gone.has(low(a.uuid)))
    .map((a) => ({ activity: a.uuid, jobUuid: a.job_uuid, start: a.start_date, end: a.end_date }));
  for (const s of over?.sentNotMirrored ?? []) {
    if (low(s.staffUuid) !== low(ask.staff) || s.start < floor || s.start >= ceil || over?.gone.has(low(s.uuid))) continue;
    if (bookings.some((b) => low(b.activity) === low(s.uuid))) continue;
    bookings.push({ activity: s.uuid, jobUuid: s.jobUuid, start: s.start, end: s.end });
  }
  const theirs = bookings.filter((b) => !ask.skip || low(b.activity) !== low(ask.skip));

  /* their normal day: their own, or the workspace's */
  const links = state?.tenantId ? await listSm8StaffLinks(orgId, state.tenantId).catch(() => []) : [];
  const card = links.find((l) => low(l.remoteId) === low(ask.staff))?.staffProfileId ?? null;
  const own = card ? await shiftDefaultsFor(orgId, [card]).catch(() => null) : null;
  const hours = normalHours(pay.settings, card ? own?.hours.get(card) ?? null : null);
  const startMin = parseClock(hours.start) ?? 7 * 60;
  const endMin = parseClock(hours.end) ?? 15 * 60 + 30;
  const workDays = (card ? own?.workDays.get(card) : undefined) ?? pay.settings.workDays;

  const jobs = await jobsOf(orgId, [...theirs.map((b) => b.jobUuid), ...(ask.job ? [ask.job] : [])]);
  const nowWall = zone.zone ? localNow(zone.zone, now) : null;

  return placeDays({
    days: Array.from({ length: count }, (_, i) => plusDays(ask.from, i)),
    normal: { startMin, endMin: Math.max(endMin, startMin + GAP_MIN) },
    workDays,
    bookings: theirs,
    jobs,
    away: (day) => {
      const on = availability ? availabilityOnDay(availability, day) : { away: [], closed: [] };
      return {
        spans: [
          ...on.away.filter((a) => low(a.staffUuid) === low(ask.staff)).map((a) => ({ ...awaySpanOnDay(a, day), word: awayWord(a) })),
          ...on.closed.map((c) => ({ ...awaySpanOnDay(c, day), word: c.name ?? (c.kind === "holiday" ? "Public holiday" : "Closed") })),
        ],
      };
    },
    now: nowWall,
    minutes: ask.minutes,
    job: ask.job,
  });
}

/** Each job's number, suburb and colour. */
async function jobsOf(orgId: string, uuids: string[]): Promise<Map<string, Job>> {
  const out = new Map<string, Job>();
  if (uuids.length === 0) return out;
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, geo_city, status, category_uuid")
    .eq("org_id", orgId)
    .in("uuid", spellings([...new Set(uuids)]));
  const rows = (data ?? []) as { uuid: string; generated_job_id: string | null; geo_city: string | null; status: string | null; category_uuid: string | null }[];
  const cats = [...new Set(rows.map((r) => r.category_uuid).filter((c): c is string => !!c))];
  const colours = new Map<string, string | null>();
  if (cats.length > 0) {
    const { data: c } = await supabaseAdmin.from("sm8_categories").select("uuid, colour").eq("org_id", orgId).in("uuid", cats);
    for (const r of (c ?? []) as { uuid: string; colour: string | null }[]) colours.set(r.uuid, sm8CategoryColour(r.colour));
  }
  for (const r of rows) {
    out.set(low(r.uuid), {
      number: r.generated_job_id?.trim() ?? "",
      suburb: r.geo_city?.trim() ?? "",
      colour: r.category_uuid ? colours.get(r.category_uuid) ?? null : null,
      status: r.status,
    });
  }
  return out;
}
