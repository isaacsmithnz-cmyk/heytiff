import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import type { Sm8Press } from "@/lib/integrations/sm8-press";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import { wallInstant } from "@/lib/integrations/sm8-booking-plan";
import { getPaySettings, shiftDefaultsFor } from "@/lib/timepay/query";
import { loadTimesheetFor } from "@/lib/timepay/page-data";
import { addDays, periodConfig, periodStartFor } from "@/lib/timepay/period";
import { approvedInSpan, holidaysInSpan, stateFor } from "@/lib/timepay/leave-query";
import { classifyEmployment, presumesDays } from "@/lib/staff/employment";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { streetLine } from "@/lib/studio/job-link";
import { derivedDayHours, dowOf, expectedDay, expectsWork, normalHours, type WeekCtx } from "@/components/timepay/logic";
import { saveDay } from "@/app/actions/timepay";
import { endCheckIn, jobOf, openCheckIn, startCheckIn, type CheckIn } from "@/lib/workboard/check-in-rules";
import { jobsOf, sendTime, staffUuidOf, wallMinute, type ClockJob } from "./clock";
import { actAsPhoneUser, type MobileCtx } from "./auth";
import { readCheckInFixes, withFix } from "@/lib/workboard/check-in-fixes";
import { joinDay, type Away } from "./day-join";

export { AWAY_KEPT_MS, joinDay, type Away } from "./day-join";

/* YOUR DAY ON THE PHONE (Isaac, 28 October 2026): "GPS tracking only starts
   when you clock on for the day, or when you get to the first job… Clocking
   out will turn off the GPS… rounded to every 15 minutes… if it's open and
   I'm nearby, it could pop up saying add time to this job". Built as mocked
   (https://claude.ai/artifact/3X2UhCCjikQDDRDPghDcYg).

   THE DAY is staff_days: Clock on to Clock off, and the stops at the office.
   THE JOBS in it are job_check_ins, on the rules every screen shares
   (check-in-rules): arriving somewhere ends the last stint. The phone tells
   this file when you arrive and leave; it never sends where you are.

   NOTHING GOES TO SERVICEM8 UNTIL CLOCK OFF, and then once a job: each
   stint's time, to the quarter hour, unless ServiceM8 already has the
   person on that job from its own check-in, which wins.

   YOUR NORMAL DAY IS PROTECTED (Isaac: "I don't want the guys getting marked
   down hours when they just didn't clock on till later"). Clock off writes
   the timesheet only when the day it confirms is longer than the person's
   normal day, or isn't a rostered day, or they're casual; otherwise the
   normal day stands, as if they hadn't clocked at all. The clock only ever
   adds hours, and only the ones the person confirmed. */

export type DayStop = { from: string; until: string | null };

export type DayJob = ClockJob & {
  from: string;
  until: string | null;
  /** the phone's stint, or ServiceM8's own check-in */
  how: "phone" | "servicem8";
  /** the phone's stint it is, to send once */
  stintId?: string;
  /** why you were there (site_meeting, helping), or plain labour */
  reason?: string | null;
  /** later stints of the same job joined onto this one (joinDay) */
  joined?: string[];
  /** a long time away before coming back to this job, left off it unless kept
      (joinDay): keeping it stretches the stint before it, `stintId` from
      `stintFrom`, to `until` */
  away?: Away | null;
};

/** A stint of the phone's, with why you were there. */
type Stint = CheckIn & { reason?: string | null };

/** The reasons the phone's buttons give, as kept. */
export const REASONS = ["site_meeting", "helping"] as const;

export type DaySummary = {
  from: string;
  until: string;
  minutes: number;
  jobs: (ClockJob & { from: string; until: string; minutes: number; how: DayJob["how"]; stintId?: string; reason?: string | null; joined?: string[]; away?: Away | null })[];
  office: { minutes: number; spans: { from: string; until: string }[] };
  travel: number;
};

export type DayPlace = ClockJob & { address: string; lat: number | null; lng: number | null };

export type DayState = {
  day: { id: string; workDate: string; onAt: string; offAt: string | null } | null;
  /** where you are now: a job's stint, or the office */
  at: { kind: "job"; job: ClockJob; since: string; stintId: string; reason: string | null } | { kind: "office"; since: string } | null;
  jobs: DayJob[];
  summary: DaySummary | null;
  /** your normal day ("7:00 AM", "3:00 PM"): the morning ask starts an hour before it */
  normal: { start: string; end: string } | null;
};

export const DAY_WORDS = {
  on: "Your day is on.",
  already: "Your day is already on.",
  notOn: "Your day isn't on. Clock on first.",
  noJob: "That job isn't in HeyTiff.",
  future: "That time hasn't come yet.",
  noTime: "Pick the time.",
  beforeOn: "That's before you clocked on.",
  backwards: "It has to finish after it starts.",
  noStint: "That time isn't in your day.",
  changed: "Changed.",
  removed: "Taken off your day.",
  off: "Clocked off at {at}.",
} as const;

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

const QUARTER = 15 * 60_000;
/** An instant to the nearest quarter hour: 7:27 is 7:30, 10:51 is 10:45. */
export const toQuarter = (iso: string): string => new Date(Math.round(Date.parse(iso) / QUARTER) * QUARTER).toISOString();
const mins = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));

/* WHERE THE DAY WENT, to the quarter hour: each job, the office, and the
   rest as travel, adding up to the day. A stop that rounds to nothing is
   left out. One function, so the Clock off sheet, the timesheet and
   ServiceM8 all read the same day. */
export function summarise(day: { onAt: string; until: string }, jobs: DayJob[], office: DayStop[]): DaySummary {
  const from = toQuarter(day.onAt);
  const until = toQuarter(day.until) < from ? from : toQuarter(day.until);
  const clamp = (iso: string) => (iso < from ? from : iso > until ? until : iso);
  const span = (a: string, b: string | null) => {
    const f = clamp(toQuarter(a));
    const u = clamp(toQuarter(b ?? day.until));
    return { from: f, until: u, minutes: mins(f, u) };
  };
  const jobRows = jobs.map((j) => ({ ...j, ...span(j.from, j.until) })).filter((j) => j.minutes > 0);
  const spans = office.map((o) => span(o.from, o.until)).filter((o) => o.minutes > 0);
  const total = mins(from, until);
  const onJobs = jobRows.reduce((n, j) => n + j.minutes, 0);
  const atOffice = spans.reduce((n, o) => n + o.minutes, 0);
  return {
    from,
    until,
    minutes: total,
    jobs: jobRows,
    office: { minutes: atOffice, spans: spans.map(({ from: f, until: u }) => ({ from: f, until: u })) },
    travel: Math.max(0, total - onJobs - atOffice),
  };
}

type DayRow = { id: string; work_date: string; on_at: string; off_at: string | null; office: DayStop[] | null };
const DAY_COLUMNS = "id, work_date, on_at, off_at, office";

async function zoneOf(orgId: string): Promise<string> {
  return (await bookingZone(orgId)).zone ?? "Australia/Sydney";
}

/** The day that's on, or else today's that ended. */
async function dayRow(ctx: MobileCtx, today: string): Promise<DayRow | null> {
  const { data: open } = await supabaseAdmin
    .from("staff_days")
    .select(DAY_COLUMNS)
    .eq("org_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .is("off_at", null)
    .maybeSingle();
  if (open) return open as DayRow;
  const { data } = await supabaseAdmin
    .from("staff_days")
    .select(DAY_COLUMNS)
    .eq("org_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .eq("work_date", today)
    .order("on_at", { ascending: false })
    .limit(1);
  return ((data ?? []) as DayRow[])[0] ?? null;
}

/** The person's stints in the day. */
async function stintsIn(ctx: MobileCtx, from: string, until: string | null): Promise<Stint[]> {
  let q = supabaseAdmin
    .from("job_check_ins")
    .select("id, sm8_job_uuid, checked_in_at, checked_out_at, reason")
    .eq("org_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .gte("checked_in_at", from)
    .order("checked_in_at", { ascending: true });
  if (until) q = q.lte("checked_in_at", until);
  const { data } = await q;
  return ((data ?? []) as { id: string; sm8_job_uuid: string; checked_in_at: string; checked_out_at: string | null; reason: string | null }[]).map((r) => ({
    id: r.id,
    jobUuid: r.sm8_job_uuid,
    inAt: r.checked_in_at,
    outAt: r.checked_out_at,
    reason: r.reason,
  }));
}

/** ServiceM8's own check-ins for the person in the day (recorded time), as instants. */
async function sm8CheckIns(ctx: MobileCtx, staffUuid: string | null, zone: string, from: string, until: string): Promise<{ jobUuid: string; from: string; until: string }[]> {
  if (!staffUuid) return [];
  const a = wallMinute(new Date(Date.parse(from) - 12 * 3_600_000).toISOString(), zone);
  const b = wallMinute(until, zone);
  if (!a || !b) return [];
  const spell = [...new Set([staffUuid, staffUuid.toLowerCase(), staffUuid.toUpperCase()])];
  const { data } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("uuid, job_uuid, start_date, end_date")
    .eq("org_id", ctx.orgId)
    .eq("active", 1)
    .eq("activity_was_scheduled", 0)
    .in("staff_uuid", spell)
    .gte("start_date", a)
    .lte("start_date", b);
  type Act = { uuid: string; job_uuid: string; start_date: string | null; end_date: string | null };
  const acts = (data ?? []) as Act[];
  /* a check-in left on and fixed counts to its fixed end (check_in_fixes), as the job card and the schedule count it */
  const fixes = await readCheckInFixes(ctx.orgId, acts.map((r) => r.uuid)).catch(() => new Map<string, string>());
  const out: { jobUuid: string; from: string; until: string }[] = [];
  for (const r of acts.map((x) => withFix(x, fixes))) {
    const s = wallInstant(r.start_date, zone, "earliest");
    const e = wallInstant(r.end_date, zone, "latest");
    /* an SM8 check-in left open has no end yet: it isn't a stretch of time */
    if (s === null || e === null || e <= s) continue;
    const fromIso = new Date(s).toISOString();
    const untilIso = new Date(e).toISOString();
    if (untilIso <= from || fromIso >= until) continue;
    out.push({ jobUuid: r.job_uuid, from: fromIso, until: untilIso });
  }
  return out;
}

const overlaps = (a: { from: string; until: string | null }, b: { from: string; until: string | null }, now: string) =>
  a.from < (b.until ?? now) && b.from < (a.until ?? now);

/* THE DAY'S JOBS, one list: ServiceM8's own check-ins win where they cover
   the same job at the same time as the phone's stint; the phone's stints
   fill everything else, and are the ones that still need sending. */
export function mergeJobs(
  stints: Stint[],
  theirs: { jobUuid: string; from: string; until: string }[],
  name: (jobUuid: string) => ClockJob,
  now: string
): { jobs: DayJob[]; toSend: Stint[] } {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const mine = stints.filter((s) => !theirs.some((t) => same(t.jobUuid, s.jobUuid) && overlaps({ from: s.inAt, until: s.outAt }, t, now)));
  const jobs: DayJob[] = [
    ...theirs.map((t) => ({ ...name(t.jobUuid), from: t.from, until: t.until, how: "servicem8" as const })),
    ...mine.map((s) => ({ ...name(s.jobUuid), from: s.inAt, until: s.outAt, how: "phone" as const, stintId: s.id, reason: s.reason ?? null })),
  ].sort((a, b) => (a.from < b.from ? -1 : 1));
  return { jobs, toSend: mine };
}

/* WHETHER A CLOCKED DAY GOES ON THE TIMESHEET. The normal day is a floor: a
   rostered day that comes to no more than the person's normal day leaves the
   normal day standing; a longer one, a day they aren't rostered on, or any
   casual's day is written; a day they entered by hand is never touched. */
export function sheetCall(p: { entered: boolean; rostered: boolean; casual: boolean; hours: number; normalDay: number }): "write" | "normal" | "kept" {
  if (p.entered) return "kept";
  if (p.rostered && !p.casual && p.hours <= p.normalDay) return "normal";
  return "write";
}

/** The day's jobs, read: the phone's stints and ServiceM8's own check-ins, merged. */
async function jobsIn(ctx: MobileCtx, day: DayRow, now: string): Promise<{ jobs: DayJob[]; toSend: Stint[] }> {
  const until = day.off_at ?? now;
  const zone = await zoneOf(ctx.orgId);
  const state = await readSm8WriteState(ctx.orgId).catch(() => null);
  const staffUuid = state ? await staffUuidOf(ctx, state.tenantId).catch(() => null) : null;
  const [stints, theirs] = await Promise.all([stintsIn(ctx, day.on_at, day.off_at), sm8CheckIns(ctx, staffUuid, zone, day.on_at, until)]);
  const names = await jobsOf(ctx.orgId, [...stints.map((s) => s.jobUuid), ...theirs.map((t) => t.jobUuid)]);
  const name = (u: string): ClockJob => names.get(u.toLowerCase()) ?? { jobUuid: u, number: null, where: "" };
  const merged = mergeJobs(stints, theirs, name, now);
  return { jobs: joinDay(merged.jobs, day.office ?? []), toSend: merged.toSend };
}

/** The person's own normal day, or the workspace's. */
async function normalOf(ctx: MobileCtx): Promise<{ start: string; end: string } | null> {
  const staffId = await staffIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return null;
  const [{ settings }, own] = await Promise.all([getPaySettings(ctx.orgId), shiftDefaultsFor(ctx.orgId, [staffId]).catch(() => null)]);
  const h = normalHours(settings, own?.hours.get(staffId) ?? null);
  return { start: h.start, end: h.end };
}

/** Monday 0 … Sunday 6, the roster's own convention, of an ISO date. */
const weekdayOf = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;

/* THE DAYS YOU'RE ROSTERED ON, from today for `count` days: the phone puts
   its "Clock on for the day?" reminder on these mornings and no others
   (Isaac, 28 October 2026: "do the 7:15 reminder"). Your work days, less
   the public holidays where you are and your approved leave. A casual has
   no roster, so none. */
export async function rosteredDays(ctx: MobileCtx, from: string, count = 8): Promise<string[]> {
  const staffId = await staffIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return [];
  const until = addDays(from, count - 1);
  const [{ settings }, own, profile, state] = await Promise.all([
    getPaySettings(ctx.orgId),
    shiftDefaultsFor(ctx.orgId, [staffId]).catch(() => null),
    supabaseAdmin.from("staff_profiles").select("employment_type").eq("org_id", ctx.orgId).eq("id", staffId).maybeSingle(),
    stateFor(ctx.orgId, staffId).catch(() => null),
  ]);
  const employment = (profile.data as { employment_type: string | null } | null)?.employment_type ?? null;
  if (!presumesDays(classifyEmployment(employment))) return [];
  const workDays = own?.workDays.get(staffId) ?? settings.workDays;
  const [holidays, leave] = await Promise.all([holidaysInSpan(ctx.orgId, state, from, until).catch(() => []), approvedInSpan(ctx.orgId, from, until).catch(() => [])]);
  const off = new Set(holidays.map((h) => h.date));
  for (const l of leave.filter((x) => x.staffId === staffId)) for (let d = l.startDate; d <= l.endDate; d = addDays(d, 1)) off.add(d);
  const out: string[] = [];
  for (let d = from; d <= until; d = addDays(d, 1)) if (workDays.includes(weekdayOf(d)) && !off.has(d)) out.push(d);
  return out;
}

/** Where the day stands: on since when, where you are now, and where it's
    gone, to now or to the finish the person is thinking of (`until`). */
export async function readDay(ctx: MobileCtx, now: number = Date.now(), until?: string | null): Promise<DayState> {
  const zone = await zoneOf(ctx.orgId);
  const nowIso = new Date(now).toISOString();
  const thinking = until && !Number.isNaN(Date.parse(until)) && Date.parse(until) <= now ? new Date(Date.parse(until)).toISOString() : null;
  const today = wallMinute(nowIso, zone)?.slice(0, 10) ?? nowIso.slice(0, 10);
  const [row, normal] = await Promise.all([dayRow(ctx, today), normalOf(ctx)]);
  if (!row) return { day: null, at: null, jobs: [], summary: null, normal };
  const { jobs } = await jobsIn(ctx, row, nowIso);
  const office = row.office ?? [];
  let at: DayState["at"] = null;
  if (!row.off_at) {
    const open = await openCheckIn(ctx.orgId, ctx.userId);
    const stop = office[office.length - 1];
    if (open && open.inAt >= row.on_at) {
      /* since you first got there, when the day's pieces joined onto it */
      const piece = jobs.find((j) => j.stintId === open.id || (j.joined ?? []).includes(open.id));
      const reason = piece?.reason ?? null;
      at = { kind: "job", job: (await jobsOf(ctx.orgId, [open.jobUuid])).get(open.jobUuid.toLowerCase()) ?? { jobUuid: open.jobUuid, number: null, where: "" }, since: piece?.from ?? open.inAt, stintId: open.id, reason };
    }
    else if (stop && !stop.until) at = { kind: "office", since: stop.from };
  }
  return {
    day: { id: row.id, workDate: row.work_date, onAt: row.on_at, offAt: row.off_at },
    at,
    jobs,
    summary: summarise({ onAt: row.on_at, until: row.off_at ?? (thinking && thinking >= row.on_at ? thinking : nowIso) }, jobs, office),
    normal,
  };
}

/** The time a press is for: the phone's, not before `floor`, never after now. */
function timeOf(at: unknown, now: number, floor?: string): string | { error: string } {
  if (at === undefined || at === null) return new Date(now).toISOString();
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  if (Number.isNaN(t)) return { error: DAY_WORDS.noTime };
  if (t > now + 60_000) return { error: DAY_WORDS.future };
  const iso = new Date(Math.min(t, now)).toISOString();
  if (floor && iso < floor) return { error: DAY_WORDS.beforeOn };
  return iso;
}

export type DayAnswer = { ok: true; state: DayState; said: string } | { ok: false; error: string; status: number };

async function openDay(ctx: MobileCtx): Promise<DayRow | null> {
  const { data } = await supabaseAdmin.from("staff_days").select(DAY_COLUMNS).eq("org_id", ctx.orgId).eq("user_id", ctx.userId).is("off_at", null).maybeSingle();
  return (data as DayRow | null) ?? null;
}

/* WHERE THE MORNING WATCH SAW YOU ARRIVE, before you clocked on: the office
   or your first booking, when, and when you left it again if you did. Only
   a time already past and from this morning counts. */
export type Arrived = { place: "office" | string; at: string; left: string | null };
const MORNING_MS = 12 * 3_600_000;

export function arrivedOf(raw: unknown, now: number): Arrived | null {
  const r = (raw && typeof raw === "object" ? raw : null) as { jobUuid?: unknown; at?: unknown; left?: unknown } | null;
  if (!r) return null;
  const at = typeof r.at === "string" ? Date.parse(r.at) : NaN;
  if (!Number.isFinite(at) || at > now || now - at > MORNING_MS) return null;
  const left = typeof r.left === "string" ? Date.parse(r.left) : NaN;
  const place = r.jobUuid === "office" ? "office" : jobOf(r.jobUuid);
  if (!place) return null;
  return { place, at: new Date(at).toISOString(), left: Number.isFinite(left) && left > at && left <= now ? new Date(left).toISOString() : null };
}

/** Clock on for the day: from the office, the first job, or a press. Your
    time where the morning watch saw you arrive starts from that arrival
    (Isaac, 29 October 2026: at 1352 at 7:15, clocked on from up the road at
    7:28, and his time there started at 7:45), and the day no later. */
export async function clockOnDay(ctx: MobileCtx, at: unknown, where: unknown, now: number = Date.now(), arrivedRaw?: unknown): Promise<DayAnswer> {
  const pressed = timeOf(at, now);
  if (typeof pressed !== "string") return { ok: false, error: pressed.error, status: 400 };
  if (await openDay(ctx)) return { ok: false, error: DAY_WORDS.already, status: 409 };
  const zone = await zoneOf(ctx.orgId);
  const arrived = arrivedOf(arrivedRaw, now);
  const job = arrived && arrived.place !== "office" ? (await jobsOf(ctx.orgId, [arrived.place])).get(arrived.place.toLowerCase()) : undefined;
  const dayOf = (iso: string) => wallMinute(iso, zone)?.slice(0, 10) ?? iso.slice(0, 10);
  const plan = clockOnPlan(pressed, where, arrived && (arrived.place === "office" || job) && dayOf(arrived.at) === dayOf(pressed) ? { ...arrived, place: job?.jobUuid ?? "office" } : null);
  const { error } = await supabaseAdmin
    .from("staff_days")
    .insert({ org_id: ctx.orgId, user_id: ctx.userId, work_date: dayOf(plan.onAt), on_at: plan.onAt, office: plan.office });
  if (error) return { ok: false, error: DAY_WORDS.already, status: 409 };
  if (plan.stint) {
    await startCheckIn(ctx.orgId, ctx.userId, plan.stint.jobUuid, plan.stint.from);
    if (plan.stint.until) await endCheckIn(ctx.orgId, ctx.userId, plan.stint.until, plan.stint.jobUuid).catch(() => null);
  }
  return { ok: true, state: await readDay(ctx, now), said: DAY_WORDS.on };
}

/** What Clock on writes: the day's start, its office stop, and the stint the
    morning's arrival starts. The day starts no later than the arrival. Pure. */
export function clockOnPlan(
  pressed: string,
  where: unknown,
  arrived: Arrived | null,
): { onAt: string; office: DayStop[]; stint: { jobUuid: string; from: string; until: string | null } | null } {
  const onAt = arrived && arrived.at < pressed ? arrived.at : pressed;
  if (arrived?.place === "office") return { onAt, office: [{ from: arrived.at, until: arrived.left }], stint: null };
  return {
    onAt,
    office: where === "office" ? [{ from: onAt, until: null }] : [],
    stint: arrived ? { jobUuid: arrived.place, from: arrived.at, until: arrived.left } : null,
  };
}

async function setOffice(ctx: MobileCtx, day: DayRow, office: DayStop[]) {
  await supabaseAdmin.from("staff_days").update({ office }).eq("org_id", ctx.orgId).eq("id", day.id);
}

/** Close the office stop that's open, at `t`. */
const leaveOffice = (office: DayStop[], t: string): DayStop[] =>
  office.map((o, i) => (i === office.length - 1 && !o.until ? { ...o, until: t < o.from ? o.from : t } : o));

/** Arrived at a job: its stint starts, and wherever you were ends there. Nothing is sent yet. */
export async function arriveAt(ctx: MobileCtx, jobUuid: unknown, at: unknown, now: number = Date.now()): Promise<DayAnswer> {
  const day = await openDay(ctx);
  if (!day) return { ok: false, error: DAY_WORDS.notOn, status: 409 };
  const t = timeOf(at, now, day.on_at);
  if (typeof t !== "string") return { ok: false, error: t.error, status: 400 };
  const j = jobOf(jobUuid);
  const job = j ? (await jobsOf(ctx.orgId, [j])).get(j.toLowerCase()) : undefined;
  if (!job) return { ok: false, error: DAY_WORDS.noJob, status: 404 };
  await startCheckIn(ctx.orgId, ctx.userId, job.jobUuid, t);
  await setOffice(ctx, day, leaveOffice(day.office ?? [], t));
  return { ok: true, state: await readDay(ctx, now), said: `At ${job.number ?? job.where}.` };
}

/** Left a job, or the office: that stint or stop ends. Leaving somewhere you aren't does nothing. */
export async function leave(ctx: MobileCtx, jobUuid: unknown, at: unknown, now: number = Date.now()): Promise<DayAnswer> {
  const day = await openDay(ctx);
  if (!day) return { ok: false, error: DAY_WORDS.notOn, status: 409 };
  const t = timeOf(at, now, day.on_at);
  if (typeof t !== "string") return { ok: false, error: t.error, status: 400 };
  if (jobUuid === "office") await setOffice(ctx, day, leaveOffice(day.office ?? [], t));
  else {
    const j = jobOf(jobUuid);
    if (j) await endCheckIn(ctx.orgId, ctx.userId, t, j).catch(() => null);
  }
  return { ok: true, state: await readDay(ctx, now), said: "" };
}

/** At the office: a stop starts (ending any job's stint). */
export async function atOffice(ctx: MobileCtx, at: unknown, now: number = Date.now()): Promise<DayAnswer> {
  const day = await openDay(ctx);
  if (!day) return { ok: false, error: DAY_WORDS.notOn, status: 409 };
  const t = timeOf(at, now, day.on_at);
  if (typeof t !== "string") return { ok: false, error: t.error, status: 400 };
  await endCheckIn(ctx.orgId, ctx.userId, t).catch(() => null);
  const office = day.office ?? [];
  if (!office.some((o) => !o.until)) await setOffice(ctx, day, [...office, { from: t, until: null }]);
  return { ok: true, state: await readDay(ctx, now), said: "" };
}

/** The phone offers times to the quarter hour: one rounded past the day's start or past now is meant as that. */
const QUARTER_MS = 15 * 60_000;

/** A job's new times in the day: both readable, in order, inside the day, none of it still to come.
    A time the quarter-hour rounding put just before Clock on, or just after now, is held to it
    (the review of 29 October 2026: on at 7:05, the sheet's 7:00 was refused). */
export function stintTimes(p: { from: unknown; until: unknown; onAt: string; now: number }): { from: string; until: string } | { error: string } {
  const f = typeof p.from === "string" ? Date.parse(p.from) : NaN;
  const u = typeof p.until === "string" ? Date.parse(p.until) : NaN;
  if (Number.isNaN(f) || Number.isNaN(u)) return { error: DAY_WORDS.noTime };
  const on = Date.parse(p.onAt);
  if (u > p.now + QUARTER_MS) return { error: DAY_WORDS.future };
  if (f < on - QUARTER_MS) return { error: DAY_WORDS.beforeOn };
  const from = Math.max(f, on);
  const until = Math.min(u, p.now);
  if (until <= from) return { error: DAY_WORDS.backwards };
  return { from: new Date(from).toISOString(), until: new Date(until).toISOString() };
}

/* A JOB'S TIME, CHANGED OR TAKEN OFF, before Clock off (Isaac, 28 October
   2026: the Clock off sheet's rows, "tap a row to change it"). Only the
   phone's own stints in the day that's on: ServiceM8's own check-ins are
   ServiceM8's, and once the day is off its times have gone to ServiceM8. */
export async function changeStint(ctx: MobileCtx, id: unknown, from: unknown, until: unknown, remove: boolean, now: number = Date.now()): Promise<DayAnswer> {
  const day = await openDay(ctx);
  if (!day) return { ok: false, error: DAY_WORDS.notOn, status: 409 };
  const stintId = typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  if (!stintId) return { ok: false, error: DAY_WORDS.noStint, status: 404 };
  const { data: row } = await supabaseAdmin
    .from("job_check_ins")
    .select("id, checked_in_at")
    .eq("org_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .eq("id", stintId)
    .maybeSingle();
  if (!row || (row as { checked_in_at: string }).checked_in_at < day.on_at) return { ok: false, error: DAY_WORDS.noStint, status: 404 };
  if (remove) {
    await supabaseAdmin.from("job_check_ins").delete().eq("org_id", ctx.orgId).eq("user_id", ctx.userId).eq("id", stintId);
    return { ok: true, state: await readDay(ctx, now), said: DAY_WORDS.removed };
  }
  const t = stintTimes({ from, until, onAt: day.on_at, now });
  if ("error" in t) return { ok: false, error: t.error, status: 400 };
  const { error } = await supabaseAdmin
    .from("job_check_ins")
    .update({ checked_in_at: t.from, checked_out_at: t.until })
    .eq("org_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .eq("id", stintId);
  if (error) return { ok: false, error: DAY_WORDS.noStint, status: 400 };
  return { ok: true, state: await readDay(ctx, now), said: DAY_WORDS.changed };
}

/** Why you're at a job, on the stint you're on there (or the one you just left), while the day is on.
    A reason the buttons don't give, or none, is plain labour. */
export async function setReason(ctx: MobileCtx, jobUuid: unknown, reason: unknown, now: number = Date.now()): Promise<DayAnswer> {
  const day = await openDay(ctx);
  if (!day) return { ok: false, error: DAY_WORDS.notOn, status: 409 };
  const j = jobOf(jobUuid);
  if (!j) return { ok: false, error: DAY_WORDS.noJob, status: 404 };
  const why = typeof reason === "string" && (REASONS as readonly string[]).includes(reason) ? reason : null;
  const spell = [...new Set([j, j.toLowerCase(), j.toUpperCase()])];
  const { data } = await supabaseAdmin
    .from("job_check_ins")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .in("sm8_job_uuid", spell)
    .gte("checked_in_at", day.on_at)
    .order("checked_in_at", { ascending: false })
    .limit(1);
  const id = ((data ?? []) as { id: string }[])[0]?.id;
  if (!id) return { ok: false, error: DAY_WORDS.noStint, status: 404 };
  await supabaseAdmin.from("job_check_ins").update({ reason: why }).eq("org_id", ctx.orgId).eq("id", id);
  return { ok: true, state: await readDay(ctx, now), said: "" };
}

/** "3:00 PM", the timesheet's way, from an instant on the account's clock. */
function sheetTime(iso: string, zone: string): string | null {
  const w = wallMinute(iso, zone);
  if (!w) return null;
  const h = Number(w.slice(11, 13));
  return `${h % 12 || 12}:${w.slice(14, 16)} ${h < 12 ? "AM" : "PM"}`;
}

/* THE TIMESHEET, AFTER CLOCK OFF. The normal day is a floor: the day is
   written only when it confirms more than the person's normal day, or isn't
   a day they're rostered on, or they're casual (who have no normal day), and
   never over a day they've already entered by hand. Otherwise nothing is
   written and the normal day stands. */
async function onTheTimesheet(ctx: MobileCtx, summary: DaySummary, workDate: string, zone: string): Promise<"written" | "normal" | "kept" | "none"> {
  const staffId = await staffIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return "none";
  const { settings } = await getPaySettings(ctx.orgId);
  const cfg = periodConfig(settings);
  const period = periodStartFor(workDate, cfg);
  const t = await loadTimesheetFor({ orgId: ctx.orgId, staffId, today: workDate }, settings, period);
  if (!t || "subcontractor" in t) return "none";
  const index = Math.round((Date.parse(`${workDate}T00:00:00Z`) - Date.parse(`${period}T00:00:00Z`)) / 86_400_000);
  if (!(index >= 0 && index < t.week.length)) return "none";
  const start = sheetTime(summary.from, zone);
  const end = sheetTime(summary.until, zone);
  if (!start || !end) return "none";
  const h = derivedDayHours(start, end, settings);
  if (h === null || h <= 0) return "none";
  const week: WeekCtx = { week: t.week, today: t.today, through: t.through, workDays: t.workDays, dayHours: t.me.dayHours };
  const call = sheetCall({
    entered: t.sources[index] === "entered",
    rostered: expectsWork(week, dowOf(t.week[index])),
    casual: t.employment === "casual",
    hours: h,
    normalDay: expectedDay(week, settings),
  });
  if (call !== "write") return call;
  const r = await actAsPhoneUser(ctx, () => saveDay(period, index, { t: "work", in: start, out: end, h }));
  return r.ok ? "written" : "none";
}

/** Clock off for the day at the time the person confirmed: whatever's open ends
    there, the day goes on the timesheet (or the normal day stands), and each
    job ServiceM8 doesn't already have goes to it, to the quarter hour. */
export async function clockOffDay(ctx: MobileCtx, press: Sm8Press | null, at: unknown, now: number = Date.now()): Promise<DayAnswer> {
  const day = await openDay(ctx);
  if (!day) return { ok: false, error: DAY_WORDS.notOn, status: 409 };
  const t = timeOf(at, now, day.on_at);
  if (typeof t !== "string") return { ok: false, error: t.error, status: 400 };
  /* A stint that began after the time you finished (you clocked off at your
     booking's end from the reminder, after the phone put you on another job)
     closes where it began, with no time, never left open for tomorrow to
     find (the review of 29 October 2026). */
  await endCheckIn(ctx.orgId, ctx.userId, t).catch(async () => {
    const open = await openCheckIn(ctx.orgId, ctx.userId).catch(() => null);
    if (open) await endCheckIn(ctx.orgId, ctx.userId, open.inAt).catch(() => null);
  });
  const office = leaveOffice(day.office ?? [], t);
  const { error } = await supabaseAdmin.from("staff_days").update({ off_at: t, office }).eq("org_id", ctx.orgId).eq("id", day.id).is("off_at", null);
  if (error) return { ok: false, error: DAY_WORDS.notOn, status: 409 };

  const closed: DayRow = { ...day, off_at: t, office };
  const nowIso = new Date(now).toISOString();
  const zone = await zoneOf(ctx.orgId);
  const { jobs, toSend } = await jobsIn(ctx, closed, nowIso);
  const summary = summarise({ onAt: day.on_at, until: t }, jobs, office);

  /* each job's time, once, to the quarter hour as the sheet showed it */
  for (const s of toSend) {
    const row = summary.jobs.find((j) => j.stintId === s.id);
    if (row) await sendTime(ctx, press, { ...s, inAt: row.from, outAt: row.until });
  }
  await onTheTimesheet(ctx, summary, day.work_date, zone).catch((err) => {
    console.error(`[mobile] day ${day.id} for org ${ctx.orgId} couldn't reach the timesheet: ${err instanceof Error ? err.message : String(err)}`);
  });
  return { ok: true, state: await readDay(ctx, now), said: fill(DAY_WORDS.off, { at: sheetTime(summary.until, zone)?.toLowerCase() ?? "" }) };
}

/* THE PLACES THE PHONE WATCHES FOR, never where the person is: the office,
   today's bookings, and the open jobs it could pass. Each with ServiceM8's
   own geocode where it has one; the phone finds the rest from the address. */
export async function placesFor(ctx: MobileCtx, now: number = Date.now()): Promise<{ office: string | null; booked: (DayPlace & { start: string; end: string | null })[]; open: DayPlace[] }> {
  const zone = await zoneOf(ctx.orgId);
  const today = wallMinute(new Date(now).toISOString(), zone)?.slice(0, 10) ?? new Date(now).toISOString().slice(0, 10);
  const { data: org } = await supabaseAdmin.from("organizations").select("address, suburb, state, postcode").eq("id", ctx.orgId).maybeSingle();
  const o = org as { address: string | null; suburb: string | null; state: string | null; postcode: string | null } | null;
  const office = o?.address?.trim() ? [o.address.trim(), [o.suburb, o.state, o.postcode].filter((x) => x?.trim()).join(" ")].filter(Boolean).join(", ") : null;

  type JobRow = { uuid: string; generated_job_id: string | null; job_address: string | null; geo_city: string | null; lat: number | null; lng: number | null };
  const placeOf = (r: JobRow): DayPlace => ({
    jobUuid: r.uuid,
    number: r.generated_job_id,
    where: [streetLine(r.job_address), r.geo_city?.trim()].filter(Boolean).join(", "),
    address: (r.job_address ?? "").replace(/\s*\n\s*/g, ", ").trim(),
    lat: r.lat,
    lng: r.lng,
  });

  const state = await readSm8WriteState(ctx.orgId).catch(() => null);
  const staffUuid = state ? await staffUuidOf(ctx, state.tenantId).catch(() => null) : null;
  let booked: (DayPlace & { start: string; end: string | null })[] = [];
  if (staffUuid) {
    const spell = [...new Set([staffUuid, staffUuid.toLowerCase(), staffUuid.toUpperCase()])];
    const { data: acts } = await supabaseAdmin
      .from("sm8_job_activities")
      .select("job_uuid, start_date, end_date")
      .eq("org_id", ctx.orgId)
      .eq("active", 1)
      .eq("activity_was_scheduled", 1)
      .in("staff_uuid", spell)
      .gte("start_date", `${today} 00:00:00`)
      .lte("start_date", `${today} 23:59:59`)
      .order("start_date", { ascending: true });
    const rows = (acts ?? []) as { job_uuid: string; start_date: string; end_date: string | null }[];
    if (rows.length) {
      const uuids = [...new Set(rows.flatMap((r) => [r.job_uuid, r.job_uuid.toLowerCase(), r.job_uuid.toUpperCase()]))];
      const { data: js } = await supabaseAdmin.from("sm8_jobs").select("uuid, generated_job_id, job_address, geo_city, lat, lng").eq("org_id", ctx.orgId).in("uuid", uuids);
      const byUuid = new Map(((js ?? []) as JobRow[]).map((j) => [j.uuid.toLowerCase(), j]));
      booked = rows.flatMap((r) => {
        const j = byUuid.get(r.job_uuid.toLowerCase());
        const s = wallInstant(r.start_date, zone, "earliest");
        const e = r.end_date ? wallInstant(r.end_date, zone, "latest") : null;
        return j && s !== null ? [{ ...placeOf(j), start: new Date(s).toISOString(), end: e === null ? null : new Date(e).toISOString() }] : [];
      });
    }
  }

  /* AN OPEN JOB WITH SOME LIFE IN IT (Isaac, 29 October 2026: 993, a quote
     from January 2025 nobody closed, put him "at" 3 Farran Street, the house
     next to his own). ServiceM8 keeps a job open until someone closes it, and
     most never are: 259 of Diamond Air's 356 open quotes and 439 of its 570
     work orders hadn't been touched in 60 days. A job counts only when it
     changed, or has a visit, within RECENT_DAYS either side of today. */
  const [from, until] = recentWindow(today);
  const [{ data: openJobs }, { data: visits }] = await Promise.all([
    supabaseAdmin
      .from("sm8_jobs")
      .select("uuid, generated_job_id, job_address, geo_city, lat, lng, edit_date")
      .eq("org_id", ctx.orgId)
      .eq("active", 1)
      .in("status", ["Work Order", "Quote"])
      .not("lat", "is", null)
      .not("lng", "is", null)
      .limit(2000),
    supabaseAdmin
      .from("sm8_job_activities")
      .select("job_uuid")
      .eq("org_id", ctx.orgId)
      .eq("active", 1)
      .gte("start_date", `${from} 00:00:00`)
      .lte("start_date", `${until} 23:59:59`)
      .limit(10000),
  ]);
  const visited = new Set(((visits ?? []) as { job_uuid: string }[]).map((v) => v.job_uuid.toLowerCase()));
  const open = ((openJobs ?? []) as (JobRow & { edit_date: string | null })[]).filter((j) => hasLife(j, from, visited));
  return { office, booked, open: open.map(placeOf) };
}

/** How far either side of today an open job's change or visit keeps it a place to drop in at. */
export const RECENT_DAYS = 60;

/** The days RECENT_DAYS either side of `today` (YYYY-MM-DD). */
export function recentWindow(today: string): [string, string] {
  const at = Date.parse(`${today}T00:00:00Z`);
  const day = (n: number) => new Date(at + n * 86_400_000).toISOString().slice(0, 10);
  return [day(-RECENT_DAYS), day(RECENT_DAYS)];
}

/** An open job changed since `from`, or with a visit in the window. */
export function hasLife(j: { uuid: string; edit_date: string | null }, from: string, visited: ReadonlySet<string>): boolean {
  return (!!j.edit_date && j.edit_date.slice(0, 10) >= from) || visited.has(j.uuid.toLowerCase());
}
