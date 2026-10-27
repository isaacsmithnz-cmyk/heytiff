import "server-only";

import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { Sm8Press } from "@/lib/integrations/sm8-press";
import { sm8BookingsAllowed } from "@/lib/integrations/sm8-kinds";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { dedupeKey, offersSend } from "@/lib/integrations/sm8-write-plan";
import { settlePressedWrites } from "@/lib/integrations/sm8-drain";
import { listSm8StaffLinks } from "@/lib/integrations/links";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import { BOOKING_PRESS_BUDGET_MS, bookingSubject, localNow, wallInstant } from "@/lib/integrations/sm8-booking-plan";
import { queueRecordedTime } from "@/app/actions/sm8-booking-queue";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { streetLine } from "@/lib/studio/job-link";
import { endCheckIn, jobOf, lastCheckOut, openCheckIn, startCheckIn, type CheckIn } from "@/lib/workboard/check-in-rules";
import type { MobileCtx } from "./auth";

/* CLOCK ON, CLOCK OFF, from the phone (Isaac, 26 October 2026: "give me a
   better clock in, clock off. Easy button. Service Mate's one is terrible…
   people end up clocked in all the time… it just runs up the labour hours
   crazy").

   HEYTIFF HOLDS THE CLOCK (job_check_ins, on the rules every screen shares:
   lib/workboard/check-in-rules), so a stint stands whatever ServiceM8 is
   doing. When it ends — Clock off, at the time the person picked, or
   clocking on somewhere else — ServiceM8 gets ONE finished stretch of time
   on the job, as theirs: recorded time (isRecordedTime), on the account's
   wall clock to the minute, through the booking queue. ServiceM8 doesn't
   let other apps clock its shifts on or off, so this is the job's time,
   which is what its job costing reads. Nothing here ever clocks anyone off
   by itself: the phone's reminders only ask.

   Only the person's own time, to their own linked ServiceM8 staff member:
   no request names who. A stint that can't go (no link, ServiceM8 not
   taking bookings) stays in HeyTiff and says why. */

export type ClockJob = { jobUuid: string; number: string | null; where: string };

export type ClockOn = ClockJob & {
  id: string;
  since: string;
  /** the end of their booking on this job that day, as an instant: when the reminders come */
  bookingEnd: string | null;
};

/** Where a stint's time stands with ServiceM8. */
export type ClockSent = "sending" | "sent" | "failed" | "none";

export type ClockLast = ClockJob & { id: string; since: string; until: string; sm8: ClockSent; why: string | null };

export type ClockState = { on: ClockOn | null; last: ClockLast | null };

export type ClockAnswer = { ok: true; state: ClockState; said: string } | { ok: false; error: string; status: number };

export const CLOCK_WORDS = {
  on: "Clocked on at {job}.",
  off: "Clocked off, {length}.",
  notOn: "You aren't clocked on.",
  noJob: "That job isn't in HeyTiff.",
  future: "That time hasn't come yet.",
  noTime: "Pick the time you finished.",
  noLink: "You aren't linked to ServiceM8, so this time stays in HeyTiff.",
  notTaking: "ServiceM8 isn't taking time from HeyTiff yet, so this stays in HeyTiff.",
  failedSend: "It couldn't be sent. Try again.",
  sent: "Sent again.",
} as const;

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

/** "8 h 2 m", "45 m". */
export function lengthOf(fromIso: string, toIso: string): string {
  const mins = Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h} h ${mins % 60} m` : `${mins} m`;
}

/** An instant on the account's wall clock, down to its minute: "YYYY-MM-DD HH:MM:00". */
export function wallMinute(iso: string, zone: string): string | null {
  const t = Date.parse(iso);
  const s = Number.isNaN(t) ? null : localNow(zone, t);
  return s ? `${s.slice(0, 16)}:00` : null;
}

/** A stint's row in the queue, by the key the queue gives it. */
const timeKey = (c: Pick<CheckIn, "id" | "jobUuid">) => dedupeKey("booking", c.jobUuid.toLowerCase(), bookingSubject.time(c.id.toLowerCase()));

async function jobsOf(orgId: string, uuids: string[]): Promise<Map<string, ClockJob>> {
  const out = new Map<string, ClockJob>();
  if (uuids.length === 0) return out;
  const spell = [...new Set(uuids.flatMap((u) => [u, u.toLowerCase(), u.toUpperCase()]))];
  const { data } = await supabaseAdmin.from("sm8_jobs").select("uuid, generated_job_id, job_address, geo_city").eq("org_id", orgId).in("uuid", spell);
  for (const r of (data ?? []) as { uuid: string; generated_job_id: string | null; job_address: string | null; geo_city: string | null }[]) {
    out.set(r.uuid.toLowerCase(), {
      jobUuid: r.uuid,
      number: r.generated_job_id,
      where: [streetLine(r.job_address), r.geo_city?.trim()].filter(Boolean).join(", "),
    });
  }
  return out;
}

const jobFor = (jobs: Map<string, ClockJob>, uuid: string): ClockJob => jobs.get(uuid.toLowerCase()) ?? { jobUuid: uuid, number: null, where: "" };

/** The person's ServiceM8 staff member, by their link. */
async function staffUuidOf(ctx: MobileCtx, tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  const card = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!card) return null;
  const links = await listSm8StaffLinks(ctx.orgId, tenantId).catch(() => []);
  return links.find((l) => l.staffProfileId === card)?.remoteId ?? null;
}

/** The end of the person's booking on this job on the day they clocked on. */
async function bookingEndOf(orgId: string, staffUuid: string | null, on: CheckIn, zone: string | null): Promise<string | null> {
  if (!staffUuid || !zone) return null;
  const day = wallMinute(on.inAt, zone)?.slice(0, 10);
  if (!day) return null;
  const spell = (u: string) => [...new Set([u, u.toLowerCase(), u.toUpperCase()])];
  const { data } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("end_date")
    .eq("org_id", orgId)
    .eq("active", 1)
    .eq("activity_was_scheduled", 1)
    .in("job_uuid", spell(on.jobUuid))
    .in("staff_uuid", spell(staffUuid))
    .gte("start_date", `${day} 00:00:00`)
    .lte("start_date", `${day} 23:59:59`);
  const ends = ((data ?? []) as { end_date: string | null }[]).map((r) => r.end_date).filter((e): e is string => !!e).sort();
  const last = ends[ends.length - 1];
  const at = last ? wallInstant(last, zone, "earliest") : null;
  return at === null ? null : new Date(at).toISOString();
}

/** Why a stint's time won't go, or what it goes with. */
async function cantSend(ctx: MobileCtx): Promise<{ why: string } | { staffUuid: string; zone: string; state: Awaited<ReturnType<typeof readSm8WriteState>> }> {
  if (!sm8BookingsAllowed()) return { why: CLOCK_WORDS.notTaking };
  const state = await readSm8WriteState(ctx.orgId);
  if (!offersSend(state, "booking")) return { why: CLOCK_WORDS.notTaking };
  const z = await bookingZone(ctx.orgId);
  if (!z.zone) return { why: CLOCK_WORDS.notTaking };
  const staffUuid = await staffUuidOf(ctx, state.tenantId);
  if (!staffUuid) return { why: CLOCK_WORDS.noLink };
  return { staffUuid, zone: z.zone, state };
}

/** Where the person's clock stands: on, since when, and where their last
    stint's time is. */
export async function readClock(ctx: MobileCtx, now: number = Date.now()): Promise<ClockState> {
  const [open, last] = await Promise.all([
    openCheckIn(ctx.orgId, ctx.userId),
    lastCheckOut(ctx.orgId, ctx.userId, new Date(now - 18 * 3_600_000).toISOString()),
  ]);
  const jobs = await jobsOf(ctx.orgId, [open?.jobUuid, last?.jobUuid].filter((u): u is string => !!u));
  let on: ClockOn | null = null;
  if (open) {
    const [state, z] = await Promise.all([readSm8WriteState(ctx.orgId), bookingZone(ctx.orgId)]);
    const staffUuid = await staffUuidOf(ctx, state.tenantId);
    on = { ...jobFor(jobs, open.jobUuid), id: open.id, since: open.inAt, bookingEnd: await bookingEndOf(ctx.orgId, staffUuid, open, z.zone) };
  }
  let done: ClockLast | null = null;
  if (last?.outAt) {
    const { data } = await supabaseAdmin
      .from("sm8_writes")
      .select("status, last_error")
      .eq("org_id", ctx.orgId)
      .eq("kind", "booking")
      .eq("dedupe_key", timeKey(last))
      .maybeSingle();
    const row = data as { status: string; last_error: string | null } | null;
    let sm8: ClockSent = "none";
    let why: string | null = null;
    if (!row) {
      const c = await cantSend(ctx);
      why = "why" in c ? c.why : null;
    } else if (row.status === "sent") {
      sm8 = "sent";
      why = row.last_error;
    } else if (row.status === "queued" || row.status === "sending") {
      sm8 = "sending";
    } else if (row.status === "failed" || row.status === "cancelled") {
      sm8 = "failed";
      why = row.last_error ?? CLOCK_WORDS.failedSend;
    }
    done = { ...jobFor(jobs, last.jobUuid), id: last.id, since: last.inAt, until: last.outAt, sm8, why };
  }
  return { on, last: done };
}

/** A finished stint's time, to ServiceM8, sent there and then where it can
    be. Never throws: the stint stands in HeyTiff whatever happens here. */
async function sendTime(ctx: MobileCtx, press: Sm8Press | null, stint: CheckIn): Promise<void> {
  if (!stint.outAt || !press || press.orgId !== ctx.orgId || press.userId !== ctx.userId) return;
  try {
    const c = await cantSend(ctx);
    if ("why" in c) return;
    const start = wallMinute(stint.inAt, c.zone);
    const end = wallMinute(stint.outAt, c.zone);
    /* under a minute on the clock: nothing to send */
    if (!start || !end || end <= start) return;
    const startedAt = Date.now();
    const r = await queueRecordedTime(press, c.state, {
      jobUuid: stint.jobUuid,
      checkInId: stint.id,
      staffUuid: c.staffUuid,
      start,
      end,
      zone: c.zone,
      verbId: randomUUID(),
    });
    if (!r.ok) {
      console.error(`[mobile] time on job ${stint.jobUuid} for org ${ctx.orgId} wasn't queued: ${r.refusal}`);
      return;
    }
    await settlePressedWrites(ctx.orgId, [r.rowId], { startedAt, budgetMs: BOOKING_PRESS_BUDGET_MS });
  } catch (err) {
    console.error(`[mobile] time on job ${stint.jobUuid} for org ${ctx.orgId} couldn't be sent: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Clock on at this job, now. On somewhere else, that stint ends now and its time goes. */
export async function clockOn(ctx: MobileCtx, press: Sm8Press | null, jobUuid: unknown, now: number = Date.now()): Promise<ClockAnswer> {
  const j = jobOf(jobUuid);
  const jobs = j ? await jobsOf(ctx.orgId, [j]) : new Map<string, ClockJob>();
  const job = j ? jobs.get(j.toLowerCase()) : undefined;
  if (!job) return { ok: false, error: CLOCK_WORDS.noJob, status: 404 };
  const { closed } = await startCheckIn(ctx.orgId, ctx.userId, job.jobUuid, new Date(now).toISOString());
  if (closed) await sendTime(ctx, press, closed);
  return { ok: true, state: await readClock(ctx, now), said: fill(CLOCK_WORDS.on, { job: job.number ?? job.where }) };
}

/** Clock off at the time the person picked: not before they clocked on, not after now. */
export async function clockOff(ctx: MobileCtx, press: Sm8Press | null, at: unknown, now: number = Date.now()): Promise<ClockAnswer> {
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  if (Number.isNaN(t)) return { ok: false, error: CLOCK_WORDS.noTime, status: 400 };
  if (t > now + 60_000) return { ok: false, error: CLOCK_WORDS.future, status: 400 };
  const open = await openCheckIn(ctx.orgId, ctx.userId);
  if (!open) return { ok: false, error: CLOCK_WORDS.notOn, status: 409 };
  let ended: CheckIn | null;
  try {
    ended = await endCheckIn(ctx.orgId, ctx.userId, new Date(Math.min(t, now)).toISOString());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : CLOCK_WORDS.notOn, status: 400 };
  }
  if (!ended?.outAt) return { ok: false, error: CLOCK_WORDS.notOn, status: 409 };
  await sendTime(ctx, press, ended);
  return { ok: true, state: await readClock(ctx, now), said: fill(CLOCK_WORDS.off, { length: lengthOf(ended.inAt, ended.outAt) }) };
}

/** Try again on the last stint's time. */
export async function sendLastAgain(ctx: MobileCtx, press: Sm8Press | null, now: number = Date.now()): Promise<ClockAnswer> {
  const last = await lastCheckOut(ctx.orgId, ctx.userId, new Date(now - 18 * 3_600_000).toISOString());
  if (!last) return { ok: false, error: CLOCK_WORDS.notOn, status: 409 };
  await sendTime(ctx, press, last);
  return { ok: true, state: await readClock(ctx, now), said: CLOCK_WORDS.sent };
}
