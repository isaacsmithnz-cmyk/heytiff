/* Calendar days for the Home calendar: plain ISO dates, counted as whole days.

   Everything the calendar holds is a DAY, never a moment: a public holiday, a
   rego running out, the date of a toolbox talk. The loader reads "today" on
   the org's clock (todayInZone / todayInAu) and hands every date over as an
   ISO yyyy-mm-dd string; nothing in here reads a clock.

   Inside, a day is a whole number: days since 1 Jan 1970, built with Date.UTC
   and read back with the getUTC* getters, so no zone and no daylight saving
   can move a date. `new Date("2026-09-01")` is never written: it reads the
   string as an instant, and the day it lands on depends on who asks.

   The words are spelt from tables, not the locale: ICU's en-AU writes "Sept",
   a browser's may not, and a date that renders differently in a test and on a
   screen is a date no test can pin. The months are his handoff's: Jan Feb Mar
   Apr May June July Aug Sept Oct Nov Dec. Ranges take an en dash with spaces. */

const MS_PER_DAY = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec",
] as const;
export const MONTH_NAMES_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** The en dash a range is written with, spaced: "28 Sept – 2 Oct". */
export const DASH = " – ";

function parts(n: number) {
  const d = new Date(n * MS_PER_DAY);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() };
}

/** An ISO date as a day number, or NaN for anything that is not a real
    yyyy-mm-dd day. Date.UTC rolls 31 Feb on into March; a date that rolled was
    never a date, so it is refused rather than moved. */
export function toDay(iso: string | null | undefined): number {
  const m = ISO_DAY.exec(String(iso ?? ""));
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return NaN;
  const n = Date.UTC(y, mo - 1, d) / MS_PER_DAY;
  return parts(n).d === d ? n : NaN;
}

/** A day number back to ISO yyyy-mm-dd. */
export function fromDay(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, as getUTCDay counts. */
export const weekdayOf = (n: number): number => parts(n).wd;
/** 0 = Monday … 6 = Sunday: the column a day sits in on a Monday-first grid. */
export const columnOf = (n: number): number => (parts(n).wd + 6) % 7;
export const dateOf = (n: number): number => parts(n).d;
/** 0 = January. */
export const monthOf = (n: number): number => parts(n).m;
export const yearOf = (n: number): number => parts(n).y;
export const isWeekend = (n: number): boolean => {
  const w = parts(n).wd;
  return w === 0 || w === 6;
};

/** One number per calendar month (year × 12 + month), so months compare and step. */
export const monthKey = (n: number): number => yearOf(n) * 12 + monthOf(n);

/** The 1st of a month. The month may run past 11 or below 0; Date.UTC carries it. */
export function monthStart(year: number, month0: number): number {
  return Date.UTC(year, month0, 1) / MS_PER_DAY;
}

export const monthStartOfKey = (key: number): number => monthStart(Math.floor(key / 12), key - 12 * Math.floor(key / 12));
export const monthEnd = (n: number): number => monthStart(yearOf(n), monthOf(n) + 1) - 1;
/** The same day's month, `k` months on, as its 1st. */
export const monthsOn = (n: number, k: number): number => monthStart(yearOf(n), monthOf(n) + k);

export const dayName = (n: number): string => DAY_NAMES[weekdayOf(n)];
const dayMonth = (n: number): string => `${dateOf(n)} ${MONTH_NAMES[monthOf(n)]}`;
const sameMonth = (a: number, b: number): boolean => monthKey(a) === monthKey(b);

/** "Mon 5 Oct". */
export function dayLabel(n: number): string {
  return `${dayName(n)} ${dayMonth(n)}`;
}

/** "Mon 5 Oct", "Mon 5 – Fri 9 Oct", "Mon 28 Sept – Fri 9 Oct". */
export function dayRangeLabel(a: number, b: number): string {
  if (b <= a) return dayLabel(a);
  if (sameMonth(a, b)) return `${dayName(a)} ${dateOf(a)}${DASH}${dayLabel(b)}`;
  return `${dayLabel(a)}${DASH}${dayLabel(b)}`;
}

/** "5 Oct", "5 – 11 Oct", "28 Sept – 2 Oct": a span with no weekdays. */
export function datesLabel(a: number, b: number): string {
  if (b <= a) return dayMonth(a);
  if (sameMonth(a, b)) return `${dateOf(a)}${DASH}${dayMonth(b)}`;
  return `${dayMonth(a)}${DASH}${dayMonth(b)}`;
}

/** "Aug 2027". */
export const monthYearLabel = (n: number): string => `${MONTH_NAMES[monthOf(n)]} ${yearOf(n)}`;
/** "October 2026". */
export const monthLongLabel = (n: number): string => `${MONTH_NAMES_LONG[monthOf(n)]} ${yearOf(n)}`;

/* ── times of day ──

   A time is wall-clock in the yard, never an instant. Two spellings arrive: a
   Postgres `time` ("06:45" or "06:45:00", which calendar_events and notices
   store) and the words a person reads ("6:45 am"). Both come out as the words. */

/** Minutes past midnight, or null for anything that is not a time. */
export function minutesOf(t: string | null | undefined): number | null {
  const s = String(t ?? "").trim().toLowerCase();
  if (!s) return null;
  let m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    return h < 24 && mi < 60 ? h * 60 + mi : null;
  }
  m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const mi = m[2] ? Number(m[2]) : 0;
    if (h < 1 || h > 12 || mi > 59) return null;
    return ((h % 12) + (m[3] === "pm" ? 12 : 0)) * 60 + mi;
  }
  return null;
}

function clock(min: number): { text: string; half: "am" | "pm" } {
  const h = Math.floor(min / 60);
  return { text: `${h % 12 || 12}:${String(min % 60).padStart(2, "0")}`, half: h < 12 ? "am" : "pm" };
}

/** "6:45 am", "12:00 pm"; null when there is no readable time. */
export function timeLabel(t: string | null | undefined): string | null {
  const m = minutesOf(t);
  if (m == null) return null;
  const c = clock(m);
  return `${c.text} ${c.half}`;
}

/** "6:45 – 7:15 am" inside one half of the day, "11:30 am – 1:00 pm" across
    noon, the start alone with no end. */
export function timeRangeLabel(start: string | null | undefined, end: string | null | undefined): string | null {
  const s = minutesOf(start);
  if (s == null) return null;
  const a = clock(s);
  const e = minutesOf(end);
  if (e == null) return `${a.text} ${a.half}`;
  const b = clock(e);
  return a.half === b.half ? `${a.text}${DASH}${b.text} ${b.half}` : `${a.text} ${a.half}${DASH}${b.text} ${b.half}`;
}
