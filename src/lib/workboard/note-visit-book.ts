/* A VISIT FROM A NOTE, BOOKED — server only.

   The router's visit lane (note-visit) ends here: which way a visit goes,
   the person's day for "which time?", and the booking itself. Nothing here
   decides whether a booking may go. Book in does (actions/booking-sm8): the
   deployment books, Workboard manage, the owner while bookings are the
   owner's, a press from the session, the job a Quote or a Work Order, the
   time in the future. A visit from a note is pressed through `bookJobIn` as
   the job card's panel presses it, after the same live read
   (`readBookInContext`), so the two can never disagree about what may be
   booked. Undo is the panel's Undo, `takeBackBooking`.

   WHICH WAY, in order (v2 step 6, slice B):
     no job             a visit needs a ServiceM8 job: a task for the
                        speaker, "Book commissioning Friday";
     may not book       the same task, and Tiff says why;
     bookings off       this deployment or workspace sends no bookings: the
                        visit is a task at its time for the person, in
                        HeyTiff only, and she says so;
     not linked         the person is nobody in ServiceM8: the same;
     book               through Book in. A trial run queues and checks and
                        sends nothing, as Book in's does. */

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can, getDbRole } from "@/lib/permissions-server";
import { sm8BookingsAllowed } from "@/lib/integrations/sm8-kinds";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend } from "@/lib/integrations/sm8-write-plan";
import { listSm8StaffLinks } from "@/lib/integrations/links";
import { BOOKINGS_OPEN_TO_MANAGERS, localNow } from "@/lib/integrations/sm8-booking-plan";
import { bookingZone } from "@/lib/integrations/sm8-booking-read";
import { bookJobIn, readBookInContext } from "@/app/actions/booking-sm8";
import { workdayHours } from "@/lib/dashboard/reminders-query";
import { freeStarts, lengthOf, type BusySpan, type ProposedVisit, type VisitWhy } from "./note-visit";

export type VisitRoute =
  | { kind: "book"; jobUuid: string; staffUuid: string; trial: boolean }
  | { kind: "heytiff"; why: Extract<VisitWhy, "off" | "not_linked">; staffUuid: string | null }
  | { kind: "task"; why: Extract<VisitWhy, "no_right" | "no_job"> };

const low = (u: string | null | undefined) => (u ?? "").trim().toLowerCase();

/** Book in's own rule for who may press it: Workboard manage, and the owner
    while bookings are the owner's (spec 1.1). Doubt is no. */
export async function mayBookVisits(): Promise<boolean> {
  try {
    if (!(await can("workboard_manage"))) return false;
    return BOOKINGS_OPEN_TO_MANAGERS || (await getDbRole()) === "owner";
  } catch {
    return false;
  }
}

/** A person's ServiceM8 uuid, through the staff link; null for none. */
async function sm8StaffOf(orgId: string, tenantId: string | null, staffId: string | null): Promise<string | null> {
  if (!tenantId || !staffId) return null;
  try {
    const links = await listSm8StaffLinks(orgId, tenantId);
    return links.find((l) => l.staffProfileId === staffId)?.remoteId ?? null;
  } catch {
    return null;
  }
}

/** Which way a visit goes, for the person going (`staffId`). */
export async function visitRoute(
  orgId: string,
  target: { kind: string; id?: string | null },
  staffId: string | null,
): Promise<VisitRoute> {
  if (target.kind !== "job" || !target.id) return { kind: "task", why: "no_job" };
  if (!(await mayBookVisits())) return { kind: "task", why: "no_right" };
  const state = sm8BookingsAllowed() ? await readSm8WriteState(orgId) : null;
  const staffUuid = await sm8StaffOf(orgId, state?.tenantId ?? null, staffId);
  if (!state || !offersSend(state, "booking")) return { kind: "heytiff", why: "off", staffUuid };
  if (!staffUuid) return { kind: "heytiff", why: "not_linked", staffUuid: null };
  return { kind: "book", jobUuid: target.id, staffUuid, trial: state.mode === "trial" };
}

/** THE PERSON'S DAY, for "which time?": their working hours and everything
    they have on. Booking, it is Book in's own live read of ServiceM8 for
    that day (the panel's "that person that day"), with their time off and
    the business's closures; in HeyTiff only, the mirror's bookings for
    them that day. `read` false when it couldn't be read, or they are
    nobody in ServiceM8: then nothing is claimed about when they're free. */
export async function crewStarts(
  orgId: string,
  route: VisitRoute,
  visit: ProposedVisit,
): Promise<{ starts: string[]; read: boolean }> {
  const hours = await workdayHours(orgId, visit.assigneeId);
  const minutes = lengthOf(visit);
  let busy: BusySpan[] = [];
  let read = false;
  let now: string | null = null;

  if (route.kind === "book") {
    const ctx = await readBookInContext({ jobUuid: route.jobUuid, days: [visit.day] });
    if (ctx.ok) {
      const day = ctx.days[visit.day];
      const off = ctx.off[visit.day];
      now = localNow(ctx.zone, Date.now());
      if (day) {
        read = true;
        busy = [
          ...day.filter((a) => low(a.staffUuid) === low(route.staffUuid)),
          ...(off?.away ?? []).filter((a) => low(a.staffUuid) === low(route.staffUuid)),
          ...(off?.closed ?? []),
        ];
      }
    }
  } else if (route.kind === "heytiff" && route.staffUuid) {
    const next = new Date(`${visit.day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const [{ data, error }, zone] = await Promise.all([
      supabaseAdmin
        .from("sm8_job_activities")
        .select("staff_uuid, start_date, end_date")
        .eq("org_id", orgId)
        .eq("active", 1)
        .eq("activity_was_scheduled", 1)
        .gte("start_date", `${visit.day} 00:00:00`)
        .lt("start_date", `${next.toISOString().slice(0, 10)} 00:00:00`),
      bookingZone(orgId),
    ]);
    now = localNow(zone.zone, Date.now());
    if (!error) {
      read = true;
      busy = ((data ?? []) as { staff_uuid: string | null; start_date: string | null; end_date: string | null }[])
        .filter((a) => low(a.staff_uuid) === low(route.staffUuid))
        .map((a) => ({ start: a.start_date, end: a.end_date }));
    }
  }

  const starts = freeStarts({
    day: visit.day,
    part: visit.part,
    minutes,
    dayStart: hours.start,
    dayEnd: hours.end,
    busy,
    now,
  });
  /* a day that couldn't be read offers no starts it can't vouch for */
  return { starts: read ? starts : [], read };
}

/** A press id of Book in's shape, the same for the same note's same visit
    at the same time, so a second answer that crossed the first in flight
    is the same press, which Book in answers once. */
export function visitPressId(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Book one visit through Book in: its live read, then its press. */
export async function bookVisit(
  route: Extract<VisitRoute, { kind: "book" }>,
  visit: ProposedVisit,
  start: string,
  pressKey: string,
): Promise<{ ok: true; rowIds: string[]; trial: boolean } | { ok: false; error: string }> {
  const ctx = await readBookInContext({ jobUuid: route.jobUuid, days: [visit.day] });
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const res = await bookJobIn({
    jobUuid: route.jobUuid,
    pressId: visitPressId(pressKey),
    seen: { jobEditDate: ctx.job.editDate, readAt: ctx.readAt },
    /* a job's status is changed only by the panel's own tick */
    makeWorkOrder: false,
    bookings: [{ staffUuid: route.staffUuid, day: visit.day, start, minutes: lengthOf(visit) }],
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, rowIds: res.rowIds, trial: ctx.trial };
}
