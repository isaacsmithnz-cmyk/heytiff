/* REMINDERS — pure time arithmetic for "remind me on Monday morning".

   A reminder is a task with a time on it. Everything that decides WHEN lives
   here, as plain functions over strings, for the same reason the chip builders
   do: the wrong answer is one day or one hour out, which is invisible in a
   screenshot and obvious to the person who missed the thing.

   THE ONE RULE THAT MATTERS: a wall-clock time is only meaningful with a zone
   attached. "Monday 6:30" is not an instant — it is an instant in Sydney and a
   different one in Perth, and the server runs in neither. Every composition
   goes through `remindAtFrom`, and both writers (`applyNote` and
   `setTaskDueDate`) call it, so a due date edited later cannot leave the nudge
   behind on the old day. */

import { parseClock } from "@/components/timepay/logic";
import { plusDays, todayInZone } from "@/lib/workboard/dates";

/** The zone the app falls back to when a workspace has no connected account —
    the same anchor `lib/workboard/dates` uses, so the two clocks agree exactly
    when there is nothing to disagree with. */
const FALLBACK_TZ = "Australia/Sydney";

/** A canonical time of day, 24-hour: "06:30". The wire format everywhere —
    the model emits it, the draft carries it, the server composes from it.
    `TimeWheel` speaks "6:30 AM" and is converted at that one boundary. */
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes past midnight → "HH:MM". */
export function hhmm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Any clock string the app can produce → "HH:MM", or "" if unreadable.

    `parseClock` is deliberately the reader: it already accepts "6:30 AM",
    "06:30", "0630" and "6.30pm", it is the parser Time & Pay's stored times
    round-trip through, and a second one would eventually disagree with it
    about what "7" means. */
export function toHHMM(clock: string | null | undefined): string {
  const mins = parseClock(typeof clock === "string" ? clock : "");
  return mins == null ? "" : hhmm(mins);
}

/* What a named zone's offset from UTC is AT a given instant. Derived by asking
   Intl what wall clock that instant shows there and subtracting — there is no
   way to read an offset directly, and hard-coding +10 gets daylight saving
   wrong for four months of every year. */
function offsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asIfUtc - utcMs;
}

/** The instant at which a zone's clock reads `dateISO` at `minutes` past
    midnight.

    TWO PASSES, NOT ONE, and the second is the daylight-saving one: the first
    guess uses the offset in force at the UTC reading of that wall clock, which
    is up to an hour off across a DST boundary. Re-reading the offset at the
    corrected instant settles it — the standard fixed-point, and AEST/AEDT only
    ever moves by one hour so it converges immediately.

    An unreadable zone falls back to the AU anchor rather than throwing: a
    misspelt timezone from upstream must not stop a reminder being set. */
function instantAt(dateISO: string, minutes: number, tz: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const first = wall - offsetMs(wall, tz);
  return new Date(wall - offsetMs(first, tz)).toISOString();
}

const zoneOf = (tz: string | null | undefined): string => {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz || FALLBACK_TZ }).format(0);
    return tz || FALLBACK_TZ;
  } catch {
    return FALLBACK_TZ;
  }
};

/** A due date plus a time of day → the instant to nudge at, or null.

    Null in, null out, in both senses: a task with no due date has no day to be
    reminded on, and a task with no time is an ordinary task. Neither is an
    error — the overwhelming majority of tasks return null here. */
export function remindAtFrom(
  dueDate: string | null | undefined,
  time: string | null | undefined,
  tz: string | null | undefined,
): string | null {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const at = toHHMM(time);
  if (!at) return null;
  const [h, m] = at.split(":").map(Number);
  return instantAt(dueDate, h * 60 + m, zoneOf(tz));
}

/* ── snoozing ─────────────────────────────────────────────────────────── */

/** The three ways a reminder gets put off. Named after when they land rather
    than by a duration, because "an hour" is a length and the other two are
    places in the week — and all three are guaranteed to be in the future,
    which a "this afternoon" pressed at 4pm would not be. */
export const SNOOZE = ["hour", "tomorrow", "week"] as const;
export type Snooze = (typeof SNOOZE)[number];

export const SNOOZE_LABEL: Record<Snooze, string> = {
  hour: "An hour",
  tomorrow: "Tomorrow",
  week: "Next week",
};

export const isSnooze = (v: unknown): v is Snooze =>
  typeof v === "string" && (SNOOZE as readonly string[]).includes(v);

/** When a snooze lands, as an ISO instant.

    `dayStart` is the person's own normal start where they keep one and the
    workspace's otherwise — an installer who starts at 6:30 is reminded at
    6:30, not at somebody's idea of morning. "Next week" is the coming Monday,
    which is what people mean by it; on a Monday that is seven days away, not
    today. */
export function snoozeUntil(
  preset: Snooze,
  dayStart: string,
  tz: string | null | undefined,
  now: Date = new Date(),
): string {
  if (preset === "hour") return new Date(now.getTime() + 60 * 60_000).toISOString();

  const zone = zoneOf(tz);
  const today = todayInZone(zone, now);
  const start = toHHMM(dayStart) || "07:00";
  if (preset === "tomorrow") return remindAtFrom(plusDays(today, 1), start, zone)!;

  /* Days from today to the next Monday. `T12:00:00Z` is midday so no zone's
     offset can move the weekday underneath the read. */
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const ahead = ((8 - dow) % 7) || 7;
  return remindAtFrom(plusDays(today, ahead), start, zone)!;
}

/* ── what the bell shows ──────────────────────────────────────────────── */

export type DueReminder = {
  taskId: string;
  title: string;
  detail: string | null;
  /** ISO instant the nudge was set for. */
  remindAt: string;
};

/** How late a reminder is, in plain words — "now", "20 minutes ago", "2 days
    ago". Rounded down, because a reminder that came due 90 seconds ago saying
    "2 minutes ago" is the sort of small lie that makes people stop trusting
    the number beside it. */
export function lateness(remindAt: string, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(remindAt).getTime()) / 60_000);
  if (mins < 2) return "now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
