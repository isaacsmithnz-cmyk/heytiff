/* Bookings to ServiceM8 — the decisions, pure (two-way phase 3, PR A).

   sm8-note-plan's sibling for the third kind of write. Everything here is a
   function of its arguments: the subjects a booking row is queued under,
   the account's wall clock, what a leftover is, and what a booking's line
   says to the person looking at it. The sender (sm8-booking-send) and the
   queue helpers (app/actions/sm8-booking-queue) carry these out (PR B), and
   the job card, the Schedule, Home and the bell (PR D, PR E) only draw what
   bookingLine, statusLine and clearLine say.

   THE RULES THIS FILE HOLDS, whoever draws them:
   - TIME IS TEXT IN THE ACCOUNT'S ZONE. A booking's start and end are
     "YYYY-MM-DD HH:MM:00" on the ServiceM8 account's wall clock, read by
     slicing and compared as fixed-width text, never parsed into a Date
     (schedule.ts's rule). P1 (2026-09-27) read a booking made by hand back
     as exactly the wall-clock text chosen; the write side is the gated
     walk's (L2). A zone HeyTiff doesn't know is never guessed: nothing is in
     the future in it, so nothing books (no Sydney fallback, unlike
     todayInZone).
   - ONE ROW PER THING, under a subject with no space in it: a person's start
     on a job, a version of the job, an Undo per create, a Clear per
     activity.
   - HEYTIFF NEVER SAYS "NOT BOOKED" OVER A BOOKING THAT MAY BE IN
     SERVICEM8 once it has stopped: a create whose answer was lost reads
     `line.unsure` when it failed, was cancelled or was a trial, and a
     status change whose answer was lost `line.statusUnsure`. While such a
     create still waits in the queue it reads case 10, "Not booked yet."
     and why it waits: the sender reads it back before anything goes again.
   - A BOOKING THE MIRROR SHOWS REMOVED IS NEVER OFFERED A DOOR. ServiceM8's
     DELETE of a record already deleted RESTORES it (the notes walk,
     2026-09-27), so an Undo, a Cancel booking or a take-back's Try again
     pointed at it would put back what someone removed.
   - A BOOKING SOMEONE CHANGED IN SERVICEM8 IS THEIRS. What was booked — its
     job, person, start and end — is compared, never its edit time alone:
     the booked person opening it moves that (U21; P1 saw it move with the
     times unchanged). Only a booking a read-back guard recorded compares its
     edit time, because what was booked can't be.
   - EVERY DOOR IS THE PRESSER'S, except Open in ServiceM8. */

import { dateOrNull, sm8LocalStamp } from "./sm8-sync-plan";
import { fillWords, NOTE_WORDS } from "./sm8-note-words";
import { mayHaveLanded, sameEditDate } from "./sm8-note-plan";
import { BOOKING_WORDS } from "./sm8-booking-words";
import { WRITE_WORDS, type SendHold, type Sm8WriteStatus } from "./sm8-write-plan";

export { BOOKING_WORDS };

/* ── how much, how often ── */

/** The grid a booking starts on, and a length is counted in. */
export const BOOKING_STEP_MIN = 15;

/** The lengths the panel offers: 30 min to 8 h. */
export const BOOKING_LENGTHS_MIN = [30, 60, 90, 120, 180, 240, 360, 480] as const;

/** One press books at most this many (DECISIONS 10): several bookings on
    one job, never several jobs. */
export const BOOKINGS_PER_PRESS = 8;

/** A booking, or a status change, pressed longer ago than this never goes
    by itself (DECISIONS 8). */
export const BOOKING_TTL_MS = 86_400_000;

/** A status change goes only ahead of a booking at least this far off
    (2.7's alone rule). The press and Try again want this plus
    BOOKING_STATUS_WAIT_MS, 12 minutes (2.11, 2.3). */
export const BOOKING_STATUS_LEAD_MS = 600_000;

/** With no create able to go yet, a status row waits this long after its
    press for its creates to arrive (2.7). */
export const BOOKING_STATUS_WAIT_MS = 120_000;

/** A panel's live read is fresh enough to book on for this long. */
export const BOOKING_CONTEXT_TTL_MS = 600_000;

/** How long a press waits on its own rows before it answers. */
export const BOOKING_PRESS_BUDGET_MS = 8_000;

/** The second read-back, about this long after the first (U23): only it
    can call a write "not kept" or "not found". */
export const BOOKING_REREAD_MS = 2_000;

/** A DELETE's aftermath, and a lost POST's: a read may not show either for
    a moment (U23), and a DELETE on a booking already out puts it back. So
    no DELETE goes to a booking within this long of the last try another
    take-back or Clear of it made, none goes again sooner after its own row
    last tried, whoever presses, and an Undo whose booking never went reads
    "not there" as out only this long after its create's last try. */
export const BOOKING_DELETE_SETTLE_MS = 60_000;

/** Book in and Clear are the owner's until the walk passes; PR F flips it
    (DECISIONS 7). */
export const BOOKINGS_OPEN_TO_MANAGERS = false;

/** Whether the uuid-filtered read returns a booking someone removed
    (active = 0). PR F flips it only if L4 shows it AND L2 showed ServiceM8
    keeps our uuid (U1): until then a uuid of ours read back as not found
    after a lost answer fails unsure, and is never posted again. */
export const BOOKING_READBACK_SEES_INACTIVE = false;

/** The job's fields a status change must leave as they were (the fields
    guard). P6 (2026-09-27) made a Quote a Work Order by hand and all six
    stayed. work_order_date changes by definition, and the quote's total and
    the job's queue are logged, not guarded. */
export const STATUS_KEPT_FIELDS = [
  "company_uuid",
  "job_address",
  "job_description",
  "category_uuid",
  "purchase_order_number",
  "generated_job_id",
] as const;

/* ── subjects ── */

/** The subject a booking row is queued under: one per THING, and never a
    space in it, so no dedupe key (kind:job:subject, sm8_writes_safety.sql)
    needs a new proof through PostgREST's `in` filter:
    - a booking: a person's start on the job, one live booking per job,
      person and start;
    - a status change: the job's edit time the press saw, one change per
      version of the job;
    - an Undo: one per create, ever;
    - a Clear: one per activity.
    A row released for a new one (it no longer stands) carries
    `:was:<its id>` after its subject. */
export const bookingSubject = {
  slot: (staffUuid: string, start: string) =>
    `slot:${staffUuid.trim().toLowerCase()}:${start.slice(0, 10)}T${start.slice(11, 16)}`,
  status: (seenEditDate: string) => `status:wo:${seenEditDate.trim().replace(/\s+/g, "T")}`,
  undo: (createRowId: string) => `undo:${createRowId}`,
  clear: (activityUuid: string) => `clear:${activityUuid}`,
};

export type ParsedBookingSubject =
  | { via: "slot"; staffUuid: string; start: string; released: boolean }
  | { via: "status"; seenEditDate: string; released: boolean }
  | { via: "undo"; createRowId: string; released: boolean }
  | { via: "clear"; activityUuid: string; released: boolean };

export function parseBookingSubject(s: string): ParsedBookingSubject | null {
  const was = /^(.+):was:([^:]+)$/.exec(s);
  const subject = was ? was[1] : s;
  const released = !!was;
  let m = /^slot:([^:]+):(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(subject);
  if (m) return { via: "slot", staffUuid: m[1], start: `${m[2]} ${m[3]}:00`, released };
  m = /^status:wo:(\S+)$/.exec(subject);
  if (m) return { via: "status", seenEditDate: m[1].replace("T", " "), released };
  m = /^undo:(\S+)$/.exec(subject);
  if (m) return { via: "undo", createRowId: m[1], released };
  m = /^clear:(\S+)$/.exec(subject);
  if (m) return { via: "clear", activityUuid: m[1], released };
  return null;
}

/* ── the account's wall clock ── */

/** A booking's time as ServiceM8 stamps it: "YYYY-MM-DD HH:MM:SS". */
const STAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** A real calendar day, "YYYY-MM-DD": 31 February is refused rather than
    rolled on. */
function realDay(day: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** A booking's start and end on `day`, from a start "HH:MM" and a length,
    added on the wall clock as text: "2026-10-06", "12:45" and 30 give
    "2026-10-06 12:45:00" to "2026-10-06 13:15:00". Null when the end would
    reach midnight or cross it (a booking ends on the day it starts), when
    the start isn't on the 15-minute grid, and when the day, the time or the
    length isn't one — a length is whole steps of the grid, so an end is on
    it too. */
export function slotOf(day: string, hhmm: string, minutes: number): { start: string; end: string } | null {
  if (!realDay(day)) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  if (h > 23 || min > 59 || min % BOOKING_STEP_MIN !== 0) return null;
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes % BOOKING_STEP_MIN !== 0) return null;
  const to = h * 60 + min + minutes;
  if (to >= 24 * 60) return null;
  return { start: `${day} ${hhmm}:00`, end: `${day} ${pad(Math.floor(to / 60))}:${pad(to % 60)}:00` };
}

/** Now on the account's wall clock, "YYYY-MM-DD HH:MM:SS" (sm8LocalStamp,
    the sync's own). Null for no zone, or one Intl doesn't know. */
export function localNow(zone: string | null | undefined, now: number): string | null {
  if (!zone) return null;
  return sm8LocalStamp(now, zone);
}

/* ── a wall-clock time's instants ──

   A WALL TIME IS NOT ALWAYS ONE INSTANT. In the hour the clocks go forward
   it is none (in Sydney, 02:00 to 02:59 on the first Sunday of October),
   and in the hour they go back it is two (02:00 to 02:59 on the first
   Sunday of April). Compared as text against the wall clock now, a booking
   in the repeated hour would read started on the first pass and ahead
   again on the second, so a time is compared by the instant it names:
   A START BY ITS EARLIEST, so once a booking has started it stays started,
   and nothing ever takes out a booking that may be under way. */

/** Offsets are read either side of a stamp, far enough out that every
    instant it could name (UTC-12 to UTC+14) lies between them. */
const OFFSET_PROBES_MS = [-15 * 3_600_000, 0, 13 * 3_600_000];

/** One formatter per zone (null: one Intl doesn't know), so a time's
    instants cost no new Intl.DateTimeFormat each: sm8LocalStamp's own
    options, and its own shape. */
const WALL_FORMATS = new Map<string, Intl.DateTimeFormat | null>();

function wallStamp(ms: number, zone: string): string | null {
  let f = WALL_FORMATS.get(zone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      f = null;
    }
    WALL_FORMATS.set(zone, f);
  }
  if (!f) return null;
  const parts = f.formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const stamp = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
  return STAMP_RE.test(stamp) ? stamp : null;
}

/** A stamp's fields read as if it were UTC: the offset arithmetic's
    starting point. */
function naiveMs(stamp: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(stamp);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

/** The zone's offsets around a stamp, or null for a zone Intl doesn't know. */
function offsetsAround(naive: number, zone: string): number[] | null {
  const out = new Set<number>();
  for (const d of OFFSET_PROBES_MS) {
    const at = Math.floor((naive + d) / 1000) * 1000;
    const wall = wallStamp(at, zone);
    const wallMs = wall ? naiveMs(wall) : null;
    if (wallMs === null) return null;
    out.add(wallMs - at);
  }
  return [...out];
}

/** Every instant a wall-clock stamp names in the zone, earliest first:
    none in the hour the clocks skip (or for a day that isn't one), two in
    the hour they repeat, one otherwise. Empty for no zone, or a stamp that
    isn't one. */
export function wallInstants(stamp: string | null | undefined, zone: string | null | undefined): number[] {
  if (!zone || !stamp || !STAMP_RE.test(stamp)) return [];
  const naive = naiveMs(stamp);
  const offsets = naive === null ? null : offsetsAround(naive, zone);
  if (naive === null || !offsets) return [];
  return [...new Set(offsets.map((o) => naive - o))].filter((t) => wallStamp(t, zone) === stamp).sort((a, b) => a - b);
}

/** Whether a wall time happens in the zone (the clocks skip none of it). */
export function wallTimeExists(stamp: string | null | undefined, zone: string | null | undefined): boolean {
  return wallInstants(stamp, zone).length > 0;
}

/** The instant a wall time names in the zone: its earliest, or latest. One
    in the hour the clocks skip, which names none, is read with the offset
    that gives the earliest (or latest) it could mean. Null for no zone, or
    a stamp that isn't one. */
export function wallInstant(stamp: string | null | undefined, zone: string | null | undefined, which: "earliest" | "latest"): number | null {
  const all = wallInstants(stamp, zone);
  if (all.length > 0) return which === "earliest" ? all[0] : all[all.length - 1];
  if (!zone || !stamp || !STAMP_RE.test(stamp)) return null;
  const naive = naiveMs(stamp);
  const offsets = naive === null ? null : offsetsAround(naive, zone);
  if (naive === null || !offsets) return null;
  return which === "earliest" ? naive - Math.max(...offsets) : naive - Math.min(...offsets);
}

/** Whether a booking starting at `start` is still ahead: the earliest
    instant its start names in the zone is after `now` — so it is never
    ahead again once it has started, not even in the hour the clocks go
    back. An unknown zone, or a start that isn't a stamp, is never in the
    future. */
export function isFuture(start: string | null | undefined, zone: string | null | undefined, now: number): boolean {
  const at = wallInstant(start, zone, "earliest");
  return at !== null && at > now;
}

/** Whether a booking has started (its start's earliest instant has come).
    Unknown — no zone, no start — is NOT started: a line keeps its words
    and doors, and the press and the sender ask again, with the zone,
    before anything is taken out. */
function hasStarted(start: string | null | undefined, zone: string | null | undefined, now: number): boolean {
  const at = wallInstant(start, zone, "earliest");
  return at !== null && at <= now;
}

const flagOn = (v: unknown) => v === 1 || v === "1" || v === true;

/** A leftover — ONE DEFINITION, used everywhere a booking can be cleared: a
    future, scheduled, active booking with a person and an end, on a job
    that is Completed or Unsuccessful (DECISIONS 2). By the account's clock,
    not by day, so a booking later today on a job completed this morning is
    one, although the Schedule's own "stale" mark (days, Completed only)
    draws it "Done and closed".

    RECORDED TIME IS NEVER A LEFTOVER: it isn't scheduled. A check-in, and
    time added by hand, is a row of its own with activity_was_scheduled 0
    (P4); clearing recorded time in ServiceM8 leaves that row active with
    its end on its start (zero length), and it stays out here too. The live
    checks a Clear makes before it goes (no check-in by the same person in
    the booking's window) are the sender's (PR B). */
export function isLeftover(
  a: {
    scheduled: number | string | boolean | null;
    active: number | string | boolean | null;
    start: string | null;
    end: string | null;
    staffUuid: string | null;
  },
  jobStatus: string | null,
  zone: string | null,
  now: number
): boolean {
  if (jobStatus !== "Completed" && jobStatus !== "Unsuccessful") return false;
  if (!flagOn(a.scheduled) || !flagOn(a.active)) return false;
  if (!a.staffUuid || !a.end) return false;
  return isFuture(a.start, zone, now);
}

/* ── the words a time is said in ── */

/** The account's city, from its zone: the part after the last "/", with
    "_" read as a space. "Australia/Sydney" is "Sydney". */
export function placeName(zone: string): string {
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

/** A time's hour and minute, from a stamp or "HH:MM", by slicing. */
function clockOf(t: string): { h: number; m: string } | null {
  const hit = /(?:^|\s)(\d{2}):(\d{2})(?::\d{2})?$/.exec(t.trim());
  if (!hit) return null;
  const h = Number(hit[1]);
  return h > 23 ? null : { h, m: hit[2] };
}

const half = (h: number) => (h < 12 ? "am" : "pm");
const h12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);

/** "9:00 am", from "09:00" or a booking's stamp. Empty for anything else. */
export function fmtTime(t: string): string {
  const c = clockOf(t);
  return c ? `${h12(c.h)}:${c.m} ${half(c.h)}` : "";
}

/** A range's two halves as the words place them ("{start} to {end}"): the
    meridiem said once when both share it — "9:00" and "11:00 am" — and on
    each across noon — "11:00 am" and "1:00 pm". */
export function rangeParts(start: string, end: string): { start: string; end: string } {
  const a = clockOf(start);
  const b = clockOf(end);
  if (!a || !b) return { start: fmtTime(start), end: fmtTime(end) };
  return {
    start: half(a.h) === half(b.h) ? `${h12(a.h)}:${a.m}` : fmtTime(start),
    end: fmtTime(end),
  };
}

/** "9:00 to 11:00 am"; "11:00 am to 1:00 pm". */
export function fmtRange(start: string, end: string): string {
  const r = rangeParts(start, end);
  return `${r.start} to ${r.end}`;
}

/* ── what a stored reason is ── */

/** The account-wide sentences a booking row may carry, reused as they are
    (WRITE_WORDS), never copied. */
const REUSED_WRITE_WORDS = [
  "reauth",
  "billing",
  "slowDown",
  "dailyLimit",
  "paced",
  "paused",
  "unreachable",
  "gaveUp",
  "noJob",
  "otherAccount",
  "accountUnknown",
  "disconnected",
] as const;

export type BookingReasonKey =
  | keyof typeof BOOKING_WORDS.row
  | "takenBackBeforeSent"
  | "nothingToTakeBack"
  | (typeof REUSED_WRITE_WORDS)[number]
  /** WRITE_WORDS.switchedOff: the owner's whole Off cancels every waiting
      row in these words, booking rows among them. Its own key, apart from
      bookings' own switch (row.switchedOff). */
  | "sendingSwitchedOff";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every sentence a booking row's last_error can hold, as a pattern: each
    template whole, with each {placeholder} standing for any words. The ones
    with no placeholder go first, so a template with one never reads a
    sentence that is another's exactly. */
const REASONS: readonly (readonly [BookingReasonKey, RegExp])[] = (
  [
    ...(Object.entries(BOOKING_WORDS.row) as [keyof typeof BOOKING_WORDS.row, string][]),
    ["takenBackBeforeSent", NOTE_WORDS.row.takenBackBeforeSent],
    ["nothingToTakeBack", NOTE_WORDS.row.nothingToTakeBack],
    ...REUSED_WRITE_WORDS.map((k) => [k, WRITE_WORDS[k]] as const),
    ["sendingSwitchedOff", WRITE_WORDS.switchedOff],
  ] as (readonly [BookingReasonKey, string])[]
)
  .map(([key, template]) => ({ key, template, open: /\{\w+\}/.test(template) }))
  .sort((x, y) => Number(x.open) - Number(y.open))
  .map(({ key, template }) => [key, new RegExp(`^${template.split(/\{\w+\}/).map(escapeRe).join("[\\s\\S]+")}$`)] as const);

/** Which sentence a stored reason is. A row stores the FILLED sentence
    ("Sam is already booked on this job at that time in ServiceM8."), so it
    is recognised by its template, never by comparing strings. Null for none
    of them. */
export function reasonOf(lastError: string | null | undefined): BookingReasonKey | null {
  if (!lastError) return null;
  for (const [key, re] of REASONS) if (re.test(lastError)) return key;
  return null;
}

/** Every template a sentence matches — one, for any sentence a row stores
    (a test holds that no two templates read one sentence). */
export function reasonsMatching(lastError: string): BookingReasonKey[] {
  return REASONS.filter(([, re]) => re.test(lastError)).map(([key]) => key);
}

/* ── what a booking's line says ── */

export type BookingKey = `line.${keyof typeof BOOKING_WORDS.line}`;

export type BookingAct = "undo" | "cancel" | "try_again" | "look_again" | "book_again" | "take_out_again" | "open_in_sm8";

export type BookingState = {
  key: BookingKey | null;
  text: string | null;
  tone: "ok" | "warn" | "bad" | null;
  acts: BookingAct[];
};

const NONE: BookingState = { key: null, text: null, tone: null, acts: [] };

/** The word on each door (`door`): Try again serves a take-back's too. */
export function bookingActWord(act: BookingAct): string {
  switch (act) {
    case "undo":
      return BOOKING_WORDS.door.undo;
    case "cancel":
      return BOOKING_WORDS.door.cancel;
    case "try_again":
    case "take_out_again":
      return BOOKING_WORDS.door.tryAgain;
    case "look_again":
      return BOOKING_WORDS.door.lookAgain;
    case "book_again":
      return BOOKING_WORDS.door.bookAgain;
    case "open_in_sm8":
      return BOOKING_WORDS.door.openInSm8;
  }
}

/** A booking row (sm8_writes, kind booking) as its line reads it: a create,
    its status row, its take-back, or a Clear. */
export type BookingRowIn = {
  id: string;
  status: Sm8WriteStatus | string;
  remote_uuid: string;
  maybe_landed: boolean | null;
  verify_uuids: readonly string[] | null;
  taken_back_at?: string | null;
  last_error: string | null;
  attempts: number;
  sm8_job_uuid?: string | null;
  booking_staff_uuid?: string | null;
  booking_start?: string | null;
  booking_end?: string | null;
  landed_edit_date?: string | null;
};

/** A status row, as far as a line reads it. */
export type StatusRowIn = Pick<BookingRowIn, "status" | "last_error" | "taken_back_at" | "maybe_landed" | "verify_uuids">;

/** A take-back (an Undo's delete row), as far as a line reads it. */
export type TakeBackIn = Pick<BookingRowIn, "status" | "last_error">;

/** The mirror's copy of a booking we sent (sm8_job_activities, by the
    create's remote_uuid), or null before a sync brings it. */
export type BookingMirrorIn = {
  active: number | string | boolean | null;
  jobUuid: string | null;
  staffUuid: string | null;
  start: string | null;
  end: string | null;
  editDate: string | null;
};

export type BookingLineIn = {
  create: BookingRowIn;
  /** The status row the create depends on, if it has one. */
  statusRow: StatusRowIn | null;
  /** The create's take-back, if one was queued. */
  takeBack: TakeBackIn | null;
  /** sendHold(state, "booking"). */
  hold: SendHold;
  /** offersSend(state, "booking"). */
  offered: boolean;
  /** Sending is a trial run now: a trial line offers Book again only once
      sending is On. */
  trial: boolean;
  viewerIsPresser: boolean;
  mirror: BookingMirrorIn | null;
  now: number;
  zone: string | null;
};

const holdWhy = (hold: SendHold): string | null =>
  hold === "paused"
    ? BOOKING_WORDS.why.paused
    : hold === "reconnect"
      ? BOOKING_WORDS.why.reconnect
      : hold === "off"
        ? BOOKING_WORDS.why.off
        : null;

const line = (key: BookingKey, text: string, tone: BookingState["tone"], acts: BookingAct[]): BookingState => ({
  key,
  text,
  tone,
  acts,
});

/** "Not booked. {reason}"; plain "Not booked." for a row that kept none. */
const notBooked = (reason: string | null) =>
  reason ? fillWords(BOOKING_WORDS.line.notSent, { reason }) : BOOKING_WORDS.line.notSent.replace(/\s*\{reason\}$/, "");

/** Two uuids, as ServiceM8 and the mirror may case them. */
const sameId = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** A create taken back that may be in ServiceM8 all the same: it was being
    sent, it went, or an answer was lost. */
const mayBeThere = (create: BookingRowIn) =>
  create.status === "sending" || create.status === "sent" || mayHaveLanded(create);

/** The mirror has our booking, and it is removed (inactive). */
const removedThere = (mirror: BookingMirrorIn | null | undefined) => !!mirror && !flagOn(mirror.active);

/** Whether a create's take-back has settled — its line is case 4 or 6, or
    says nothing because the mirror shows the booking removed: the take-back
    went, or found nothing to take back; or it was stopped before anything
    of it could land; or the booking is out of ServiceM8 whatever the
    take-back says. */
function takeBackSettled(create: BookingRowIn, takeBack: TakeBackIn | null, mirror: BookingMirrorIn | null): boolean {
  if (removedThere(mirror)) return true;
  if (takeBack) {
    return takeBack.status === "sent" || (takeBack.status === "cancelled" && reasonOf(takeBack.last_error) === "nothingToTakeBack");
  }
  return !!create.taken_back_at && !mayBeThere(create);
}

/** The reasons a re-press would meet again: the line offers Look again,
    where the booking, the job and the time can be seen afresh. A booking a
    guard stopped is one: its Try again would go behind the same status
    change the guard recorded and meet it again, where a fresh look books
    it on the job as it is now (a Work Order, with no status change). */
const LOOK_AGAIN: ReadonlySet<BookingReasonKey> = new Set([
  "changed",
  "slotTaken",
  "jobNotBookable",
  "zoneChanged",
  "past",
  "techInactive",
  "jobGone",
  "guardStopped",
]);

/** What one of our bookings says about ServiceM8, and the doors it offers —
    the first case that applies:

    |  # | case                                                           | line                                  |
    |  1 | a take-back queued behind a hold                               | stillIn + the hold, warn              |
    |  2 | a take-back queued or sending                                  | takingOut                             |
    |  3 | a take-back failed, a trial, or cancelled for any other reason than nothing to take back | stillIn + its reason, bad, Try again — none, and no tone, for changed, a check-in, started or a job that's gone |
    |  4 | a take-back sent, or cancelled with nothing to take back       | none                                  |
    |  5 | taken back, no take-back row, and it may be there              | stillIn + why, bad, Try again         |
    |  6 | taken back, and nothing of it can be there                     | none                                  |
    |  7 | someone removed it in ServiceM8: cancelled so, or not sent and the mirror shows it | removedThere        |
    |  8 | queued behind a hold                                           | waitingWhy + the hold, Cancel booking |
    |  9 | queued, waiting on its status row                              | waitingWhy + waitingOnStatus          |
    | 10 | queued with an error                                           | waitingWhy + the error, warn          |
    | 11 | queued and tried before                                        | waitingWhy + retry, warn              |
    | 12 | queued or sending                                              | sending                               |
    | 13 | sent, but a guard recorded it at another time or on someone else, not started, unchanged | keptOther(Person), bad, Undo |
    | 14 | sent, and the mirror shows it inactive                         | removedThere                          |
    | 15 | sent, and changed in ServiceM8                                 | changedThere                          |
    | 16 | sent, and started                                              | none: it is a visit now               |
    | 17 | sent                                                           | sent, ok, Undo                        |
    | 18 | failed, cancelled or a trial, and it may have landed           | unsure, bad                           |
    | 19 | cancelled because its status change didn't go, or may have    | notSent + the reason, bad             |
    | 20 | cancelled for a reason a re-press would meet again             | notSent + the reason, Look again      |
    | 21 | failed, a day old                                              | notSent + the reason, Book again      |
    | 22 | failed                                                         | notSent + the reason, bad, Try again  |
    | 23 | a trial                                                        | trial                                 |
    | 24 | cancelled for any other reason                                 | notSent + the reason, Try again       |

    Ahead of them all: taken back, with the mirror showing it removed, it
    has settled and says nothing (cases 1 to 6 never offer a take-back at a
    booking that is gone). A booking the mirror shows removed has no door in
    any case. Every door is the presser's, except Open in ServiceM8. */
export function bookingLine(input: BookingLineIn): BookingState {
  const { create, statusRow, takeBack, hold, offered, trial, viewerIsPresser, mirror, now, zone } = input;
  const door = (acts: BookingAct[]): BookingAct[] => acts.filter((a) => a === "open_in_sm8" || viewerIsPresser);
  const reason = reasonOf(create.last_error);

  /* The mirror shows it removed: taken back, it is settled and says
     nothing, whatever its take-back row says; never taken back, it reads as
     removed there (case 7, or case 14 once sent). No door either way. */
  const removed = removedThere(mirror);
  if (removed && (takeBack || create.taken_back_at)) return NONE;

  /* ── 1–4: its take-back ── */
  if (takeBack) {
    const st = takeBack.status;
    const why = holdWhy(hold);
    if (st === "queued" && why) return line("line.stillIn", fillWords(BOOKING_WORDS.line.stillIn, { reason: why }), "warn", []);
    if (st === "queued" || st === "sending") return line("line.takingOut", BOOKING_WORDS.line.takingOut, null, []);
    const itsReason = reasonOf(takeBack.last_error);
    if (st === "sent" || (st === "cancelled" && itsReason === "nothingToTakeBack")) return NONE;
    const said = st === "trial" ? BOOKING_WORDS.why.trial : takeBack.last_error || BOOKING_WORDS.why.notTakenOut;
    const text = fillWords(BOOKING_WORDS.line.stillIn, { reason: said });
    /* a re-press would meet the same thing — a job that's gone included */
    if (itsReason === "changedNoTakeBack" || itsReason === "checkIn" || itsReason === "notFuture" || itsReason === "jobGone") {
      return line("line.stillIn", text, null, []);
    }
    return line("line.stillIn", text, "bad", door(["take_out_again"]));
  }

  /* ── 5–6: taken back with no take-back row ── */
  if (create.taken_back_at) {
    if (!mayBeThere(create)) return NONE;
    const why = holdWhy(hold) ?? (!offered ? BOOKING_WORDS.why.notSending : BOOKING_WORDS.why.notTakenOut);
    return line("line.stillIn", fillWords(BOOKING_WORDS.line.stillIn, { reason: why }), "bad", door(["take_out_again"]));
  }

  /* ── 7: someone removed it in ServiceM8 — the sender read it back so, or
     the mirror already shows it (sent, it is case 14) ── */
  if ((create.status === "cancelled" && reason === "bookingGone") || (removed && create.status !== "sent")) {
    return line("line.removedThere", BOOKING_WORDS.line.removedThere, null, []);
  }

  /* ── 8–12: on its way ── */
  if (create.status === "queued") {
    const why = holdWhy(hold);
    if (why) return line("line.waitingWhy", fillWords(BOOKING_WORDS.line.waitingWhy, { why }), null, door(["cancel"]));
    if (statusRow && (statusRow.status === "queued" || statusRow.status === "sending")) {
      const text = fillWords(BOOKING_WORDS.line.waitingWhy, { why: BOOKING_WORDS.why.waitingOnStatus });
      return line("line.waitingWhy", text, null, door(["cancel"]));
    }
    if (create.last_error) {
      return line("line.waitingWhy", fillWords(BOOKING_WORDS.line.waitingWhy, { why: create.last_error }), "warn", door(["cancel"]));
    }
    if (create.attempts > 0) {
      const text = fillWords(BOOKING_WORDS.line.waitingWhy, { why: BOOKING_WORDS.why.retry });
      return line("line.waitingWhy", text, "warn", door(["cancel"]));
    }
  }
  if (create.status === "queued" || create.status === "sending") {
    return line("line.sending", BOOKING_WORDS.line.sending, null, door(["cancel"]));
  }

  /* ── 13–17: in ServiceM8 ── */
  if (create.status === "sent") {
    const guarded = reason === "timeNotKept" || reason === "personNotKept";
    const started = hasStarted(dateOrNull(mirror?.start ?? null) ?? create.booking_start ?? null, zone, now);
    /* a guard's booking: only its job and its edit time can be compared */
    const unchangedSinceGuard =
      !mirror ||
      (flagOn(mirror.active) &&
        sameId(mirror.jobUuid, create.sm8_job_uuid) &&
        sameEditDate(mirror.editDate, create.landed_edit_date));
    if (guarded && !started && unchangedSinceGuard) {
      const key = reason === "personNotKept" ? "line.keptOtherPerson" : "line.keptOther";
      const text = reason === "personNotKept" ? BOOKING_WORDS.line.keptOtherPerson : BOOKING_WORDS.line.keptOther;
      return line(key, text, "bad", door(["undo", "open_in_sm8"]));
    }
    if (removed) return line("line.removedThere", BOOKING_WORDS.line.removedThere, null, []);
    const changed =
      reason === "movedThere" ||
      (!!mirror &&
        (guarded
          ? !sameId(mirror.jobUuid, create.sm8_job_uuid) || !sameEditDate(mirror.editDate, create.landed_edit_date)
          : !sameId(mirror.jobUuid, create.sm8_job_uuid) ||
            !sameId(mirror.staffUuid, create.booking_staff_uuid) ||
            dateOrNull(mirror.start) !== dateOrNull(create.booking_start ?? null) ||
            dateOrNull(mirror.end) !== dateOrNull(create.booking_end ?? null)));
    if (changed) return line("line.changedThere", BOOKING_WORDS.line.changedThere, null, []);
    if (started) return NONE;
    return line("line.sent", BOOKING_WORDS.line.sent, "ok", door(["undo", "open_in_sm8"]));
  }

  /* ── 18: it may be there ── */
  if (mayHaveLanded(create)) {
    return line("line.unsure", BOOKING_WORDS.line.unsure, "bad", door(["open_in_sm8", "book_again", "cancel"]));
  }

  /* ── 19–24: it didn't go ── */
  const text = notBooked(create.last_error);
  if (create.status === "cancelled" && (reason === "statusFirst" || reason === "statusUnsure")) {
    return line("line.notSent", text, "bad", door(statusDoor(reason, statusRow)));
  }
  if (create.status === "cancelled" && reason && LOOK_AGAIN.has(reason)) {
    return line("line.notSent", text, null, reason === "jobGone" ? [] : door(["look_again"]));
  }
  if (create.status === "failed") {
    if (reason === "stale") return line("line.notSent", text, null, door(["book_again"]));
    return line("line.notSent", text, "bad", door(["try_again", "cancel"]));
  }
  if (create.status === "trial") {
    return line("line.trial", BOOKING_WORDS.line.trial, null, door(offered && !trial ? ["book_again", "cancel"] : ["cancel"]));
  }
  return line("line.notSent", text, null, door(["try_again"]));
}

/** Case 19's door, for a booking its status change stopped: after an
    answer that was lost, Look again (a fresh read shows what the job is
    now); otherwise what the status row's own reason allows — Look again
    where a re-press would meet the same thing, or the status row was taken
    back (a fresh one needs a fresh edit time), none for a job that's gone,
    and Try again (the status row, then this booking) for anything else. */
function statusDoor(reason: "statusFirst" | "statusUnsure", statusRow: StatusRowIn | null): BookingAct[] {
  if (reason === "statusUnsure" || !statusRow || statusRow.taken_back_at) return ["look_again"];
  const its = reasonOf(statusRow.last_error);
  if (its === "jobGone") return [];
  if (its === "changed" || its === "jobNotBookable" || its === "stale" || its === "statusAlone") return ["look_again"];
  return ["try_again"];
}

/** Where a booking's line is drawn on the Visits face (1.5), each booking
    drawn once: ON ITS OWN ENTRY when the booking stands (its uuid is in the
    face's list) and the line is one a standing booking carries — its state
    once sent (Booked, Changed, kept at another time or on someone else) or
    its take-back's (Taking it out, Still in); ABOVE THE LIST for every
    other line, and for those same lines when the booking doesn't stand;
    nowhere when there is no line. */
const ON_ENTRY: ReadonlySet<BookingKey> = new Set<BookingKey>([
  "line.sent",
  "line.keptOther",
  "line.keptOtherPerson",
  "line.changedThere",
  "line.takingOut",
  "line.stillIn",
]);

export function lineDrawnAt(state: BookingState, standing: boolean): "entry" | "above" | null {
  if (!state.key) return null;
  return standing && ON_ENTRY.has(state.key) ? "entry" : "above";
}

/** What a status change (a Quote made a Work Order) says, once, above the
    bookings that depend on it — the first that applies:
    - queued or sending: statusSending;
    - sent, having changed more than the status (the fields guard):
      statusSent and the reason, bad;
    - sent, with every booking behind it taken back AND SETTLED (or shown
      removed by the mirror, each create's own, when it is handed in):
      takenBack. Until each take-back has settled it stays statusSent, so
      "Taken back." never sits above "Taking it out of ServiceM8…";
    - sent: statusSent, ok;
    - failed, cancelled or a trial, and it may have landed: statusUnsure —
      the card is never silent on a change that may be in ServiceM8;
    - taken back with nothing sent: nothing;
    - cancelled because none of its bookings could go: statusStays;
    - failed or cancelled otherwise: statusNotSent and the reason, bad (the
      doors are on its bookings);
    - a trial: nothing (its bookings say Trial run).
    `_hold` is the live hold, which the status row's own line never says:
    its bookings do (case 8). */
export function statusLine(
  statusRow: StatusRowIn,
  creates: readonly { create: BookingRowIn; takeBack: TakeBackIn | null; mirror?: BookingMirrorIn | null }[],
  _hold: SendHold
): BookingState | null {
  const st = statusRow.status;
  if (st === "queued" || st === "sending") return line("line.statusSending", BOOKING_WORDS.line.statusSending, null, []);
  if (st === "sent") {
    if (reasonOf(statusRow.last_error) === "fieldsNotKept") {
      return line("line.statusSent", `${BOOKING_WORDS.line.statusSent}. ${statusRow.last_error}`, "bad", []);
    }
    const settled = (c: (typeof creates)[number]) => !!c.create.taken_back_at && takeBackSettled(c.create, c.takeBack, c.mirror ?? null);
    if (creates.length > 0 && creates.every(settled)) {
      return line("line.takenBack", BOOKING_WORDS.line.takenBack, null, []);
    }
    return line("line.statusSent", BOOKING_WORDS.line.statusSent, "ok", []);
  }
  if (mayHaveLanded(statusRow)) return line("line.statusUnsure", BOOKING_WORDS.line.statusUnsure, null, []);
  if (statusRow.taken_back_at) return null;
  if (st === "cancelled" && reasonOf(statusRow.last_error) === "statusAlone") {
    return line("line.statusStays", BOOKING_WORDS.line.statusStays, null, []);
  }
  if (st === "failed" || st === "cancelled") {
    const text = statusRow.last_error
      ? fillWords(BOOKING_WORDS.line.statusNotSent, { reason: statusRow.last_error })
      : BOOKING_WORDS.line.statusNotSent.replace(/\s*\{reason\}$/, "");
    return line("line.statusNotSent", text, "bad", []);
  }
  return null;
}

/** What a Clear of a leftover booking says. Once sent there is nothing to
    say: the booking goes from the list, the Schedule and Home with it. A
    Clear that didn't go offers Try again, or Look again where the booking or
    the job moved, and no door where a re-press would meet the same thing (it
    has started, or someone is checked in for it). Try again re-presses it
    with the booking as the mirror has it then. */
export function clearLine(row: BookingRowIn, hold: SendHold): BookingState | null {
  const st = row.status;
  if (st === "queued") {
    const why = holdWhy(hold);
    if (why) return line("line.clearWaiting", fillWords(BOOKING_WORDS.line.clearWaiting, { why }), null, []);
    if (row.last_error) return line("line.clearWaiting", fillWords(BOOKING_WORDS.line.clearWaiting, { why: row.last_error }), "warn", []);
    if (row.attempts > 0) {
      return line("line.clearWaiting", fillWords(BOOKING_WORDS.line.clearWaiting, { why: BOOKING_WORDS.why.retry }), "warn", []);
    }
  }
  if (st === "queued" || st === "sending") return line("line.clearing", BOOKING_WORDS.line.clearing, null, []);
  if (st === "sent") return null;
  if (st === "trial") return line("line.clearTrial", BOOKING_WORDS.line.clearTrial, null, []);
  const reason = reasonOf(row.last_error);
  const text = row.last_error
    ? fillWords(BOOKING_WORDS.line.notCleared, { reason: row.last_error })
    : BOOKING_WORDS.line.notCleared.replace(/\s*\{reason\}$/, "");
  if (reason === "notFuture" || reason === "checkIn") return line("line.notCleared", text, null, []);
  if (reason === "changed" || reason === "notLeftover") return line("line.notCleared", text, null, ["look_again"]);
  return line("line.notCleared", text, "bad", ["try_again"]);
}
