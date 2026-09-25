/* REPEATS: "toolbox talk every first Thursday" as the dates it lands on.

   Tiff reads the line ("the first Thursday of the month, 6:45") and returns a
   rule; this code counts the dates. A repeat is materialised, one
   calendar_events row per date sharing a series_id, so every date is counted
   here, once, up to the calendar's window end. A series never rolls forward
   on its own: it stops at the window and its Repeats line says so ("Monthly,
   until Aug 2027").

   The rule is also what calendar_events.repeat keeps, so it is read back
   through `readRepeatRule` whether it came from the model or the database:
   anything that is not a rule this code can count is refused, never guessed. */

import { fromDay, monthKey, monthStartOfKey, monthYearLabel, toDay, weekdayOf } from "./days";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type Nth = 1 | 2 | 3 | 4 | "last";

export type RepeatRule =
  | { every: "week"; day: Weekday }
  /** Every second week, counted from the first `day` on or after the start. */
  | { every: "fortnight"; day: Weekday }
  /** The nth `day` of each month: "the first Thursday", "the last Friday". */
  | { every: "month"; day: Weekday; nth: Nth };

/** The most dates one rule may make. The window is twelve months, so a weekly
    rule makes at most 53; anything past that is a runaway (a far `until`), and
    the calendar would be inserting it in one call. */
export const MAX_OCCURRENCES = 53;

const WEEKDAY_NUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } as const satisfies Record<Weekday, number>;
const WEEKDAY_NAME = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
} as const satisfies Record<Weekday, string>;
const NTH_WORD = { 1: "first", 2: "second", 3: "third", 4: "fourth", last: "last" } as const satisfies Record<Nth, string>;
const WEEKDAYS = Object.keys(WEEKDAY_NAME) as Weekday[];

function readEvery(v: unknown): RepeatRule["every"] | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "week" || s === "weekly") return "week";
  if (s === "fortnight" || s === "fortnightly") return "fortnight";
  if (s === "month" || s === "monthly") return "month";
  return null;
}

/* "thu", "thur", "thurs", "Thursday": three letters or more of the day's name. */
function readDay(v: unknown): Weekday | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s.length < 3) return null;
  return WEEKDAYS.find((d) => WEEKDAY_NAME[d].toLowerCase().startsWith(s)) ?? null;
}

/* 1 to 4, "first" to "fourth", "last" or -1. There is no fifth: most months
   have no fifth Thursday, and a rule that skips months is not what anyone
   asked for. */
function readNth(v: unknown): Nth | null {
  if (v === -1 || v === "last" || v === "-1") return "last";
  const words: Record<string, Nth> = { first: 1, second: 2, third: 3, fourth: 4 };
  if (typeof v === "string" && words[v.trim().toLowerCase()]) return words[v.trim().toLowerCase()];
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d$/.test(v.trim()) ? Number(v) : NaN;
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

/** A rule from the model's answer or the database, or null when it is not one
    this code can count. */
export function readRepeatRule(v: unknown): RepeatRule | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const every = readEvery(o.every);
  const day = readDay(o.day);
  if (!every || !day) return null;
  if (every !== "month") return { every, day };
  const nth = readNth(o.nth);
  return nth == null ? null : { every, day, nth };
}

function nthWeekday(key: number, w: number, nth: Nth): number {
  if (nth === "last") {
    const last = monthStartOfKey(key + 1) - 1;
    return last - ((weekdayOf(last) - w + 7) % 7);
  }
  const first = monthStartOfKey(key);
  return first + ((w - weekdayOf(first) + 7) % 7) + 7 * (nth - 1);
}

/** Every date the rule lands on from `from` to `until`, both inclusive, as ISO
    days in order, at most MAX_OCCURRENCES. Empty for a rule it cannot read or
    a span that runs backwards. */
export function occurrences(rule: RepeatRule, from: string, until: string): string[] {
  const r = readRepeatRule(rule);
  const a = toDay(from);
  const b = toDay(until);
  if (!r || Number.isNaN(a) || Number.isNaN(b) || b < a) return [];
  const w = WEEKDAY_NUM[r.day];
  const out: number[] = [];
  if (r.every === "month") {
    for (let k = monthKey(a); k <= monthKey(b) && out.length < MAX_OCCURRENCES; k++) {
      const n = nthWeekday(k, w, r.nth);
      if (n >= a && n <= b) out.push(n);
    }
  } else {
    const step = r.every === "week" ? 7 : 14;
    for (let n = a + ((w - weekdayOf(a) + 7) % 7); n <= b && out.length < MAX_OCCURRENCES; n += step) out.push(n);
  }
  return out.map(fromDay);
}

/* ── the words ── */

/** "the first Thursday of every month", "every Tuesday", "every second Tuesday":
    what Tiff says after "then", as in "…at 6:45 am, then the first Thursday of
    every month until Aug 2027." */
export function repeatPhrase(rule: RepeatRule): string {
  const day = WEEKDAY_NAME[rule.day];
  if (rule.every === "month") return `the ${NTH_WORD[rule.nth]} ${day} of every month`;
  return rule.every === "week" ? `every ${day}` : `every second ${day}`;
}

/** The panel's Repeats fact: "Monthly, until Aug 2027". `last` is the series' last date. */
export function repeatsFact(rule: RepeatRule, last: string): string {
  const how = rule.every === "month" ? "Monthly" : rule.every === "week" ? "Weekly" : "Fortnightly";
  return `${how}, until ${untilLabel(last)}`;
}

/** Tiff's plan line: "Every month, the first Thursday, until Aug 2027". */
export function repeatPlan(rule: RepeatRule, last: string): string {
  const day = WEEKDAY_NAME[rule.day];
  const until = untilLabel(last);
  if (rule.every === "month") return `Every month, the ${NTH_WORD[rule.nth]} ${day}, until ${until}`;
  return `Every ${rule.every}, on ${day}, until ${until}`;
}

/** The door under Tiff's answer: "1 event on the calendar", "11 events on the calendar". */
export function eventsDoor(count: number): string {
  return `${count} ${count === 1 ? "event" : "events"} on the calendar`;
}

function untilLabel(last: string): string {
  const n = toDay(last);
  if (Number.isNaN(n)) throw new Error(`calendar: a series' last date is not an ISO day: ${JSON.stringify(last)}`);
  return monthYearLabel(n);
}
