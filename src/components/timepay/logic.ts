/* Time & Pay — derive pipeline, ported from the design handoff
   (design_handoff_time_and_pay/app/timepay-review.js). Pure functions only:
   SETTINGS → per-day rate split → weekly buckets → status + issue bullets.

   Deliberate deviations from the prototype, found while verifying its logic:
   - "Sent back" is rendered from status (the prototype patched the DOM and
     lost the tag on re-render despite persisting the action).
   - `dayClass` marks "under" days on weekdays only, matching `derive` (the
     prototype coloured a short Saturday yellow when its penalty rule was off
     but never flagged it for review).
   Known limitation carried over: the `ph` / `night` penalty rules are part of
   the settings but can't apply yet — day entries have no worked-public-holiday
   or night-shift representation.

   A PERIOD IS NOT A WEEK. It's 7, 14 or a calendar month of days depending on
   the pay cycle, so nothing here may assume `days[5]` is a Saturday. Weekend
   and weekday rules key off the DAY OF WEEK, read from the period's own day
   tuples — day 5 of a fortnight is the second Saturday, and day 7 is a
   Monday. Getting this positionally wrong pays weekend rates on a Tuesday. */

export type DayEntry =
  | { t: "work"; in: string; out: string; h: number }
  | { t: "leave" | "sick" | "ph"; h: number }
  | { t: "empty" };

export type RateRule = { on: boolean; rate: 1.5 | 2; up: number | null };

export type Settings = {
  cycle: "Weekly" | "Fortnightly" | "Monthly";
  weekStart: string;
  /** Start date (ISO) of one fortnightly period; every fortnight counts in
      14-day steps from here. Null = a fixed epoch fallback. Fortnightly only. */
  fortnightAnchor: string | null;
  /** Day of month a monthly period begins (1..28). 1 = calendar month. */
  monthStartDay: number;
  standard: number;
  otAfter: number;
  otUnit: "day" | "week";
  rules: { sat: RateRule; sun: RateRule; ph: RateRule; night: RateRule };
  dblAfter: number;
  /** The org's standard unpaid/paid break, in minutes. 0 = none configured,
      which is the default so an existing workspace sees no change until
      someone opts in. */
  breakMinutes: number;
  /** Paid breaks are on the clock: nothing is deducted, and a person can't
      shorten one per day because it makes no difference to their hours. */
  breakPaid: boolean;
  submitDay: string;
  submitTime: string;
  lock: boolean;
  exportDetail: boolean;
};

/* A person's week.

   `rate` is NULLABLE and that is the whole money boundary in one field. The
   team screen's query selects the rate column only for a viewer holding
   `financials`; the my-timesheet query always includes your own. So an
   hours-only payload literally has no rate to compute a wage from — the
   absence is structural, not a render-time decision.

   Keyed by `id` (staff_profiles.id), not by name: two people can share a name,
   and the approval envelope has to point at a row. */
export type StaffWeek = {
  id: string;
  name: string;
  role: string;
  rate: number | null;
  days: DayEntry[];
};

/* ['MON', 29, 'Jun'] — weekday label, day number, month */
export type WeekDay = [string, number, string];
export type WeekCtx = { week: WeekDay[]; today: number };

export type Split = { n: number; o15: number; o2: number };

export type Derived = {
  normal: number;
  ot: number;
  ot2: number;
  sick: number;
  leave: number;
  ph: number;
  worked: number;
  entries: number;
  weighted: number;
  under: number;
  missing: number;
  status: "review" | "ready";
  bullets: string[];
  issueTitle: string;
  /** null whenever the rate is absent — there is no wage to state. */
  gross: number | null;
};

export type StaffStatus = "review" | "ready" | "approved" | "sent";
export type DayClass = "std" | "over" | "under" | "leave" | "sick" | "ph" | "empty" | "miss";

export const DEFAULT_SETTINGS: Settings = {
  cycle: "Weekly",
  weekStart: "Mon",
  fortnightAnchor: null,
  monthStartDay: 1,
  standard: 8,
  otAfter: 8,
  otUnit: "day",
  rules: {
    sat: { on: true, rate: 1.5, up: 2 },
    sun: { on: true, rate: 2, up: null },
    ph: { on: true, rate: 2, up: null },
    night: { on: true, rate: 2, up: null },
  },
  dblAfter: 12,
  breakMinutes: 0,
  breakPaid: true,
  submitDay: "Sun",
  submitTime: "3:00 PM",
  lock: true,
  exportDetail: false,
};

export const fmt = (h: number | null | undefined): string =>
  h == null ? "—" : Number.isInteger(h) ? String(h) : h.toFixed(1);

export const fmtHval = (v: number): string => fmt(v) + "h";

/* Hours at the precision they are STORED: 8 → "8", 7.5 → "7.5", 7.67 → "7.67".

   `fmt` rounds to one place, which is right for a review column where the eye
   is scanning a grid. It is wrong for My timesheet: that screen states the
   number it is about to save, and a derived 7.67h printed as "7.7h" is the
   same species of lie as the typed-hours field this replaced. */
export const fmtH = (h: number | null | undefined): string =>
  h == null ? "—" : String(Math.round(h * 100) / 100);

/* "Mon 29 Jun" from a week-day tuple */
export const dayLabel = (w: WeekDay): string =>
  w[0].charAt(0) + w[0].slice(1).toLowerCase() + " " + w[1] + " " + w[2];

/* ---------------- clock → hours ----------------

   HOURS ARE DERIVED, NEVER TYPED. A worked day used to carry a start, a
   finish AND a hand-entered `h`, which meant a day could be saved with both
   times filled and 0.00 hours — a timesheet that looks complete and pays
   nothing. The times are the entry; the hours are what the times mean.

   `start_time`/`end_time` are TEXT columns holding whatever the person typed
   ("7:00 AM"), because that is the format the design asks for and the one an
   installer writes on a docket. So the parser has to be forgiving of the ways
   the same moment gets written — but only in ways that can't mean two things.
   Anything it can't read returns null, and null means "don't save", not
   "zero". */

/** Minutes since midnight for a typed clock time, or null if unreadable.

    Accepted: "7:00 AM", "07:00", "3.30 pm", "7 AM", "15:30", "0700", "7pm",
    "7.00a.m.". Rejected (null): empty, "half seven", "25:00", "7:60", a
    12-hour reading outside 1–12, and any bare number that isn't 1–2 digits
    (an hour) or exactly 4 (HHMM). One-digit minutes read literally: "3.3 pm"
    is 3:03 PM, not 3:30 — padding it the other way would silently invent
    half an hour. */
export function parseClock(input: string): number | null {
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;

  // meridiem, however it's punctuated: "am", "a.m.", "AM", " pm"
  let mer: "am" | "pm" | null = null;
  const m = s.match(/([ap])\.?\s?m\.?$/);
  if (m) {
    mer = m[1] === "a" ? "am" : "pm";
    s = s.slice(0, m.index).trim();
  }
  if (!s) return null;

  let hh: number;
  let mm: number;
  const sep = s.match(/^(\d{1,2})\s*[:.]\s*(\d{1,2})$/);
  if (sep) {
    hh = Number(sep[1]);
    mm = Number(sep[2]);
  } else if (/^\d{4}$/.test(s)) {
    // "0700" / "1530" — unambiguous because it's exactly four digits
    hh = Number(s.slice(0, 2));
    mm = Number(s.slice(2));
  } else if (/^\d{1,2}$/.test(s)) {
    hh = Number(s);
    mm = 0;
  } else return null;

  if (mm > 59) return null;
  if (mer) {
    if (hh < 1 || hh > 12) return null;
    if (hh === 12) hh = 0;
    if (mer === "pm") hh += 12;
  } else if (hh > 23) return null;

  return hh * 60 + mm;
}

/** Hours between two typed times, or null if either is unreadable.

    A finish at or before the start crosses midnight and gains 24h — a night
    shift is the normal reason two times run "backwards", and reading it as a
    negative day would be worse than reading it as a long one. */
export function spanHours(start: string, end: string): number | null {
  const a = parseClock(start);
  const b = parseClock(end);
  if (a == null || b == null) return null;
  return ((b <= a ? b + 1440 : b) - a) / 60;
}

/** What a worked day is actually worth: the span, less the break when the
    break is unpaid. Null when the times can't be read — the caller must
    refuse to save rather than write a zero.

    `overrideMin` lets one day deviate from the org's standard break; it is
    ignored when the break is paid, because a paid break deducts nothing and
    there is nothing to deviate from. The deduction is clamped at the span, so
    a 20-minute call-out with a 30-minute break is 0h, never −0.17h. */
export function derivedDayHours(
  start: string,
  end: string,
  s: Settings,
  overrideMin?: number,
): number | null {
  const span = spanHours(start, end);
  if (span == null) return null;
  const mins = s.breakPaid ? 0 : Math.max(0, overrideMin ?? s.breakMinutes);
  const deduct = Math.min(mins / 60, span);
  return Math.round((span - deduct) * 100) / 100;
}

/** The break minutes to put in a day's stepper when its editor opens.

    A per-day break has nowhere to live — a time entry is (kind, start, end,
    hours) and the actions are not changing — so it is recovered from what was
    saved: span minus stored hours IS the break that was taken. Falls back to
    the org standard when there's nothing to read it from or the answer is out
    of the stepper's range. */
export function seedBreakMinutes(entry: DayEntry, s: Settings): number {
  if (s.breakPaid || s.breakMinutes <= 0 || entry.t !== "work") return s.breakMinutes;
  const span = spanHours(entry.in, entry.out);
  if (span == null) return s.breakMinutes;
  const mins = Math.round(((span - entry.h) * 60) / 5) * 5;
  return mins >= 0 && mins <= 120 ? mins : s.breakMinutes;
}

/** "Break: 30 min · unpaid" — the one sentence, so the editor and the rules
    footnote can't word it differently. Empty when no break is configured. */
export function breakLine(s: Settings, mins?: number): string {
  const n = mins ?? s.breakMinutes;
  if (s.breakMinutes <= 0) return "";
  return `Break: ${n} min · ${s.breakPaid ? "paid" : "unpaid"}`;
}

const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** Day of week (Mon 0 … Sun 6) for a period day — NOT its column index. */
export const dowOf = (w: WeekDay | undefined): number => (w ? DOW.indexOf(w[0]) : 0);

export const isWeekend = (dow: number): boolean => dow >= 5;

/* Split one worked day's hours into rate buckets using the workspace rules.
   `dow` is the DAY OF WEEK (Mon 0 … Sun 6), not a position in the period —
   use dowOf(ctx.week[i]) to get it. */
export function splitDay(h: number, dow: number, s: Settings): Split {
  const wknd = (k: "sat" | "sun"): Split | null => {
    const rl = s.rules[k];
    if (!rl.on) return null;
    if (rl.rate === 2) return { n: 0, o15: 0, o2: h };
    const a = Math.min(h, rl.up || 0);
    return { n: 0, o15: a, o2: h - a };
  };
  if (dow === 5) {
    const r = wknd("sat");
    if (r) return r;
  }
  if (dow === 6) {
    const r = wknd("sun");
    if (r) return r;
  }
  const o2 = Math.max(0, h - s.dblAfter);
  const rest = h - o2;
  const n = s.otUnit === "day" ? Math.min(rest, s.otAfter) : rest;
  const o15 = rest - n;
  return { n, o15, o2 };
}

export function derive(staff: StaffWeek, s: Settings, ctx: WeekCtx): Derived {
  let normal = 0,
    ot = 0,
    ot2 = 0,
    sick = 0,
    leave = 0,
    ph = 0,
    worked = 0,
    entries = 0,
    under = 0,
    missing = 0;
  const bullets: string[] = [];
  const dlab = (i: number) => dayLabel(ctx.week[i]);
  // weekly-overtime mode caps NORMAL hours PER WEEK, so a fortnight or month
  // is bucketed into 7-day chunks from the period start — otherwise 38h + 38h
  // across a fortnight reads as a week's worth of overtime. Weekly cycle = one
  // bucket, so its result is unchanged.
  const weekNormal: number[] = [];
  const bucketOf = (i: number) => Math.floor(i / 7);

  staff.days.forEach((d, i) => {
    const dow = dowOf(ctx.week[i]);
    if (d.t === "work") {
      const sp = splitDay(d.h, dow, s);
      normal += sp.n;
      weekNormal[bucketOf(i)] = (weekNormal[bucketOf(i)] ?? 0) + sp.n;
      ot += sp.o15;
      ot2 += sp.o2;
      worked += d.h;
      entries++;
      if (isWeekend(dow)) {
        const dayName = dow === 5 ? "Saturday" : "Sunday";
        if (sp.o15 || sp.o2)
          bullets.push(
            dlab(i) +
              " — " +
              fmt(d.h) +
              "h at " +
              dayName +
              " rates" +
              (sp.o15 && sp.o2
                ? " (" + fmt(sp.o15) + "h @1.5×, then " + fmt(sp.o2) + "h @2×)"
                : sp.o2
                  ? " (all @2×)"
                  : " (@1.5×)")
          );
      } else {
        if (sp.o15 || sp.o2)
          bullets.push(
            dlab(i) +
              " — worked " +
              d.in +
              " – " +
              d.out +
              " (" +
              fmt(d.h) +
              "h, " +
              fmt(sp.o15 + sp.o2) +
              "h over standard)"
          );
        if (d.h < s.standard) {
          under++;
          bullets.push(dlab(i) + " — under day: " + fmt(d.h) + "h of " + fmt(s.standard) + "h");
        }
      }
    } else if (d.t === "sick") {
      sick += d.h;
      entries++;
      bullets.push(dlab(i) + " — sick day (" + fmt(d.h) + "h paid) — confirm a certificate if required");
    } else if (d.t === "leave") {
      leave += d.h;
      entries++;
      bullets.push(dlab(i) + " — annual leave (" + fmt(d.h) + "h) — check it was requested");
    } else if (d.t === "ph") {
      ph += d.h;
      entries++;
    } else if (d.t === "empty" && !isWeekend(dow) && i <= ctx.today) {
      missing++;
      bullets.push(dlab(i) + " — no entry logged");
    }
  });

  /* weekly overtime mode: each week's excess over the threshold moves to 1.5×,
     summed across the period's weeks (one week for the weekly cycle). */
  if (s.otUnit === "week") {
    const ex = weekNormal.reduce((sum, wn) => sum + Math.max(0, (wn ?? 0) - s.otAfter), 0);
    normal -= ex;
    ot += ex;
  }
  if (ot || ot2) {
    bullets.push(
      "Overtime total — " +
        (ot ? fmt(ot) + "h @1.5×" : "") +
        (ot && ot2 ? " + " : "") +
        (ot2 ? fmt(ot2) + "h @2×" : "")
    );
  }

  const weighted = normal + ot * 1.5 + ot2 * 2 + sick + leave + ph;
  const status = ot || ot2 || under || missing || sick || leave ? "review" : "ready";
  const issueTitle = missing
    ? "Missing entries to chase"
    : ot2 && ot
      ? "Overtime & double time to confirm"
      : ot2
        ? "Double time to confirm"
        : ot
          ? "Overtime to confirm"
          : under
            ? "Under days to check"
            : sick && leave
              ? "Sick & leave to confirm"
              : sick
                ? "Sick leave to confirm"
                : leave
                  ? "Annual leave to confirm"
                  : "To confirm";

  return {
    normal,
    ot,
    ot2,
    sick,
    leave,
    ph,
    worked,
    entries,
    weighted,
    under,
    missing,
    status,
    bullets,
    issueTitle,
    gross:
      staff.rate == null
        ? null
        : normal * staff.rate +
          ot * staff.rate * 1.5 +
          ot2 * staff.rate * 2 +
          (sick + leave + ph) * staff.rate,
  };
}

/* A period splits into calendar weeks for display: a fortnight reads as two
   week-rows and a month as four-or-five, which is how a pay period is actually
   read. Buckets are the same 7-day chunks the weekly-overtime rule uses, so
   the week boundaries the eye sees are the ones pay is calculated on.

   `start`/`end` index into the ORIGINAL days[] so callers keep passing the
   right `i` to dayClass/splitDay (which read the absolute weekday). */
export type WeekGroup = {
  label: string; // "Week 1", or the sole group is unlabelled by the caller
  start: number; // first day index (inclusive)
  days: { entry: DayEntry; index: number }[];
  workedHours: number; // worked + leave + sick + ph — the week's paid hours
};

export function weekGroups(days: DayEntry[]): WeekGroup[] {
  const groups: WeekGroup[] = [];
  for (let i = 0; i < days.length; i++) {
    const w = Math.floor(i / 7);
    if (!groups[w]) groups[w] = { label: `Week ${w + 1}`, start: i, days: [], workedHours: 0 };
    const entry = days[i];
    groups[w].days.push({ entry, index: i });
    if (entry.t !== "empty") groups[w].workedHours += entry.h;
  }
  return groups;
}

/* Day → colour class, driven by the same split rules as pay. */
export function dayClass(d: DayEntry, i: number, s: Settings, ctx: WeekCtx): DayClass {
  const dow = dowOf(ctx.week[i]);
  const weekday = !isWeekend(dow);
  if (d.t === "empty") return weekday && i <= ctx.today ? "miss" : "empty";
  if (d.t === "leave") return "leave";
  if (d.t === "sick") return "sick";
  if (d.t === "ph") return "ph";
  const sp = splitDay(d.h, dow, s);
  if (sp.o15 || sp.o2) return "over";
  /* under days apply to weekdays only, matching derive's review flag */
  return weekday && d.h < s.standard ? "under" : "std";
}

export const initials = (n: string): string =>
  n
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const nameHue = (n: string): number => {
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
  return h;
};

export const ruleSummary = (rl: RateRule): string =>
  rl.rate === 2 ? "2× all day" : "1.5× first " + fmtHval(rl.up ?? 0) + " · then 2×";

export const submitNote = (s: Settings): string =>
  "Open · auto-submits " + s.submitDay + " " + s.submitTime + (s.lock ? " · then locks" : "");
