import "server-only";

import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { Sm8Press } from "@/lib/integrations/sm8-press";
import type { Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import { settlePressedWrites } from "@/lib/integrations/sm8-drain";
import { fillWords } from "@/lib/integrations/sm8-note-words";
import { listSm8StaffLinks } from "@/lib/integrations/links";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { streetLine } from "@/lib/studio/job-link";
import { BOOKING_PRESS_BUDGET_MS, BOOKING_WORDS, placeName } from "@/lib/integrations/sm8-booking-plan";
import { readMirrorBookings } from "@/lib/integrations/sm8-booking-overlay";
import { sm8StaffNames } from "@/lib/integrations/sm8-booking-read";
import {
  queueBookIn,
  queueBookingRetry,
  queueBookingTakeBack,
  queueTakeOff,
  type BookingRefusal,
} from "@/app/actions/sm8-booking-queue";
import { pushToStaff } from "./push";
import { changeAllowed } from "./schedule-gate";
import type { MobileCtx } from "./auth";

/* CHANGING THE DAY FROM THE PHONE'S SCHEDULE (Isaac, 27 October 2026: "This
   morning, I had to change a couple of guys around, and I couldn't do that
   on the schedule"). Move someone to another job, swap two people, change
   someone's time, take someone off a job, and book someone who has nothing.

   EVERY CHANGE IS BOOK IN'S AND TAKE OFF'S, NOTHING NEW GOES TO SERVICEM8:
   a move is a booking on the new job (queueBookIn) and the old one taken
   off (queueTakeOff, a Clear of a booking on a job still open; or, for a
   booking of yours made from HeyTiff, its Undo). ServiceM8 has no move. The
   queue's helpers are the one door, the sender reads ServiceM8 live before
   anything goes, and a DELETE reads first and back after.

   THE GATES ARE BOOK IN'S (schedule-gate's changeAllowed), with the press
   the route minted from its own token check, for this workspace.

   THE NEW BOOKING FIRST: it is queued and sent, and only once it is in
   ServiceM8 is the old one queued and taken off; a refusal on the way takes
   back what this press booked, so the day is as it was. A booking taking
   the place of the one coming off (the same person, job and start) goes the
   other way round, since ServiceM8 won't hold both. Each half is sent in
   the foreground for a moment, and the answer says where each stands.

   SERVICEM8'S OWN FREEDOM (Isaac, 27 October 2026: "It should have the
   same freedom as ServiceM8"): any day, a booking under way or gone, a
   start before now, someone checked in or not. Every row this presses
   carries `payload.anyTime` (sm8-booking-plan's isAnyTime), and the queue
   and the sender let it go where Book in and Clear on the web wouldn't. The
   one rule kept is ServiceM8's own: recorded time is never removed.

   NOTHING TO THE CLIENT: ServiceM8's own booking confirmations are off for
   the account (checked 27 September). The person moved hears it from HeyTiff
   when the presser leaves Tell on: a push to their phones. */

export type ScheduleChange =
  | { do: "move"; activity: string; to: string; start?: string; end?: string }
  | { do: "swap"; activity: string; with: string }
  | { do: "time"; activity: string; start: string; end: string }
  | { do: "off"; activity: string }
  | { do: "book"; staff: string; job: string; start: string; end: string };

export type ChangeAnswer =
  | {
      ok: true;
      /** sent: in ServiceM8; waiting: queued, going shortly; trial: nothing goes */
      state: "sent" | "waiting" | "trial";
      /** "Leo is on 3304 now" */
      said: string;
      /** The change that puts it back, for Undo. */
      undo: ScheduleChange | null;
    }
  | { ok: false; error: string; status: number; retry?: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):00$/;

const low = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && low(a) === low(b);
const spellings = (uuids: readonly string[]) => [...new Set(uuids.flatMap((u) => [u, u.toLowerCase(), u.toUpperCase()]))];
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** "7:00", as the phone's cards say a time. */
const clock = (stamp: string) => {
  const m = STAMP.exec(stamp);
  return m ? `${Number(m[2]) % 12 || 12}:${m[3]}` : "";
};
const span = (start: string, end: string) => `${clock(start)} to ${clock(end)}`;

/* ── the gates ── */

type Gate = { ok: true; press: Sm8Press; state: Sm8WriteState; zone: string } | { ok: false; error: string; status: number };

/** Book in's gates, and a press for this person in this workspace. */
async function gate(ctx: MobileCtx, press: Sm8Press | null): Promise<Gate> {
  const g = await changeAllowed(ctx);
  if (!g.ok) return g;
  if (!press || press.orgId !== ctx.orgId || press.userId !== ctx.userId) return { ok: false, error: "Sign in again.", status: 401 };
  return { ok: true, press, state: g.state, zone: g.zone };
}

/* ── what is being changed ── */

/** A booking on the day as the change names it: ServiceM8's, or one of
    ours (a create, by the uuid it went under). `create` is our create row
    when the presser made it and it isn't taken back: it comes off by its
    Undo. */
type Booking = { uuid: string; jobUuid: string; staffUuid: string; start: string; end: string; create: string | null };

async function readBooking(orgId: string, press: Sm8Press, uuid: string): Promise<Booking | null | "failed"> {
  const [mirror, mine] = await Promise.all([
    readMirrorBookings(orgId, [uuid]),
    supabaseAdmin
      .from("sm8_writes")
      .select("id, status, sm8_job_uuid, remote_uuid, booking_staff_uuid, booking_start, booking_end, taken_back_at, requested_by_user")
      .eq("org_id", orgId)
      .eq("kind", "booking")
      .eq("op", "create")
      .or(`remote_uuid.eq.${low(uuid)},replaced_uuids.ov.{${low(uuid)}}`),
  ]);
  if (!mirror || mine.error) return "failed";
  const ours = ((mine.data ?? []) as {
    id: string;
    status: string;
    sm8_job_uuid: string | null;
    booking_staff_uuid: string | null;
    booking_start: string | null;
    booking_end: string | null;
    taken_back_at: string | null;
    requested_by_user: string | null;
  }[]).find((r) => !r.taken_back_at && r.requested_by_user === press.userId);
  const m = mirror.get(low(uuid));
  if (m) {
    if (Number(m.active) !== 1 || Number(m.scheduled) !== 1 || !m.jobUuid || !m.staffUuid || !m.start || !m.end) return null;
    return { uuid: m.uuid, jobUuid: m.jobUuid, staffUuid: m.staffUuid, start: m.start, end: m.end, create: ours?.id ?? null };
  }
  /* ours, not mirrored yet: what it booked */
  if (ours && ours.sm8_job_uuid && ours.booking_staff_uuid && ours.booking_start && ours.booking_end) {
    return { uuid: low(uuid), jobUuid: ours.sm8_job_uuid, staffUuid: ours.booking_staff_uuid, start: ours.booking_start, end: ours.booking_end, create: ours.id };
  }
  return null;
}

type Job = { uuid: string; number: string; status: string | null; active: boolean; where: string };

async function readJobs(orgId: string, uuids: readonly string[]): Promise<Map<string, Job> | null> {
  const { data, error } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, status, active, job_address, geo_city")
    .eq("org_id", orgId)
    .in("uuid", spellings(uuids));
  if (error) return null;
  const out = new Map<string, Job>();
  for (const r of (data ?? []) as { uuid: string; generated_job_id: string | null; status: string | null; active: unknown; job_address: string | null; geo_city: string | null }[]) {
    const street = streetLine(r.job_address);
    out.set(low(r.uuid), {
      uuid: r.uuid,
      number: r.generated_job_id?.trim() || "the job",
      status: r.status,
      active: Number(r.active) === 1,
      where: [street, r.geo_city?.trim()].filter(Boolean).join(", "),
    });
  }
  return out;
}

/** A refusal from the queue, in Book in's words. */
function refusalWords(r: BookingRefusal, zone: string): string {
  const w = BOOKING_WORDS.press;
  switch (r) {
    case "already_booked":
      return "They're already booked on that job at that time.";
    case "kept_other":
      return w.keptOtherFirst;
    case "taking_out":
      return w.takingOut;
    case "in_flight":
      return w.inFlight;
    case "not_yours":
      return fillWords(w.notYours, { name: "whoever made it" });
    case "changed":
    case "no_row":
      return w.changed;
    case "not_future":
      return w.notFuture;
    case "check_in":
      return w.checkIn;
    case "past":
      return w.past;
    case "zone_unknown":
      return w.zoneUnknown;
    case "clocks_forward":
      return fillWords(w.clocksForward, { place: placeName(zone) });
    case "capped":
      return w.capped;
    case "unreadable":
      return w.unreadable;
    case "not_offered":
      return w.kindOff;
    default:
      return w.unqueued;
  }
}

/* ── one change, as steps ── */

type Step = { off: Booking } | { book: { jobUuid: string; staffUuid: string; start: string; end: string } };

/** A time the phone names: on the account's clock, the end after the
    start on the same day. An Undo names the old booking's own times, so
    there is no grid here: the phone's pickers keep to theirs. */
function pickedSlot(start: string, end: string): { start: string; end: string } | null {
  const a = STAMP.exec(start);
  const b = STAMP.exec(end);
  if (!a || !b || a[1] !== b[1] || !(start < end)) return null;
  return { start, end };
}

type Planned = { steps: Step[]; said: string; undo: ScheduleChange | null; tell: { staffUuid: string; title: string; body: string; path: string }[] };

/** What a change does, checked: the bookings it names, as they are now. */
async function plan(orgId: string, press: Sm8Press, change: ScheduleChange, presser: string): Promise<Planned | { error: string; status: number }> {
  const bad = (error: string, status = 400) => ({ error, status });
  const readOne = async (uuid: string) => {
    if (!UUID.test(uuid)) return bad(BOOKING_WORDS.press.changed);
    const b = await readBooking(orgId, press, uuid);
    if (b === "failed") return bad(BOOKING_WORDS.press.unqueued, 503);
    if (!b) return bad(BOOKING_WORDS.press.changed, 409);
    return b;
  };

  const people = async (uuids: string[]) => sm8StaffNames(orgId, uuids);
  const first = (name: string | undefined) => (name ?? "They").split(/\s+/)[0]!;

  switch (change.do) {
    case "move": {
      const b = await readOne(text(change.activity));
      if ("error" in b) return b;
      const to = text(change.to);
      if (!UUID.test(to)) return bad(BOOKING_WORDS.press.jobGone);
      if (same(to, b.jobUuid)) return bad("They're on that job already.");
      const slot = change.start || change.end ? pickedSlot(text(change.start), text(change.end)) : { start: b.start, end: b.end };
      if (!slot) return bad(BOOKING_WORDS.press.unqueued);
      if (slot.start.slice(0, 10) !== b.start.slice(0, 10)) return bad(BOOKING_WORDS.press.crossesMidnight);
      const [jobs, names] = await Promise.all([readJobs(orgId, [to, b.jobUuid]), people([b.staffUuid])]);
      if (!jobs) return bad(BOOKING_WORDS.press.unqueued, 503);
      const toJob = jobs.get(low(to));
      if (!jobs.get(low(b.jobUuid))?.active) return bad(BOOKING_WORDS.press.changed, 409);
      const bookable = bookableWords(toJob);
      if (bookable) return bad(bookable, 409);
      const name = first(names.get(low(b.staffUuid)));
      return {
        steps: [{ book: { jobUuid: toJob!.uuid, staffUuid: b.staffUuid, ...slot } }, { off: b }],
        said: `${name} is on ${toJob!.number} now`,
        /* the new booking's uuid is known once it's queued: filled in then */
        undo: { do: "move", activity: "", to: b.jobUuid, start: b.start, end: b.end },
        tell: [{ staffUuid: b.staffUuid, title: `${presser} moved you to ${toJob!.number}`, body: words(toJob!.where, span(slot.start, slot.end)), path: `/job?id=${toJob!.uuid}` }],
      };
    }
    case "swap": {
      const a = await readOne(text(change.activity));
      if ("error" in a) return a;
      const b = await readOne(text(change.with));
      if ("error" in b) return b;
      if (same(a.staffUuid, b.staffUuid)) return bad("That's the same person twice.");
      if (same(a.jobUuid, b.jobUuid)) return bad("They're on the same job already.");
      if (a.start.slice(0, 10) !== b.start.slice(0, 10)) return bad(BOOKING_WORDS.press.changed);
      const [jobs, names] = await Promise.all([readJobs(orgId, [a.jobUuid, b.jobUuid]), people([a.staffUuid, b.staffUuid])]);
      if (!jobs) return bad(BOOKING_WORDS.press.unqueued, 503);
      const ja = jobs.get(low(a.jobUuid));
      const jb = jobs.get(low(b.jobUuid));
      const refused = bookableWords(ja) ?? bookableWords(jb);
      if (refused) return bad(refused, 409);
      const na = first(names.get(low(a.staffUuid)));
      const nb = first(names.get(low(b.staffUuid)));
      /* each takes the other's job, at the other's times: the job's hours */
      return {
        steps: [
          { book: { jobUuid: jb!.uuid, staffUuid: a.staffUuid, start: b.start, end: b.end } },
          { book: { jobUuid: ja!.uuid, staffUuid: b.staffUuid, start: a.start, end: a.end } },
          { off: a },
          { off: b },
        ],
        said: `${na} is on ${jb!.number} and ${nb} on ${ja!.number} now`,
        undo: { do: "swap", activity: "", with: "" },
        tell: [
          { staffUuid: a.staffUuid, title: `${presser} moved you to ${jb!.number}`, body: words(jb!.where, span(b.start, b.end)), path: `/job?id=${jb!.uuid}` },
          { staffUuid: b.staffUuid, title: `${presser} moved you to ${ja!.number}`, body: words(ja!.where, span(a.start, a.end)), path: `/job?id=${ja!.uuid}` },
        ],
      };
    }
    case "time": {
      const b = await readOne(text(change.activity));
      if ("error" in b) return b;
      const slot = pickedSlot(text(change.start), text(change.end));
      if (!slot) return bad(BOOKING_WORDS.press.unqueued);
      if (slot.start.slice(0, 10) !== b.start.slice(0, 10)) return bad(BOOKING_WORDS.press.crossesMidnight);
      if (slot.start === b.start && slot.end === b.end) return bad("That's the time it is already.");
      /* the same start on one of ours is the same booking to the queue: it
         has to be out of ServiceM8 before a new one can take its place */
      if (slot.start === b.start && b.create) return bad("Change the start as well, or take them off and book them again.");
      const [jobs, names] = await Promise.all([readJobs(orgId, [b.jobUuid]), people([b.staffUuid])]);
      if (!jobs) return bad(BOOKING_WORDS.press.unqueued, 503);
      const job = jobs.get(low(b.jobUuid));
      const refused = bookableWords(job);
      if (refused) return bad(refused, 409);
      const name = first(names.get(low(b.staffUuid)));
      return {
        steps: [{ book: { jobUuid: job!.uuid, staffUuid: b.staffUuid, ...slot } }, { off: b }],
        said: `${name} is on ${job!.number} ${span(slot.start, slot.end)} now`,
        undo: { do: "time", activity: "", start: b.start, end: b.end },
        tell: [{ staffUuid: b.staffUuid, title: `${presser} changed your time on ${job!.number}`, body: words(job!.where, span(slot.start, slot.end)), path: `/job?id=${job!.uuid}` }],
      };
    }
    case "off": {
      const b = await readOne(text(change.activity));
      if ("error" in b) return b;
      const [jobs, names] = await Promise.all([readJobs(orgId, [b.jobUuid]), people([b.staffUuid])]);
      if (!jobs) return bad(BOOKING_WORDS.press.unqueued, 503);
      const job = jobs.get(low(b.jobUuid));
      if (!job?.active) return bad(BOOKING_WORDS.press.changed, 409);
      const name = first(names.get(low(b.staffUuid)));
      const number = job.number;
      return {
        steps: [{ off: b }],
        said: `${name} is off ${number}`,
        undo: { do: "book", staff: b.staffUuid, job: b.jobUuid, start: b.start, end: b.end },
        tell: [{ staffUuid: b.staffUuid, title: `${presser} took you off ${number}`, body: span(b.start, b.end), path: "/schedule" }],
      };
    }
    case "book": {
      const staff = text(change.staff);
      const jobUuid = text(change.job);
      if (!UUID.test(staff) || !UUID.test(jobUuid)) return bad(BOOKING_WORDS.press.unqueued);
      const slot = pickedSlot(text(change.start), text(change.end));
      if (!slot) return bad(BOOKING_WORDS.press.unqueued);
      const [jobs, names, active] = await Promise.all([readJobs(orgId, [jobUuid]), people([staff]), staffActive(orgId, staff)]);
      if (!jobs || active === "failed") return bad(BOOKING_WORDS.press.unqueued, 503);
      const job = jobs.get(low(jobUuid));
      const refused = bookableWords(job);
      if (refused) return bad(refused, 409);
      const name = first(names.get(low(staff)));
      if (!active) return bad(fillWords(BOOKING_WORDS.press.techInactive, { name }), 409);
      return {
        steps: [{ book: { jobUuid: job!.uuid, staffUuid: staff, ...slot } }],
        said: `${name} is on ${job!.number} now`,
        undo: { do: "off", activity: "" },
        tell: [{ staffUuid: staff, title: `${presser} booked you on ${job!.number}`, body: words(job!.where, span(slot.start, slot.end)), path: `/job?id=${job!.uuid}` }],
      };
    }
    default:
      return bad(BOOKING_WORDS.press.unqueued);
  }
}

/** Why a job can't take a booking, or null when it can. */
function bookableWords(job: Job | undefined): string | null {
  if (!job || !job.active || !job.status) return BOOKING_WORDS.press.jobGone;
  if (job.status !== "Quote" && job.status !== "Work Order") return fillWords(BOOKING_WORDS.press.notBookable, { status: job.status });
  return null;
}

const words = (where: string, when: string) => (where ? `${where} · ${when}` : when);

async function staffActive(orgId: string, uuid: string): Promise<boolean | "failed"> {
  const { data, error } = await supabaseAdmin.from("sm8_staff").select("uuid, active").eq("org_id", orgId).in("uuid", spellings([uuid]));
  if (error) return "failed";
  return ((data ?? []) as { uuid: string; active: unknown }[]).some((r) => same(r.uuid, uuid) && Number(r.active) === 1);
}

/* ── the press ── */

/** Make one change, through the queue: everything it books, then
    everything it takes off; one refused takes back what this press queued.
    `tell` pushes to the people it moves. */
export async function changeSchedule(
  ctx: MobileCtx,
  pressed: Sm8Press | null,
  input: { change: ScheduleChange; tell: boolean },
  opts: { push?: typeof pushToStaff } = {}
): Promise<ChangeAnswer> {
  const g = await gate(ctx, pressed);
  if (!g.ok) return g;
  const { press, state, zone } = g;
  const orgId = ctx.orgId;

  const presser = (press.staffId ? (await staffDisplayNames(orgId, [press.staffId])).get(press.staffId) : undefined) ?? "Someone";
  const planned = await plan(orgId, press, input.change, presser);
  if ("error" in planned) return { ok: false, error: planned.error, status: planned.status };

  const verbId = randomUUID();
  const creates: { rowId: string; step: Extract<Step, { book: unknown }>["book"] }[] = [];
  const offs: string[] = [];
  const takeBackCreates = async () => {
    for (const c of creates) await queueBookingTakeBack(press, state, { createRowId: c.rowId, anyTime: true }).catch(() => null);
  };

  /** Queue the new bookings, one job at a time. A refusal says why. */
  const queueCreates = async (): Promise<string | null> => {
    for (const s of planned.steps) {
      if (!("book" in s)) continue;
      const r = await queueBookIn(press, state, {
        jobUuid: s.book.jobUuid,
        verbId,
        zone,
        status: null,
        slots: [{ staffUuid: s.book.staffUuid, start: s.book.start, end: s.book.end }],
        anyTime: true,
      });
      if (!r.ok) return refusalWords(r.refusal, zone);
      if (r.rowIds.length === 0) return BOOKING_WORDS.press.onItsWay;
      creates.push({ rowId: r.rowIds[0]!, step: s.book });
    }
    return null;
  };
  /** Queue what comes off: a booking of yours by its Undo, anything else by Take off. */
  const queueOffs = async (): Promise<string | null> => {
    for (const s of planned.steps) {
      if (!("off" in s)) continue;
      const b = s.off;
      const r = b.create
        ? await queueBookingTakeBack(press, state, { createRowId: b.create, anyTime: true })
        : await queueTakeOff(press, state, { jobUuid: b.jobUuid, activityUuid: b.uuid, seen: { staffUuid: b.staffUuid, start: b.start, end: b.end }, verbId, anyTime: true });
      if (!r.ok) return refusalWords(r.refusal, zone);
      offs.push(...r.rowIds);
    }
    return null;
  };
  /** Send some rows in the foreground for a moment, and read where each stands. */
  type Stands = { id: string; op: string; status: string; last_error: string | null; remote_uuid: string };
  const settle = async (ids: string[]): Promise<Stands[] | null> => {
    if (ids.length === 0) return [];
    try {
      await settlePressedWrites(orgId, ids, { startedAt: Date.now(), budgetMs: BOOKING_PRESS_BUDGET_MS });
    } catch (err) {
      console.error(`[mobile] a schedule change for org ${orgId} couldn't settle: ${err instanceof Error ? err.message : String(err)}`);
    }
    const { data, error } = await supabaseAdmin.from("sm8_writes").select("id, op, status, last_error, remote_uuid").eq("org_id", orgId).in("id", ids);
    return error ? null : ((data ?? []) as Stands[]);
  };
  const bad = (rows: Stands[]) => rows.filter((r) => r.status === "failed" || r.status === "cancelled");
  const refused = (rows: Stands[]): ChangeAnswer => ({
    ok: false,
    error: bad(rows)[0]!.last_error ?? BOOKING_WORDS.press.unqueued,
    status: 409,
    retry: bad(rows).map((r) => r.id),
  });

  /* THE NEW BOOKING FIRST, AND THE OLD ONE OFF ONLY ONCE IT'S IN: a change
     that fails half way leaves someone booked twice, never on nothing. The
     one exception is a booking taking the place of the one coming off — the
     same person, job and start — which ServiceM8 refuses while the old one
     stands: there the old one comes off first. */
  const replaces = planned.steps.some(
    (s) => "book" in s && planned.steps.some((o) => "off" in o && same(o.off.jobUuid, s.book.jobUuid) && same(o.off.staffUuid, s.book.staffUuid) && o.off.start === s.book.start)
  );
  let rows: Stands[] = [];
  if (!replaces) {
    const why = await queueCreates();
    if (why) {
      await takeBackCreates();
      return { ok: false, error: why, status: 409 };
    }
    const went = await settle(creates.map((c) => c.rowId));
    if (!went) return { ok: true, state: "waiting", said: planned.said, undo: null };
    if (bad(went).length > 0) {
      await takeBackCreates();
      return { ok: false, error: bad(went)[0]!.last_error ?? BOOKING_WORDS.press.unqueued, status: 409 };
    }
    const off = await queueOffs();
    if (off) {
      await takeBackCreates();
      return { ok: false, error: off, status: 409 };
    }
    const out = await settle(offs);
    if (!out) return { ok: true, state: "waiting", said: planned.said, undo: null };
    rows = [...went, ...out];
    if (bad(out).length > 0) return refused(out);
  } else {
    const off = await queueOffs();
    if (off) return { ok: false, error: off, status: 409 };
    const out = await settle(offs);
    if (!out) return { ok: true, state: "waiting", said: planned.said, undo: null };
    if (bad(out).length > 0) return refused(out);
    const why = await queueCreates();
    if (why) return { ok: false, error: why, status: 409 };
    const went = await settle(creates.map((c) => c.rowId));
    if (!went) return { ok: true, state: "waiting", said: planned.said, undo: null };
    rows = [...out, ...went];
    if (bad(went).length > 0) return refused(went);
  }
  const st: "sent" | "waiting" | "trial" = rows.every((r) => r.status === "trial") && rows.length > 0 ? "trial" : rows.every((r) => r.status === "sent") ? "sent" : "waiting";

  /* 5. tell them, where the presser left Tell on, and it isn't the presser */
  if (input.tell && st !== "trial") {
    const links = state.tenantId ? await listSm8StaffLinks(orgId, state.tenantId).catch(() => []) : [];
    const push = opts.push ?? pushToStaff;
    for (const t of planned.tell) {
      const card = links.find((l) => same(l.remoteId, t.staffUuid))?.staffProfileId;
      if (!card || card === press.staffId) continue;
      await push(orgId, [card], { title: t.title, body: t.body, path: t.path });
    }
  }

  return { ok: true, state: st, said: planned.said, undo: undoOf(planned.undo, creates, rows) };
}

/** The Undo of a change, with the uuids its new bookings went under. */
function undoOf(
  undo: ScheduleChange | null,
  creates: { rowId: string }[],
  rows: { id: string; remote_uuid: string }[]
): ScheduleChange | null {
  if (!undo) return null;
  const uuidOf = (i: number) => rows.find((r) => r.id === creates[i]?.rowId)?.remote_uuid ?? "";
  switch (undo.do) {
    case "move":
    case "time":
    case "off":
      return uuidOf(0) ? { ...undo, activity: uuidOf(0) } : null;
    case "swap":
      return uuidOf(0) && uuidOf(1) ? { do: "swap", activity: uuidOf(0), with: uuidOf(1) } : null;
    default:
      return undo;
  }
}

/** Try again on what a change left undone: each row through its one door. */
export async function retryScheduleChange(ctx: MobileCtx, pressed: Sm8Press | null, rowIds: readonly string[]): Promise<ChangeAnswer> {
  const startedAt = Date.now();
  const g = await gate(ctx, pressed);
  if (!g.ok) return g;
  const ids = [...new Set(rowIds.map(text).filter((id) => UUID.test(id)))].slice(0, 8);
  if (ids.length === 0) return { ok: false, error: BOOKING_WORDS.press.unqueued, status: 400 };
  const queued: string[] = [];
  for (const id of ids) {
    const r = await queueBookingRetry(g.press, g.state, { rowId: id });
    if (!r.ok) return { ok: false, error: refusalWords(r.refusal, g.zone), status: 409 };
    queued.push(...r.rowIds);
  }
  try {
    await settlePressedWrites(ctx.orgId, queued, { startedAt, budgetMs: BOOKING_PRESS_BUDGET_MS });
  } catch (err) {
    console.error(`[mobile] a schedule retry for org ${ctx.orgId} couldn't settle: ${err instanceof Error ? err.message : String(err)}`);
  }
  const { data } = await supabaseAdmin.from("sm8_writes").select("id, status, last_error").eq("org_id", ctx.orgId).in("id", ids);
  const rows = (data ?? []) as { id: string; status: string; last_error: string | null }[];
  const failed = rows.filter((r) => r.status === "failed" || r.status === "cancelled");
  if (failed.length) return { ok: false, error: failed[0]!.last_error ?? BOOKING_WORDS.press.unqueued, status: 409, retry: failed.map((r) => r.id) };
  return { ok: true, state: rows.every((r) => r.status === "sent") ? "sent" : "waiting", said: "Done", undo: null };
}
