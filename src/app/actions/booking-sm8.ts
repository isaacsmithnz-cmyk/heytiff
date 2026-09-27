"use server";

/* BOOKING A JOB IN SERVICEM8 (two-way phase 3, PR C).

   What a person presses to book a job in ServiceM8, and what the job card
   reads to say where each booking stands: the Book in panel's live read,
   Book in itself, Undo (and Cancel booking), Try again, Clear on a
   finished job's leftover booking, and the card's poll. Every one is a
   Server Function, so every one is reachable by direct POST: what the
   browser sends only names things, and is compared. The queue helpers
   (sm8-booking-queue) are the one door a booking row goes through, and the
   sender (sm8-booking-send) reads ServiceM8 live again before anything
   goes.

   NOTHING HERE WRITES TO SERVICEM8. These actions queue, through the
   helpers, and the queue's sender writes — reading every booking live
   before any DELETE and after it, because ServiceM8's DELETE of a record
   already removed puts it back (the notes walk, 2026-09-27). The only
   ServiceM8 calls made here are the panel's reads (sm8-booking-read).

   THE GATES, IN ORDER, ON EVERY ACTION:
   0. the deployment books (SM8_WRITES names `booking`). Production doesn't,
      and there every action answers before its first read: no session, no
      database, no ServiceM8;
   1. `workboard_manage` — except the poll, which needs only `workboard`:
      anyone who can open the card reads its lines;
   2. an owner, while BOOKINGS_OPEN_TO_MANAGERS is false (the walk first,
      DECISIONS 7) — not for the poll;
   3. a press minted from the session, for this workspace — not for the
      poll, which queues nothing.

   EVERY PRESS DRAINS: what it queued is sent in the foreground for a
   moment, the rest behind the answer (settlePressedWrites), and a settle
   that throws never fails the press. THE POLL NEVER DRAINS: it sends only
   a verb left half way — its own job's bookings queued behind a status
   change that went, while every one of them is untried — and nothing else.

   TIME IS THE ACCOUNT'S WALL CLOCK, as text, never converted: whether a
   start has passed, or is far enough off to make the job a Work Order
   first, is sm8-booking-plan's isFuture, and nothing here works it out
   again. A time the account's clocks skip going forward is refused by the
   queue, in the clocks' words (press.clocksForward).

   Words come from BOOKING_WORDS, and a failed read says sm8-read's. Ids in,
   states out: the job card, the Schedule and Home call these as they are
   (PR D, PR E). */

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can, getDbRole, requireOrg } from "@/lib/permissions-server";
import { sm8PressFromSession, type Sm8Press } from "@/lib/integrations/sm8-press";
import { sm8BookingsAllowed } from "@/lib/integrations/sm8-kinds";
import { readSm8WriteState, runSm8Writes } from "@/lib/integrations/sm8-writes";
import { offersSend, sendHold, sendRefusal, type SendHold, type Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import { settlePressedWrites } from "@/lib/integrations/sm8-drain";
import { fillWords } from "@/lib/integrations/sm8-note-words";
import { listSm8StaffLinks, sm8DeniedLinks } from "@/lib/integrations/links";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import {
  BOOKING_CONTEXT_TTL_MS,
  BOOKING_LENGTHS_MIN,
  BOOKING_PRESS_BUDGET_MS,
  BOOKING_STATUS_LEAD_MS,
  BOOKING_STATUS_WAIT_MS,
  BOOKING_STEP_MIN,
  BOOKING_WORDS,
  BOOKINGS_OPEN_TO_MANAGERS,
  BOOKINGS_PER_PRESS,
  isFuture,
  localNow,
  placeName,
  slotOf,
  type BookingState,
} from "@/lib/integrations/sm8-booking-plan";
import {
  bookingZone,
  readBookingContext,
  readBookingLines,
  sm8StaffNames,
  type LiveActivity,
  type VerbView,
} from "@/lib/integrations/sm8-booking-read";
import {
  queueBookIn,
  queueBookingRetry,
  queueBookingTakeBack,
  queueClear,
  type BookInSlot,
  type BookingRefusal,
} from "./sm8-booking-queue";

export type { VerbLine, VerbView } from "@/lib/integrations/sm8-booking-read";

/** The panel's live read: what Book in is checked against. */
export type BookInContext =
  | {
      ok: true;
      /** Always true: where bookings aren't offered it is refused instead,
          in sendRefusal's words, before ServiceM8 is read. */
      offered: true;
      /** Sending is a trial run: nothing goes, everything is checked. */
      trial: boolean;
      /** What holds what is booked now (a pause, a reconnect). */
      hold: SendHold;
      /** The account's zone, and its today on that clock. */
      zone: string;
      today: string;
      job: { uuid: string; number: string | null; status: "Quote" | "Work Order"; editDate: string | null };
      /** Every active activity on the job, as ServiceM8 has it now. */
      bookings: LiveActivity[];
      /** Each day asked: everything on it, for everyone; null, unread. */
      days: Record<string, LiveActivity[] | null>;
      /** The job number of each job in `bookings` and `days`, by lower-case
          uuid, as the mirror has it: "That overlaps job {number}…". */
      jobNumbers: Record<string, string>;
      /** Who can be booked: ServiceM8's active people — you first, then
          those linked to HeyTiff, then everyone else, each A to Z. */
      staff: { uuid: string; name: string; you: boolean; linked: boolean }[];
      /** When ServiceM8 was read (ISO); Book in hands it back. */
      readAt: string;
    }
  | { ok: false; error: string };

/** `rowIds`: the rows the press queued (or, pressed again, had queued) —
    what the card polls for, whatever `verb` could be read to say. */
export type BookJobInResult =
  | { ok: true; verb: VerbView; rowIds: string[] }
  | { ok: false; error: string; lookAgain?: true };

/** A line's own press (Undo, Cancel booking, Try again, Clear): the line
    it reads now — null once there is nothing to say. */
export type BookingLineResult =
  | { ok: true; line: BookingState | null }
  | { ok: false; error: string; line?: BookingState | null; lookAgain?: true };

/** What the card's poll reads: every press on the job, the line on each
    standing booking of ours by lower-case uuid, and the bookings of the job
    we removed (lower case), which the card hides. */
export type BookingStates = { verbs: VerbView[]; lines: Record<string, BookingState>; gone: string[] };

const WB = "/dashboard/workboard";
/* Home's list takes a job that went off it at once (the overlay, PR E) */
const HOME = "/dashboard";
const revalidateBookings = () => {
  revalidatePath(WB);
  revalidatePath(HOME);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDIT_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** How far ahead of this server's clock a panel's `readAt` may be: it was
    stamped by whichever server read ServiceM8 for the panel. */
const CLOCK_SKEW_MS = 60_000;

/** The names said when ServiceM8, or HeyTiff, has none for someone. */
const THAT_PERSON = "That person";
const THE_PERSON = "the person";

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const low = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
/** Every spelling a mirror row's uuid may carry, for an `in` filter. */
const spellings = (uuids: readonly (string | null | undefined)[]) =>
  [...new Set(uuids.flatMap((u) => (u ? [u.trim(), low(u), u.trim().toUpperCase()] : [])))];

/* ── the gates ── */

type Gated = { ok: true; orgId: string; press: Sm8Press } | { ok: false; error: string };

/** Gates 0 to 3 (the header), for every action but the poll. */
async function gate(): Promise<Gated> {
  if (!sm8BookingsAllowed()) return { ok: false, error: BOOKING_WORDS.press.unavailable };
  let orgId: string;
  try {
    ({ orgId } = await requireOrg("workboard_manage"));
  } catch {
    return { ok: false, error: BOOKING_WORDS.press.noManage };
  }
  /* a role or a session that can't be read refuses, as requireOrg's throw
     does: nothing here escapes as a server error */
  let role: Awaited<ReturnType<typeof getDbRole>>;
  let press: Sm8Press | null;
  try {
    role = BOOKINGS_OPEN_TO_MANAGERS ? null : await getDbRole();
    press = await sm8PressFromSession();
  } catch {
    return { ok: false, error: BOOKING_WORDS.press.noManage };
  }
  if (!BOOKINGS_OPEN_TO_MANAGERS && role !== "owner") return { ok: false, error: BOOKING_WORDS.press.ownerOnly };
  if (!press || press.orgId !== orgId) return { ok: false, error: BOOKING_WORDS.press.noManage };
  return { ok: true, orgId, press };
}

/** Whether the viewer may press a door at all: Workboard manage, and the
    owner while bookings are the owner's (spec 1.1). A viewer who may not
    reads the lines with no door but Open in ServiceM8. Doubt is no. */
async function mayPress(): Promise<boolean> {
  try {
    if (!(await can("workboard_manage"))) return false;
    return BOOKINGS_OPEN_TO_MANAGERS || (await getDbRole()) === "owner";
  } catch {
    return false;
  }
}

/** Why bookings aren't offered here, in the owner's order of fixes. */
const notOffered = (state: Sm8WriteState) => sendRefusal(state, "booking") ?? BOOKING_WORDS.press.kindOff;

/* ── what a refusal says ── */

type Refused = { refusal: BookingRefusal; slot?: BookInSlot; presser?: string | null };

/** A queue helper's refusal of one press, said to whoever pressed. */
async function refusedWords(orgId: string, state: Sm8WriteState, r: Refused, doing: "book" | "take_back" | "clear" | "retry"): Promise<string> {
  switch (r.refusal) {
    case "already_booked": {
      const name = r.slot ? (await sm8StaffNames(orgId, [r.slot.staffUuid])).get(low(r.slot.staffUuid)) : undefined;
      return fillWords(BOOKING_WORDS.press.sameSlot, { name: name ?? THAT_PERSON });
    }
    case "not_yours": {
      const name = r.presser ? (await staffDisplayNames(orgId, [r.presser])).get(r.presser) : undefined;
      return fillWords(BOOKING_WORDS.press.notYours, { name: name ?? THE_PERSON });
    }
    case "kept_other":
      return BOOKING_WORDS.press.keptOtherFirst;
    case "taking_out":
      return BOOKING_WORDS.press.takingOut;
    case "in_flight":
      return BOOKING_WORDS.press.inFlight;
    /* a take-back refused because someone moved the booking in ServiceM8
       says so; anything else changed says Look again */
    case "changed":
      return doing === "take_back" ? BOOKING_WORDS.press.changedNoUndo : BOOKING_WORDS.press.changed;
    case "no_row":
      return BOOKING_WORDS.press.changed;
    case "not_future":
      return BOOKING_WORDS.press.notFuture;
    case "not_leftover":
      return BOOKING_WORDS.press.notLeftover;
    case "check_in":
      return BOOKING_WORDS.press.checkIn;
    case "past":
      return BOOKING_WORDS.press.past;
    case "too_soon":
      return BOOKING_WORDS.press.tooSoon;
    case "zone_unknown":
      return BOOKING_WORDS.press.zoneUnknown;
    case "clocks_forward": {
      const zone = (await bookingZone(orgId)).zone;
      return zone ? fillWords(BOOKING_WORDS.press.clocksForward, { place: placeName(zone) }) : BOOKING_WORDS.press.zoneUnknown;
    }
    case "capped":
      return BOOKING_WORDS.press.capped;
    case "unreadable":
      return BOOKING_WORDS.press.unreadable;
    case "not_offered":
      return notOffered(state);
    case "unqueued":
    default:
      return BOOKING_WORDS.press.unqueued;
  }
}

/* ── after a press ── */

/** The press's rows, sent in the foreground for a moment, then the drain. */
async function settle(orgId: string, ids: readonly string[], startedAt: number): Promise<void> {
  try {
    await settlePressedWrites(orgId, ids, { startedAt, budgetMs: BOOKING_PRESS_BUDGET_MS });
  } catch (err) {
    console.error(`[sm8] a booking press for org ${orgId} couldn't settle: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** One row's line as it reads now, for `userId`: a booking's, or a
    Clear's. Null once there is nothing to say. */
async function lineNow(orgId: string, jobUuid: string, rowId: string, userId: string): Promise<BookingState | null> {
  const read = await readBookingLines(orgId, await readSm8WriteState(orgId), jobUuid, userId);
  for (const v of read.verbs) for (const b of v.bookings) if (b.rowId === rowId) return b.state;
  return null;
}

type RowHead = { id: string; op: string; depends_on: string | null; sm8_job_uuid: string | null };

/** A booking row of this workspace, as far as a press on a line names it. */
async function readHead(orgId: string, id: string): Promise<RowHead | null | "failed"> {
  const { data, error } = await supabaseAdmin
    .from("sm8_writes")
    .select("id, op, depends_on, sm8_job_uuid")
    .eq("org_id", orgId)
    .eq("kind", "booking")
    .eq("id", id)
    .maybeSingle();
  if (error) return "failed";
  return (data as RowHead | null) ?? null;
}

/* ── the panel's live read ── */

/** ServiceM8's active people, for the panel's Who: the viewer's own link
    first ("You", unless they said it isn't them), then the people linked to
    HeyTiff, then everyone else, each A to Z. Null when it couldn't be read. */
async function staffChoices(
  orgId: string,
  tenantId: string | null,
  viewerStaffId: string | null
): Promise<{ uuid: string; name: string; you: boolean; linked: boolean }[] | null> {
  const { data, error } = await supabaseAdmin.from("sm8_staff").select("uuid, first, last").eq("org_id", orgId).eq("active", 1);
  if (error) return null;
  const links = tenantId ? await listSm8StaffLinks(orgId, tenantId) : [];
  const linked = new Set(links.map((l) => low(l.remoteId)));
  const mine = viewerStaffId ? links.find((l) => l.staffProfileId === viewerStaffId) : undefined;
  const denied = mine && tenantId ? new Set([...(await sm8DeniedLinks(orgId, tenantId))].map(low)) : new Set<string>();
  const you = mine && !denied.has(low(mine.remoteId)) ? low(mine.remoteId) : null;
  const staff = ((data ?? []) as { uuid: string; first: unknown; last: unknown }[]).flatMap((r) => {
    const name = [r.first, r.last].filter((p): p is string => typeof p === "string" && !!p.trim()).map((p) => p.trim()).join(" ");
    return name && r.uuid ? [{ uuid: r.uuid, name, you: low(r.uuid) === you, linked: linked.has(low(r.uuid)) }] : [];
  });
  const rank = (s: { you: boolean; linked: boolean }) => (s.you ? 0 : s.linked ? 1 : 2);
  return staff.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** Each of these jobs' numbers, by lower-case uuid, as the mirror has them.
    Advice: a read that fails names none. */
async function jobNumbersOf(orgId: string, uuids: readonly (string | null)[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const wanted = [...new Set(uuids.filter((u): u is string => !!u && !!u.trim()))];
  for (let i = 0; i < wanted.length; i += 50) {
    const { data, error } = await supabaseAdmin
      .from("sm8_jobs")
      .select("uuid, generated_job_id")
      .eq("org_id", orgId)
      .in("uuid", spellings(wanted.slice(i, i + 50)));
    if (error) return out;
    for (const r of (data ?? []) as { uuid: string; generated_job_id: unknown }[]) {
      if (typeof r.generated_job_id === "string" && r.generated_job_id.trim()) out[low(r.uuid)] = r.generated_job_id.trim();
    }
  }
  return out;
}

/** What the Book in panel checks against, read from ServiceM8 itself: the
    job, its bookings and each day's (sm8-booking-read), with who can be
    booked and the account's clock. A job that isn't a Quote or a Work
    Order, or a zone HeyTiff doesn't know, is refused here, before the panel
    offers anything. */
export async function readBookInContext(input: { jobUuid: string; days: string[] }): Promise<BookInContext> {
  const g = await gate();
  if (!g.ok) return g;
  const { orgId, press } = g;
  const jobUuid = text(input?.jobUuid);
  if (!UUID.test(jobUuid)) return { ok: false, error: BOOKING_WORDS.press.jobGone };

  const state = await readSm8WriteState(orgId);
  if (!offersSend(state, "booking")) return { ok: false, error: notOffered(state) };
  /* no zone, no booking: there is no fallback. A zone that couldn't be read
     from HeyTiff's own database is a read that failed, not an account with
     none (ServiceM8's own failures say sm8-read's words) */
  const z = await bookingZone(orgId);
  if (z.zone === null) return { ok: false, error: z.why === "unread" ? BOOKING_WORDS.panel.readFailed : BOOKING_WORDS.press.zoneUnknown };
  const zone = z.zone;

  const now = Date.now();
  const read = await readBookingContext(orgId, jobUuid, Array.isArray(input?.days) ? input.days : [], now);
  if (!read.ok) return read;
  const { job, bookings, days, readAt } = read.data;
  if (!job || job.active !== 1 || !job.status) return { ok: false, error: BOOKING_WORDS.press.jobGone };
  if (job.status !== "Quote" && job.status !== "Work Order") {
    return { ok: false, error: fillWords(BOOKING_WORDS.press.notBookable, { status: job.status }) };
  }
  const today = localNow(zone, now)?.slice(0, 10);
  if (!today) return { ok: false, error: BOOKING_WORDS.press.zoneUnknown };

  const onDays = Object.values(days).flatMap((d) => d ?? []);
  const [staff, jobNumbers] = await Promise.all([
    staffChoices(orgId, state.tenantId, press.staffId),
    jobNumbersOf(orgId, [jobUuid, ...bookings.map((a) => a.jobUuid), ...onDays.map((a) => a.jobUuid)]),
  ]);
  if (!staff) return { ok: false, error: BOOKING_WORDS.panel.readFailed };
  if (job.kept.generated_job_id) jobNumbers[low(jobUuid)] = job.kept.generated_job_id;

  return {
    ok: true,
    offered: true,
    trial: state.mode === "trial",
    hold: sendHold(state, "booking"),
    zone,
    today,
    job: { uuid: job.uuid, number: job.kept.generated_job_id, status: job.status, editDate: job.editDate },
    bookings,
    days,
    jobNumbers,
    staff,
    readAt,
  };
}

/* ── Book in ── */

/** Book one job in: a booking per person and time, after the job's change
    to a Work Order when the press ticked Make it a Work Order. The steps
    are the spec's (2.11): offered; the shape; the zone and the times; the
    job, from the mirror; fresh enough, as advice; queue; settle; answer
    with the press's lines. A second press of the same Book in (the same
    press id, once its bookings are queued) answers with the same lines and
    queues nothing. */
export async function bookJobIn(input: {
  jobUuid: string;
  pressId: string;
  seen: { jobEditDate: string | null; readAt: string };
  makeWorkOrder: boolean;
  bookings: { staffUuid: string; day: string; start: string; minutes: number }[];
}): Promise<BookJobInResult> {
  const startedAt = Date.now();
  const g = await gate();
  if (!g.ok) return g;
  const { orgId, press } = g;

  /* 1. offered */
  const state = await readSm8WriteState(orgId);
  if (!offersSend(state, "booking")) return { ok: false, error: notOffered(state) };

  const jobUuid = text(input?.jobUuid);
  const pressId = text(input?.pressId);
  if (!UUID.test(pressId)) return { ok: false, error: BOOKING_WORDS.press.unqueued };
  if (!UUID.test(jobUuid)) return { ok: false, error: BOOKING_WORDS.press.jobGone };

  /* a second press of this very Book in, by the same person: its bookings
     are queued already, under the job in whatever spelling it went */
  const { data: mine, error: mineError } = await supabaseAdmin
    .from("sm8_writes")
    .select("id, sm8_job_uuid")
    .eq("org_id", orgId)
    .eq("kind", "booking")
    .eq("op", "create")
    .in("sm8_job_uuid", spellings([jobUuid]))
    .eq("verb_id", pressId)
    .eq("requested_by_user", press.userId);
  const again = mineError
    ? []
    : ((mine ?? []) as { id: string; sm8_job_uuid: string }[]).filter((r) => low(r.sm8_job_uuid) === low(jobUuid));
  if (again.length > 0) {
    await settle(orgId, [], startedAt);
    const verb = await verbOf(orgId, again[0].sm8_job_uuid, pressId, press.userId, startedAt);
    return { ok: true, verb, rowIds: again.map((r) => r.id) };
  }

  /* 2. the shape */
  const asked = Array.isArray(input?.bookings) ? input.bookings : [];
  if (asked.length === 0) return { ok: false, error: BOOKING_WORDS.press.unqueued };
  if (asked.length > BOOKINGS_PER_PRESS) return { ok: false, error: BOOKING_WORDS.press.tooMany };
  const makeWorkOrder = input?.makeWorkOrder === true;
  const slots: BookInSlot[] = [];
  const pressed = new Set<string>();
  for (const b of asked) {
    const staffUuid = text(b?.staffUuid);
    const day = text(b?.day);
    const start = text(b?.start);
    const minutes = b?.minutes;
    const hhmm = HHMM.exec(start);
    /* a person, a real day (one slot of it exists), a start on the grid, a
       length the panel offers: anything else came from no panel */
    if (
      !UUID.test(staffUuid) ||
      !DAY.test(day) ||
      !slotOf(day, "00:00", BOOKING_STEP_MIN) ||
      !hhmm ||
      Number(hhmm[2]) % BOOKING_STEP_MIN !== 0 ||
      typeof minutes !== "number" ||
      !(BOOKING_LENGTHS_MIN as readonly number[]).includes(minutes)
    ) {
      return { ok: false, error: BOOKING_WORDS.press.unqueued };
    }
    const slot = slotOf(day, start, minutes);
    if (!slot) return { ok: false, error: BOOKING_WORDS.press.crossesMidnight };
    const key = `${low(staffUuid)} ${slot.start}`;
    if (pressed.has(key)) return { ok: false, error: BOOKING_WORDS.press.twice };
    pressed.add(key);
    slots.push({ staffUuid, start: slot.start, end: slot.end });
  }
  const people = await readPeople(orgId, slots.map((s) => s.staffUuid));
  if (!people) return { ok: false, error: BOOKING_WORDS.press.unqueued };
  for (const s of slots) {
    const p = people.get(low(s.staffUuid));
    if (!p) return { ok: false, error: BOOKING_WORDS.press.changed, lookAgain: true };
    if (p.active !== 1) return { ok: false, error: fillWords(BOOKING_WORDS.press.techInactive, { name: p.name ?? THAT_PERSON }) };
  }
  const seenEdit = typeof input?.seen?.jobEditDate === "string" && EDIT_STAMP.test(input.seen.jobEditDate) ? input.seen.jobEditDate : null;
  /* the status change's subject and shape need the edit time it was seen at */
  if (makeWorkOrder && !seenEdit) return { ok: false, error: BOOKING_WORDS.press.changed, lookAgain: true };

  /* 3. the zone, and the times on its clock */
  const z = await bookingZone(orgId);
  if (z.zone === null) return { ok: false, error: z.why === "unread" ? BOOKING_WORDS.press.unreadable : BOOKING_WORDS.press.zoneUnknown };
  const zone = z.zone;
  /* a start or an end in the hour the clocks skip going forward is the
     queue's refusal (queueBookIn, clocks_forward), said in the clocks'
     words below */
  if (slots.some((s) => !isFuture(s.start, zone, startedAt))) return { ok: false, error: BOOKING_WORDS.press.past };
  /* the status change goes only ahead of a booking 10 minutes off, and may
     wait 2 minutes for its bookings: 12 minutes ahead, or more */
  const lead = startedAt + BOOKING_STATUS_LEAD_MS + BOOKING_STATUS_WAIT_MS - 1;
  if (makeWorkOrder && slots.some((s) => !isFuture(s.start, zone, lead))) return { ok: false, error: BOOKING_WORDS.press.tooSoon };

  /* 4. the job, from the mirror */
  const job = await readMirrorJob(orgId, jobUuid);
  if (job === "failed") return { ok: false, error: BOOKING_WORDS.press.unqueued };
  if (!job || job.active !== 1 || !job.status) return { ok: false, error: BOOKING_WORDS.press.jobGone };
  if (job.status !== "Quote" && job.status !== "Work Order") return { ok: false, error: fillWords(BOOKING_WORDS.press.notBookable, { status: job.status }) };

  /* 5. fresh enough, as advice: both come from the browser, and the sender
     reads the job live again before any status change */
  const age = startedAt - Date.parse(text(input?.seen?.readAt));
  if (!(age >= -CLOCK_SKEW_MS && age <= BOOKING_CONTEXT_TTL_MS)) return { ok: false, error: BOOKING_WORDS.press.stale, lookAgain: true };
  if (seenEdit && job.editDate && job.editDate > seenEdit) return { ok: false, error: BOOKING_WORDS.press.changed, lookAgain: true };

  /* 6. queue: the status change follows the tick alone, whatever the job —
     under the job's own uuid, as the mirror spells it, so two spellings of
     one job are one slot */
  const queued = await queueBookIn(press, state, {
    jobUuid: job.uuid,
    verbId: pressId,
    zone,
    status: makeWorkOrder && seenEdit ? { seenEditDate: seenEdit } : null,
    slots,
  });
  if (!queued.ok) return { ok: false, error: await refusedWords(orgId, state, queued, "book") };
  /* every booking asked for is on its way under an earlier press */
  if (queued.rowIds.length === 0) return { ok: false, error: BOOKING_WORDS.press.onItsWay };
  revalidateBookings();

  /* 7. settle */
  await settle(orgId, queued.rowIds, startedAt);

  /* 8. the press's lines, read after the settle */
  return { ok: true, verb: await verbOf(orgId, job.uuid, pressId, press.userId, startedAt), rowIds: queued.rowIds };
}

/** A press's verb on the job as it reads now. Empty when nothing of it has
    a line to say, or the lines couldn't be read: the answer's `rowIds` still
    say what the press queued, so the card polls for them. */
async function verbOf(orgId: string, jobUuid: string, pressId: string, userId: string, at: number): Promise<VerbView> {
  const read = await readBookingLines(orgId, await readSm8WriteState(orgId), jobUuid, userId);
  return (
    read.verbs.find((v) => v.presses.includes(pressId)) ?? {
      verbId: pressId,
      presses: [pressId],
      at: new Date(at).toISOString(),
      status: null,
      bookings: [],
    }
  );
}

/** Each of these ServiceM8 people as the mirror has them, by lower-case
    uuid. Null when it couldn't be read. */
async function readPeople(orgId: string, uuids: readonly string[]): Promise<Map<string, { active: number | null; name: string | null }> | null> {
  const { data, error } = await supabaseAdmin
    .from("sm8_staff")
    .select("uuid, first, last, active")
    .eq("org_id", orgId)
    .in("uuid", spellings(uuids));
  if (error) return null;
  const out = new Map<string, { active: number | null; name: string | null }>();
  for (const r of (data ?? []) as { uuid: string; first: unknown; last: unknown; active: unknown }[]) {
    const name = [r.first, r.last].filter((p): p is string => typeof p === "string" && !!p.trim()).map((p) => p.trim()).join(" ");
    out.set(low(r.uuid), { active: r.active == null ? null : Number(r.active), name: name || null });
  }
  return out;
}

/** The job as the mirror has it: whether it is active, its status and its
    edit time. */
async function readMirrorJob(
  orgId: string,
  jobUuid: string
): Promise<{ uuid: string; active: number | null; status: string | null; editDate: string | null } | null | "failed"> {
  const { data, error } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, active, status, edit_date")
    .eq("org_id", orgId)
    .in("uuid", spellings([jobUuid]));
  if (error) return "failed";
  const r = ((data ?? []) as { uuid: string; active: unknown; status: unknown; edit_date: unknown }[]).find((x) => low(x.uuid) === low(jobUuid));
  if (!r) return null;
  return {
    uuid: r.uuid,
    active: r.active == null ? null : Number(r.active),
    status: typeof r.status === "string" ? r.status : null,
    editDate: typeof r.edit_date === "string" ? r.edit_date : null,
  };
}

/* ── a line's own presses ── */

/** Undo (Cancel booking, before it went): take one of your bookings back —
    stopped if it hasn't gone, taken out of ServiceM8 if it may be there.
    Only whoever booked it; never once it has started; never once someone
    changed it in ServiceM8 (queueBookingTakeBack carries every rule). One
    already on its way out answers with its line, and queues nothing more. */
export async function takeBackBooking(input: { jobUuid: string; rowId: string }): Promise<BookingLineResult> {
  const startedAt = Date.now();
  const g = await gate();
  if (!g.ok) return g;
  const { orgId, press } = g;
  const jobUuid = text(input?.jobUuid);
  const rowId = text(input?.rowId);
  if (!UUID.test(jobUuid) || !UUID.test(rowId)) return { ok: false, error: BOOKING_WORDS.press.changed };
  const head = await readHead(orgId, rowId);
  if (head === "failed") return { ok: false, error: BOOKING_WORDS.press.unqueued };
  if (!head || head.op !== "create" || low(head.sm8_job_uuid) !== low(jobUuid)) return { ok: false, error: BOOKING_WORDS.press.changed };

  const job = head.sm8_job_uuid!;

  const state = await readSm8WriteState(orgId);
  const r = await queueBookingTakeBack(press, state, { createRowId: rowId });
  if (!r.ok) {
    const error = await refusedWords(orgId, state, r, "take_back");
    return { ok: false, error, line: await lineNow(orgId, job, rowId, press.userId) };
  }
  /* something changed: a delete queued, or a booking stopped before it went */
  if (r.rowIds.length > 0 || r.plan === "cancelled") revalidateBookings();
  await settle(orgId, r.rowIds, startedAt);
  return { ok: true, line: await lineNow(orgId, job, rowId, press.userId) };
}

/** Try again on a line: a booking that didn't go, a take-back that didn't
    finish, or a Clear — through its one door (queueBookingRetry), which
    re-presses a failed status change first, and answers Look again where a
    re-press would meet the same thing. */
export async function retryBooking(input: { jobUuid: string; rowId: string }): Promise<BookingLineResult> {
  const startedAt = Date.now();
  const g = await gate();
  if (!g.ok) return g;
  const { orgId, press } = g;
  const jobUuid = text(input?.jobUuid);
  const rowId = text(input?.rowId);
  if (!UUID.test(jobUuid) || !UUID.test(rowId)) return { ok: false, error: BOOKING_WORDS.press.changed };
  const head = await readHead(orgId, rowId);
  if (head === "failed") return { ok: false, error: BOOKING_WORDS.press.unqueued };
  if (!head || low(head.sm8_job_uuid) !== low(jobUuid)) return { ok: false, error: BOOKING_WORDS.press.changed };
  /* a take-back's line is its booking's */
  const lineRow = head.op === "delete" && head.depends_on ? head.depends_on : rowId;
  const job = head.sm8_job_uuid!;

  const state = await readSm8WriteState(orgId);
  const r = await queueBookingRetry(press, state, { rowId });
  if (!r.ok) {
    const error = await refusedWords(orgId, state, r, "retry");
    const line = await lineNow(orgId, job, lineRow, press.userId);
    return r.lookAgain ? { ok: false, error, line, lookAgain: true } : { ok: false, error, line };
  }
  if (r.rowIds.length > 0) revalidateBookings();
  await settle(orgId, r.rowIds, startedAt);
  return { ok: true, line: await lineNow(orgId, job, lineRow, press.userId) };
}

/** Clear a finished job's leftover booking — a future booking on a job
    that is Completed or Unsuccessful — as the confirm showed it (`seen`,
    only ever compared: the row keeps the mirror's copy). There is no Undo
    on a Clear. A double press is one Clear. */
export async function clearLeftoverBooking(input: {
  jobUuid: string;
  activityUuid: string;
  seen: { staffUuid: string; start: string };
  pressId: string;
}): Promise<BookingLineResult> {
  const startedAt = Date.now();
  const g = await gate();
  if (!g.ok) return g;
  const { orgId, press } = g;
  const jobUuid = text(input?.jobUuid);
  const activityUuid = text(input?.activityUuid);
  const pressId = text(input?.pressId);
  if (!UUID.test(pressId)) return { ok: false, error: BOOKING_WORDS.press.unqueued };
  if (!UUID.test(jobUuid) || !UUID.test(activityUuid)) return { ok: false, error: BOOKING_WORDS.press.notLeftover };

  const state = await readSm8WriteState(orgId);
  const r = await queueClear(press, state, {
    jobUuid,
    activityUuid,
    seen: { staffUuid: text(input?.seen?.staffUuid), start: text(input?.seen?.start) },
    verbId: pressId,
  });
  if (!r.ok) return { ok: false, error: await refusedWords(orgId, state, r, "clear") };
  if (r.rowIds.length > 0) revalidateBookings();
  await settle(orgId, r.rowIds, startedAt);

  /* the Clear's line, found by the booking it clears */
  const read = await readBookingLines(orgId, await readSm8WriteState(orgId), jobUuid, press.userId);
  for (const v of read.verbs) {
    for (const b of v.bookings) if (b.op === "clear" && b.uuid === low(activityUuid)) return { ok: true, line: b.state };
  }
  return { ok: true, line: null };
}

/* ── the card's poll ── */

/** Where every booking of ours on this job stands, as the viewer sees it —
    what the card asks every few seconds while something is on its way.
    Anyone who can open the card reads it; the doors are the presser's, and
    only while they may press (Workboard manage, and the owner while
    bookings are the owner's). The job is matched in any spelling. Null
    where the deployment books nothing, where the viewer can't open the job,
    and when the write settings couldn't be read: the card keeps what it has.

    IT SENDS A VERB LEFT HALF WAY, AND NOTHING ELSE. While a status change on
    this job has gone and bookings queued behind it have never been tried
    (a run the meter stopped right after the status change, say), it sends
    exactly those, behind its answer. One tried already (ServiceM8 couldn't
    be reached) waits for its own retry time: each poll would otherwise
    claim one more booking into the outage. It never drains the workspace:
    an unreachable ServiceM8 holds nothing else back. */
export async function readBookingStates(input: { jobUuid: string }): Promise<BookingStates | null> {
  if (!sm8BookingsAllowed()) return null;
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireOrg("workboard"));
  } catch {
    return null;
  }
  const jobUuid = text(input?.jobUuid);
  if (!UUID.test(jobUuid) || !userId) return null;
  /* settings that couldn't be read say nothing, never "nothing waiting":
     the card keeps the lines it has */
  const state = await readSm8WriteState(orgId);
  if (!state.readable) return null;

  /* a presser since demoted keeps their lines, not their doors */
  const read = await readBookingLines(orgId, state, jobUuid, (await mayPress()) ? userId : null);
  if (read.untried.length > 0) {
    const ids = read.untried;
    after(async () => {
      await runSm8Writes(orgId, "send", { ids, budgetMs: BOOKING_PRESS_BUDGET_MS }).catch((err: unknown) => {
        console.error(`[sm8] the booking poll for org ${orgId} couldn't send: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
  }
  return { verbs: read.verbs, lines: read.lines, gone: read.gone };
}
