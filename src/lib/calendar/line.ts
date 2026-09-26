/* A LINE FOR THE CALENDAR — what Tiff read off it, the days it lands on, and
   what she says about it. Pure: no database, no clock, no model.

   "Toolbox talk every first Thursday, 6:45", typed into the Calendar's box
   and sorted, or said to its Tiff button. The model (./line-brain) reads the
   line into a `CalendarLine`; this holds that reading to the words
   (`asSaid`), counts its days inside the calendar's twelve months (a repeat
   through ./repeat, which is the only thing that counts dates), keeps a
   series off the days the business is already closed (`openDays`), and
   writes Tiff's side of it: the line she says, the plan under it, the door,
   and her answer when a reply is kept on what she filed.

   SHARED BY BOTH SIDES OF THE WIRE. The action (app/actions/calendar) writes
   the rows and these words; the Tiff modal says the reply's line itself,
   because the reply's own action only keeps a note. So nothing here reaches
   for the server. */

import { dayLabel, dayRangeLabel, fromDay, monthYearLabel, timeLabel, timeRangeLabel, toDay } from "./days";
import { eventsDoor, occurrences, repeatPhrase, repeatPlan, type RepeatRule } from "./repeat";

/** What Tiff asks when the line names no day she can put it on. */
export const WHICH_DAY = "Which day?";

/** How many times she asks "Which day?" before she gives up on the line. */
export const DAY_ASKS = 3;

/** A line, as Tiff read it, every field checked (./line-brain `shapeLine`). */
export type CalendarLine = {
  /** "Toolbox talk": sentence case, as the calendar shows it. */
  title: string;
  /** "toolbox talk", "Daikin VRV training": the title inside a sentence. */
  titleInSentence: string;
  /** A public holiday is never filed: the state's list is already on the
      calendar, so a line that says a day is one only ever gets her saying
      whether it is. */
  kind: "event" | "shutdown" | "public_holiday";
  /** The day it happens, or the first day of a range, ISO. For a repeat, the
      day it starts from, when the line said one. */
  day: string | null;
  /** The last day of a one-off that runs over several days, ISO. */
  lastDay: string | null;
  /** Wall-clock "HH:MM", local to the yard. */
  time: string | null;
  endTime: string | null;
  repeat: RepeatRule | null;
  /** The word the reader found saying it repeats ("every", "jeden"), as it
      reported it; `asSaid` believes it only where the words have it. */
  repeatWord: string | null;
  where: string | null;
  who: string | null;
};

/** The calendar's twelve months, and the day it is. */
export type LineFrame = { today: string; windowStart: string; windowEnd: string };

export type LineDates =
  | {
      ok: true;
      /** Every day it goes on, in order: one, or a repeat's occurrences. */
      days: string[];
      /** The last day of a one-off range; null for one day or a repeat. */
      lastDay: string | null;
    }
  /** No day to put it on: Tiff asks. */
  | { ok: false; why: "no-day" }
  /** A day before the calendar's twelve months, or none inside them. */
  | { ok: false; why: "past" | "far" };

/* ── held to the words ── */

/** The words that say a thing happens again and again, in English. */
const REPEAT_SAID = /\b(?:every|each|monthly|weekly|fortnightly)\b/i;

/** Words that say WHICH day, never how often: a reported repeat word made
    only of these ("of the month", "last") is the reader taking the day for
    a repeat, not a word that says one. */
const NOT_A_REPEAT = new Set([
  "a",
  "an",
  "the",
  "of",
  "on",
  "in",
  "at",
  "this",
  "next",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "last",
  "day",
  "days",
  "week",
  "weeks",
  "fortnight",
  "month",
  "months",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "mon",
  "tue",
  "tues",
  "wed",
  "thu",
  "thur",
  "thurs",
  "fri",
  "sat",
  "sun",
]);

/** Scripts written without spaces between words: there a word is found as
    it is written, not between word boundaries. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether what was said (the line, then each answer to "Which day?") says
    it repeats: an English repeat word, or the word the reader reported in
    the speaker's own language, when that word is in what they said and is
    more than words that only name the day. Pure. */
export function saysRepeat(words: readonly string[], reported: string | null | undefined): boolean {
  const said = words.join("\n");
  if (REPEAT_SAID.test(said)) return true;
  const w = String(reported ?? "").replace(/\s+/g, " ").trim();
  const parts = w.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!parts.length || parts.every((p) => NOT_A_REPEAT.has(p))) return false;
  if (UNSPACED.test(w)) return said.toLowerCase().includes(w.toLowerCase());
  const body = w.split(" ").map(escaped).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu").test(said);
}

/** A line whose whole name is "Public holiday" says the day is one. */
const NAMES_A_HOLIDAY = /^public\s+holidays?$/i;

/** The line as its words said it, whatever the reader made of them.

    ONLY A REPEAT THE WORDS SAY. "The last Friday of the month" with no
    every, each, monthly, weekly or fortnightly (or the speaker's own word
    for one, `saysRepeat`) is the next one, once: counted here from the day
    the reader gave or today, whichever is later, never by the model, and
    never a series, even when the reader came back with one.

    A PUBLIC HOLIDAY IS WHAT THE LINE CALLS ONE. A line named only "Public
    holiday" claims the day is one, even when it was read as a shutdown or
    an event, and is held to the state's list as one: the action never
    files it. Pure. */
export function asSaid(line: CalendarLine, words: readonly string[], at: LineFrame): CalendarLine {
  const claim = line.kind !== "public_holiday" && NAMES_A_HOLIDAY.test(line.title.trim());
  const read: CalendarLine = claim ? { ...line, kind: "public_holiday", repeat: null, time: null, endTime: null } : line;
  if (!read.repeat || saysRepeat(words, read.repeatWord)) return read;
  const from = read.day && read.day > at.today ? read.day : at.today;
  const next = from > at.windowEnd ? undefined : occurrences(read.repeat, from, at.windowEnd)[0];
  return { ...read, repeat: null, day: next ?? read.day };
}

/** The days a line goes on. A repeat runs from its start (or today, whichever
    is later) to the window's end and never past it: the calendar holds what
    it can show, and the panel's Repeats line says where the series stops. A
    shutdown never repeats; a repeat is one day at a time. */
export function lineDates(line: CalendarLine, at: LineFrame): LineDates {
  if (line.repeat && line.kind === "event") {
    const from = line.day && line.day > at.today ? line.day : at.today;
    if (from > at.windowEnd) return { ok: false, why: "far" };
    const days = occurrences(line.repeat, from, at.windowEnd);
    return days.length ? { ok: true, days, lastDay: null } : { ok: false, why: "far" };
  }
  if (!line.day || Number.isNaN(toDay(line.day))) return { ok: false, why: "no-day" };
  if (line.day < at.windowStart) return { ok: false, why: "past" };
  if (line.day > at.windowEnd) return { ok: false, why: "far" };
  const last = line.lastDay && line.lastDay > line.day && !Number.isNaN(toDay(line.lastDay)) ? line.lastDay : null;
  return { ok: true, days: [line.day], lastDay: last };
}

/* ── what Tiff says ── */

const day = (iso: string) => dayLabel(toDay(iso));

/** Why a line that was read did not go on: its day is outside the twelve months. */
export function outsideLine(why: "past" | "far", windowEnd: string): string {
  return why === "past"
    ? "That day has already gone, so I haven't put it on the calendar."
    : `The calendar runs to ${monthYearLabel(toDay(windowEnd))}, so I haven't put that on it.`;
}

/** When she asked "Which day?" as often as she will and still has none. */
export const NO_DAY = "I couldn't work out a day for that, so nothing went on the calendar.";

/** Her line once it is on: "Done. Toolbox talk is on the calendar for Thu 1 Oct
    at 6:45 am, then the first Thursday of every month until Aug 2027." */
export function filedLine(line: CalendarLine, dates: Extract<LineDates, { ok: true }>): string {
  const first = dates.days[0]!;
  if (dates.lastDay) return `Done. ${line.title} is on the calendar from ${day(first)} to ${day(dates.lastDay)}.`;
  const t = timeLabel(line.time);
  const at = t ? ` at ${t}` : "";
  const last = dates.days.at(-1)!;
  if (line.repeat && dates.days.length > 1) {
    return `Done. ${line.title} is on the calendar for ${day(first)}${at}, then ${repeatPhrase(line.repeat)} until ${monthYearLabel(toDay(last))}.`;
  }
  return `Done. ${line.title} is on the calendar for ${day(first)}${at}.`;
}

/** One line of her plan: the bold lead, then the rest. */
export type LinePlanRow = { lead: string; text: string };

/** Her plan, under her line: "**Thu 1 Oct**, toolbox talk, 6:45 am" and, for a
    repeat, "**Every month**, the first Thursday, until Aug 2027". */
export function linePlan(line: CalendarLine, dates: Extract<LineDates, { ok: true }>): LinePlanRow[] {
  const first = dates.days[0]!;
  const lead = dates.lastDay ? dayRangeLabel(toDay(first), toDay(dates.lastDay)) : day(first);
  const time = timeRangeLabel(line.time, line.endTime);
  const rows: LinePlanRow[] = [{ lead, text: [line.titleInSentence, time].filter(Boolean).join(", ") }];
  if (line.repeat && dates.days.length > 1) {
    /* "Every month, the first Thursday, until Aug 2027": its lead is the
       phrase before the first comma. */
    const words = repeatPlan(line.repeat, dates.days.at(-1)!);
    const cut = words.indexOf(", ");
    rows.push({ lead: words.slice(0, cut), text: words.slice(cut + 2) });
  }
  return rows;
}

/** The door under her line: "11 events on the calendar". */
export const lineDoor = (dates: Extract<LineDates, { ok: true }>): string => eventsDoor(dates.days.length);

/** What a reply is kept on, as she names it: "the toolbox talk on Thu 1 Oct". */
export const lineAbout = (line: CalendarLine, dates: Extract<LineDates, { ok: true }>): string =>
  `the ${line.titleInSentence} on ${day(dates.days[0]!)}`;

/** Her answer when a reply is kept on what she filed. */
export const notedLine = (about: string): string => `Got it. I have added that to ${about}.`;

/** Undo, done: "11 events taken back." */
export const takenBackLine = (n: number): string => `${n} ${n === 1 ? "event" : "events"} taken back.`;

/* ── the days the business is already closed ──

   The calendar already shows two kinds of closed day: the state's public
   holidays (`public_holidays`, not suppressed: what its Public holidays
   chip draws) and the workspace's own shutdowns. A line that claims a
   public holiday is held to that list and never filed; a shutdown on days
   that are all holidays already is not filed twice; and a series never
   lands on either. The action reads them for the days a line found. */

/** A public holiday on the calendar: its day and its name ("Labour Day"). */
export type Holiday = { date: string; name: string };
/** A shutdown already on the calendar, first day to last. */
export type Shutdown = { id: string; startsOn: string; endsOn: string };

type OkDates = Extract<LineDates, { ok: true }>;

/** "A", "A and B", "A, B and C". */
function listed(xs: readonly string[]): string {
  if (xs.length < 2) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

/** Every day a line's dates cover: its one day, or its range, first to last. */
function spanOf(dates: OkDates): string[] {
  const a = toDay(dates.days[0]!);
  const b = dates.lastDay ? toDay(dates.lastDay) : a;
  const out: string[] = [];
  for (let n = a; n <= b; n++) out.push(fromDay(n));
  return out;
}

const byDay = (holidays: readonly Holiday[]) => new Map(holidays.map((h) => [h.date, h.name]));

/** "Labour Day is already on the calendar.", "Christmas Day and Boxing Day
    are already on the calendar." `days` are all holidays. */
function alreadyOn(days: readonly string[], named: ReadonlyMap<string, string>): string {
  const names = days.map((d) => named.get(d)!);
  return `${listed(names)} ${names.length === 1 ? "is" : "are"} already on the calendar.`;
}

/** Her answer to a line that says a day is a public holiday. It is never
    filed: on a day the state's list has, she says it is already on; on one
    it hasn't, she says so and what to say instead. `state` is the
    workspace's ("NSW"), null when it has none and the calendar shows no
    holidays at all. */
export function holidayClaimLine(dates: OkDates, holidays: readonly Holiday[], state: string | null): string {
  const named = byDay(holidays);
  const span = spanOf(dates);
  const off = span.find((d) => !named.has(d));
  if (!off) return alreadyOn(span, named);
  const where = state ? `in ${state}` : "on the calendar";
  return `${day(off)} isn't a public holiday ${where}. If the yard's closed, say it's a shutdown.`;
}

/** Why a shutdown does not go on: every day of it is already a public
    holiday, closed on the calendar already. Null when one day or more is
    not, so a Christmas break over three of them goes on as said. */
export function shutdownOnHolidaysLine(dates: OkDates, holidays: readonly Holiday[]): string | null {
  const named = byDay(holidays);
  const span = spanOf(dates);
  return span.every((d) => named.has(d)) ? alreadyOn(span, named) : null;
}

/** A series' dates less the days the business is already closed, and her
    sentence naming what it skips: "Skips Christmas Day and Good Friday.",
    "Skips Wed 6 Jan in the shutdown.", "Skips 3 dates in the shutdown." A
    holiday is named by its name; a date inside a shutdown by its day, or by
    how many there are. Null when it skips nothing. */
export function openDays(
  days: readonly string[],
  holidays: readonly Holiday[],
  shutdowns: readonly Shutdown[],
): { days: string[]; skips: string | null } {
  const named = byDay(holidays);
  const kept: string[] = [];
  const hols: string[] = [];
  const shut: string[] = [];
  const closures = new Set<string>();
  for (const d of days) {
    const h = named.get(d);
    if (h) {
      hols.push(h);
      continue;
    }
    const inside = shutdowns.filter((s) => s.startsOn <= d && d <= s.endsOn);
    if (inside.length) {
      shut.push(d);
      for (const s of inside) closures.add(s.id);
      continue;
    }
    kept.push(d);
  }
  const parts = [...hols];
  if (shut.length === 1) parts.push(`${day(shut[0]!)} in the shutdown`);
  else if (shut.length) parts.push(`${shut.length} dates in ${closures.size === 1 ? "the shutdown" : "shutdowns"}`);
  return { days: kept, skips: parts.length ? `Skips ${listed(parts)}.` : null };
}

/** When every date a series would land on is already closed. */
export const NO_OPEN_DAY = "Every date it lands on is a public holiday or a shutdown, so nothing went on the calendar.";

/* ── a reply kept on an event ── */

/** The table's own ceiling (`calendar_events.note`). */
export const NOTE_MAX = 2000;

/** A reply added to what the event already says, as another sentence, never
    over it; the newest words are what a full note gives up. */
export function withNote(before: string | null | undefined, reply: string): string {
  const said = reply.replace(/\s+/g, " ").trim();
  const had = String(before ?? "").trim();
  if (!had) return said.slice(0, NOTE_MAX);
  if (!said) return had.slice(0, NOTE_MAX);
  const lead = /[.!?…]$/.test(had) ? had : `${had}.`;
  return `${lead} ${said}`.slice(0, NOTE_MAX);
}

/* ── what landed ── */

/** The first of the events a conversation filed, once the calendar has it:
    the one the page chooses and lights. `ids` are the rows' own ids. */
export function landedEvent<T extends { id: string; start: string }>(
  items: readonly T[],
  ids: readonly string[],
): T | null {
  const want = new Set(ids.map((id) => `ev:${id}`));
  let best: T | null = null;
  for (const x of items) if (want.has(x.id) && (!best || x.start < best.start)) best = x;
  return best;
}
