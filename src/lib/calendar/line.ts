/* A LINE FOR THE CALENDAR — what Tiff read off it, the days it lands on, and
   what she says about it. Pure: no database, no clock, no model.

   "Toolbox talk first Thursday of the month, 6:45", typed into the Calendar's
   box and sorted, or said to its Tiff button. The model (./line-brain) reads
   the line into a `CalendarLine`; this counts its days inside the calendar's
   twelve months (a repeat through ./repeat, which is the only thing that
   counts dates) and writes Tiff's side of it: the line she says, the plan
   under it, the door, and her answer when a reply is kept on what she filed.

   SHARED BY BOTH SIDES OF THE WIRE. The action (app/actions/calendar) writes
   the rows and these words; the Tiff modal says the reply's line itself,
   because the reply's own action only keeps a note. So nothing here reaches
   for the server. */

import { dayLabel, dayRangeLabel, monthYearLabel, timeLabel, timeRangeLabel, toDay } from "./days";
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
  kind: "event" | "shutdown";
  /** The day it happens, or the first day of a range, ISO. For a repeat, the
      day it starts from, when the line said one. */
  day: string | null;
  /** The last day of a one-off that runs over several days, ISO. */
  lastDay: string | null;
  /** Wall-clock "HH:MM", local to the yard. */
  time: string | null;
  endTime: string | null;
  repeat: RepeatRule | null;
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
