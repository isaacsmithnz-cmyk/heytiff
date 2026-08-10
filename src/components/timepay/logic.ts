/* Time & Pay — derive pipeline, ported from the design handoff
   (design_handoff_time_and_pay/app/timepay-review.js). Pure functions only:
   SETTINGS → per-day rate split → weekly buckets → status + issue bullets.

   Deliberate deviations from the prototype, found while verifying its logic:
   - "Sent back" is rendered from status (the prototype patched the DOM and
     lost the tag on re-render despite persisting the action).
   - `dayClass` marks "under" days on EXPECTED days only, matching `derive`
     (the prototype coloured a short Saturday yellow when its penalty rule was
     off but never flagged it for review). "Expected" was "is it a weekday"
     until working patterns arrived; see WeekCtx.
   Known limitation carried over: the `ph` / `night` penalty rules are part of
   the settings but can't apply yet — day entries have no worked-public-holiday
   or night-shift representation.

   A PERIOD IS NOT A WEEK. It's 7, 14 or a calendar month of days depending on
   the pay cycle, so nothing here may assume `days[5]` is a Saturday. Weekend
   and weekday rules key off the DAY OF WEEK, read from the period's own day
   tuples — day 5 of a fortnight is the second Saturday, and day 7 is a
   Monday. Getting this positionally wrong pays weekend rates on a Tuesday. */

import type { EmploymentClass } from "@/lib/staff/employment";

export type DayEntry =
  | { t: "work"; in: string; out: string; h: number }
  | { t: "leave" | "sick" | "ph"; h: number }
  /** A weekday you deliberately did NOT work, and that isn't leave. Stored, so
      it survives the normal-day presumption below — without it, "I wasn't on
      site Tuesday" would be re-filled as a normal day every time the page
      loaded, and the only way to say otherwise would be to book leave. */
  | { t: "off" }
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
  /** The workspace's normal start and finish. Every Mon–Fri is presumed to be
      these hours unless something says otherwise — see `presumeDays`. A person
      may override them for themselves; the org value is the fallback, never a
      floor. */
  defaultStart: string;
  defaultEnd: string;
  /** Which days of the week are normal working days here (Mon 0 … Sun 6).
      A person may keep their own — a part-timer on Mon/Tue/Thu is the reason
      this exists, because without it their Wednesday is presumed worked every
      week of their life. */
  workDays: number[];
  submitDay: string;
  submitTime: string;
  lock: boolean;
  exportDetail: boolean;
  /** The org's superannuation guarantee %. Owned HERE (Time & Pay settings),
      read by My Pay and the Rate Calculator — it used to live in the
      calculator's own blob, which made a pricing edit change what every
      staff member saw as their super. Null = never set; consumers fall back
      to the statutory default rather than storing a guess. */
  superPct?: number | null;
  /** WORKING days at or above which personal leave should carry a medical
      certificate. Null = never ask, which is what every existing workspace
      gets. 2 is the usual reading of "two or more consecutive days"; 1 means
      always.

      A PROMPT, never a gate — see `certificateExpected` in lib/timepay/leave.ts
      and the migration. Somebody booking a sick day is often not holding the
      certificate yet, and a workspace that refused the request would push the
      absence off the books rather than get the document sooner. */
  certAfterDays?: number | null;
  /** Whether a salaried person's overtime block PAYS (at the weekend/OT
      rules, on their salary-derived hourly) or is absorbed — "reasonable
      additional hours" inside the salary. The block is RECORDED either way;
      this only decides whether it moves money. */
  salariedOtPaid?: boolean;
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
  /** whose public-holiday calendar applies to them — needed to presume their
      days off correctly when an org spans more than one state */
  state?: string | null;
  /** what kind of employee they are, already classified. Decides whether their
      week is filled in for them at all — a casual's never is. */
  employment?: EmploymentClass;
  /** the days they're expected (Mon=0), resolved by the loader. The review
      screen must derive each person through their OWN pattern — a shared
      Mon–Fri ctx showed every casual five "missing" days a week. */
  workDays?: number[];
  /** how their pay is computed. A salaried week pays the same whatever the
      sheet says; recorded hours stay hours, and overtime pays (or doesn't)
      per the org's salariedOtPaid rule. */
  payBasis?: "hourly" | "salary";
  /** THEIR public holidays in this period, by day index — resolved through
      their own state, so an interstate worker is paid their own calendar. */
  holidayDays?: number[];
  /** their sick days still waiting on a medical certificate, by day index */
  certMissing?: number[];
};

/* ['MON', 29, 'Jun'] — weekday label, day number, month */
export type WeekDay = [string, number, string];

/* Reading a week needs two different questions answered about a day, and they
   were the same question for as long as everyone worked Monday to Friday:

     IS IT A WEEKEND?  a calendar fact, and the one that sets PAY RATES.
                       Saturday pays Saturday rates whoever you are.
     WAS THIS PERSON EXPECTED?  a roster fact, and the one that decides what
                       gets presumed and what counts as a missing day.

   `isWeekend` answers the first and must stay calendar-based. `workDays`
   answers the second, per person: Mon–Fri for most, three days for a
   part-timer, and EMPTY for a casual — who is never expected, so nothing is
   presumed onto their week and no day of it can be "missing". */
export type WeekCtx = {
  week: WeekDay[];
  today: number;
  workDays?: number[];
  /** The last index whose day is OVER — the same number the presumption uses.
      Absent means "derive it from `today`", which is only right for a live
      period; a closed one must pass it explicitly (every day of it is over). */
  through?: number;
  /** Which of this period's days are gazetted public holidays, by index.

      A public holiday is a fact about the DATE, not about the entry: a person
      who works one enters an ordinary worked day, and the holiday rate has to
      come from the calendar. Resolved per person by the loader, because an
      interstate worker's calendar is their own. */
  holidays?: readonly number[];
  /** Sick days whose leave request wants a medical certificate and hasn't got
      one, by index. Resolved by the loader — see `presumeFor`.

      WHETHER, NEVER THE DOCUMENT. The bullet this feeds says a certificate is
      outstanding; the file itself lives on the leave screen behind
      `approvals`. A timesheet approver is being told there is paperwork to
      chase, not handed somebody's medical evidence. */
  certMissing?: readonly number[];
};

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
  /** weekdays deliberately marked "not worked" — always a review item */
  off: number;
  missing: number;
  status: "review" | "ready";
  bullets: string[];
  issueTitle: string;
  /** null whenever the rate is absent — there is no wage to state. */
  gross: number | null;
};

export type StaffStatus = "review" | "ready" | "approved" | "sent";
export type DayClass = "std" | "over" | "under" | "leave" | "sick" | "ph" | "empty" | "miss" | "off";

/* ONE WORD PER DAY STATE, and every surface says it.

   There were three vocabularies for these nine states — the tiles, the admin
   legend, and a private list inside my-timesheet — so one day was a "Short
   day" in its pill, a "Short" in one legend and an "Under day" in the other,
   and a day you deliberately didn't work was "Off" in the strip, "Not worked"
   in its pill and "Didn't work" on the button that set it. Nobody decided
   that; it is what happens when four places name the same thing.

   It lives HERE, beside the type it is keyed on, rather than in tiles.tsx:
   that file is `"use client"`, and `derive` — which runs on the server — needs
   these words too. Anything that NAMES a state reads this map, and the legend
   is built from it, so a tenth state can't reach one and miss the other. */
export const DAY_WORD: Record<DayClass, string> = {
  std: "Normal",
  over: "Overtime",
  under: "Short",
  leave: "Leave",
  sick: "Sick",
  ph: "Public holiday",
  off: "Not worked",
  miss: "Missing",
  empty: "No entry",
};

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
    /* OFF by default, unlike the other three. A night penalty that starts at
       10 PM also ends at 6 AM, and a trade that starts at 5:30 would pay half
       an hour of double time every single day without anyone choosing it.
       Defaulting a rule ON is only safe when the ordinary day doesn't touch
       it — and an early start is the ordinary day here. */
    night: { on: false, rate: 2, up: null },
  },
  dblAfter: 12,
  breakMinutes: 0,
  breakPaid: true,
  /* 7:00 – 3:00 is exactly the 8h standard day, so a workspace that never
     touches this setting has every presumed day land on `std` rather than
     tripping the overtime rule by half an hour, every day, forever. */
  defaultStart: "7:00 AM",
  defaultEnd: "3:00 PM",
  workDays: [0, 1, 2, 3, 4], // Mon–Fri
  submitDay: "Sun",
  submitTime: "3:00 PM",
  lock: true,
  exportDetail: false,
  superPct: null,
  salariedOtPaid: true,
  certAfterDays: null,
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

/** "30 min unpaid break" — the one phrasing, so the editor and the rules
    footnote can't word it differently. Empty when no break is configured.

    TWO THINGS IT USED TO GET WRONG. It read "Break: 30 min · unpaid", and that
    interior "·" is the same separator the rules footnote joins its ITEMS with
    — so the footnote ran "30 min break · unpaid · Sat 1.5× first 2h · then 2×"
    and there was no way to tell which dots divided rules from which dots were
    inside one. And a day whose break was recovered as zero (`seedBreakMinutes`
    reads it back out of the saved entry) rendered "Break: 0 min · unpaid":
    a payment status for a break that isn't there. */
export function breakLine(s: Settings, mins?: number): string {
  const n = mins ?? s.breakMinutes;
  if (s.breakMinutes <= 0) return "";
  if (n <= 0) return "No break on this day";
  return `${n} min ${s.breakPaid ? "paid" : "unpaid"} break`;
}

const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** Day of week (Mon 0 … Sun 6) for a period day — NOT its column index. */
export const dowOf = (w: WeekDay | undefined): number => (w ? DOW.indexOf(w[0]) : 0);

export const isWeekend = (dow: number): boolean => dow >= 5;

export const DEFAULT_WORK_DAYS = [0, 1, 2, 3, 4];

/** Was this person expected at work on this day of the week? Defaults to
    Mon–Fri when a context doesn't carry a roster, so every existing caller
    reads exactly as it did. */
export const expectsWork = (ctx: WeekCtx, dow: number): boolean =>
  (ctx.workDays ?? DEFAULT_WORK_DAYS).includes(dow);

/** Is this day OVER? Not "has it started" — over.

    TODAY IS NOT OVER, and that is the whole point of this function. The
    presumption already knew: it fills a weekday in only once the day has
    ended, because at 6am on Tuesday there is nothing to put in yet. The
    missing-entry check used `i <= today` and so disagreed by exactly one day —
    it chased people at breakfast for a day they were about to work.

    Both questions now read the same number. `through` comes from the dates
    (`dates.filter(d => d < todayISO).length - 1`), so a closed period has all
    of its days over and a period that hasn't started has none. */
export const isOver = (ctx: WeekCtx, i: number): boolean =>
  i <= (ctx.through ?? ctx.today - 1);

/** How many days of this period could still gain hours.

    SUBMITTING IS IRREVERSIBLE FROM THE PERSON'S SIDE — the sheet locks, and
    only a manager sending it back reopens it. So a Submit pressed on
    Wednesday froze Thursday and Friday out of the week: `materialise` writes
    rows only for days that are OVER, so those two went in as nothing and the
    screen that could have fixed them was read-only. The recovery was a
    conversation with a manager, for a mistake that took one tap to make.

    Zero means there is nothing left to lose by sending it. A rostered
    person's remaining days are their EXPECTED ones — a Saturday nobody was
    going to work is not a reason to hold a finished week open, which is what
    counting every day would do (a weekly cycle whose Sunday isn't over until
    Monday would never unlock its own button, and the Sunday auto-submit would
    be the only way a sheet was ever sent).

    A casual has no expected days at all, so for them it is every day left:
    nothing is presumed onto their week, and any day of it is one they might
    still work. */
export function daysToCome(ctx: WeekCtx): number {
  const roster = ctx.workDays ?? DEFAULT_WORK_DAYS;
  return ctx.week.reduce(
    (n, w, i) =>
      n + (!isOver(ctx, i) && (roster.length === 0 || expectsWork(ctx, dowOf(w))) ? 1 : 0),
    0,
  );
}

/** "Mon, Tue, Thu" — a working pattern in the order the week runs. */
export const workDaysLabel = (days: number[]): string => {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const on = names.filter((_, i) => days.includes(i));
  if (on.length === 0) return "No set days";
  if (on.length === 7) return "Every day";
  return on.join(", ");
};

/* The night window: 10 PM to 6 AM, the span the settings screen has always
   named beside the night rule. */
export const NIGHT_FROM_MIN = 22 * 60;
export const NIGHT_TO_MIN = 6 * 60;

/** How much of a worked span falls inside the night window.

    A shift is at most a day long but may cross midnight — 6 PM to 2 AM is
    four ordinary hours and four night ones — so the overlap is measured on an
    extended timeline where a finish at or before the start gains 24h, exactly
    like `spanHours`. Capped at the day's PAID hours, because an unpaid break
    inside the window isn't night work. */
export function nightHours(start: string, end: string, paid: number): number {
  const a = parseClock(start);
  const b0 = parseClock(end);
  if (a == null || b0 == null) return 0;
  const b = b0 <= a ? b0 + 1440 : b0;
  /* The night windows a single shift can touch: this morning's tail, tonight,
     and tomorrow morning's tail for a shift that started late. */
  const windows: [number, number][] = [
    [0, NIGHT_TO_MIN],
    [NIGHT_FROM_MIN, 1440 + NIGHT_TO_MIN],
    [1440 + NIGHT_FROM_MIN, 2880 + NIGHT_TO_MIN],
  ];
  let mins = 0;
  for (const [ws, we] of windows) mins += Math.max(0, Math.min(b, we) - Math.max(a, ws));
  return Math.min(Math.round((mins / 60) * 100) / 100, paid);
}

/* Split one worked day's hours into rate buckets using the workspace rules.
   `dow` is the DAY OF WEEK (Mon 0 … Sun 6), not a position in the period —
   use dowOf(ctx.week[i]) to get it.

   THE ORDER IS THE POLICY, and it is "the day's own rate, then the clock":

     PUBLIC HOLIDAY   outranks everything. It is the most specific fact about
                      the day, and a gazetted holiday that lands on a Saturday
                      pays holiday rates, not Saturday ones.
     WEEKEND          the whole day, as it always has.
     NIGHT            a PORTION, not a day rate — the hours inside the window
                      pay the night rule and the REST goes through the
                      ordinary overtime ladder. Removing them from the total
                      first is what stops the same hour being paid twice.

   PENALTIES NEVER STACK. A whole-day rule has already taken the day by the
   time night is considered, so a Sunday night shift pays Sunday rates for all
   of it rather than Sunday-plus-night for part. That is the conservative
   reading, it is what awards generally mean by "the higher rate applies", and
   it is the one a person can check in their head. */
export function splitDay(
  h: number,
  dow: number,
  s: Settings,
  /** What else is true about this day — the date's holiday status, and the
      clocks the night window is measured against. */
  day: { publicHoliday?: boolean; in?: string; out?: string } = {},
): Split {
  const whole = (rl: RateRule, hours: number): Split => {
    if (rl.rate === 2) return { n: 0, o15: 0, o2: hours };
    const a = Math.min(hours, rl.up || 0);
    return { n: 0, o15: a, o2: hours - a };
  };

  if (day.publicHoliday && s.rules.ph.on) return whole(s.rules.ph, h);
  if (dow === 5 && s.rules.sat.on) return whole(s.rules.sat, h);
  if (dow === 6 && s.rules.sun.on) return whole(s.rules.sun, h);

  const night =
    s.rules.night.on && day.in && day.out ? nightHours(day.in, day.out, h) : 0;
  const atNight = night > 0 ? whole(s.rules.night, night) : { n: 0, o15: 0, o2: 0 };

  const rest = Math.round((h - night) * 100) / 100;
  const o2 = Math.max(0, rest - s.dblAfter);
  const ladder = rest - o2;
  const n = s.otUnit === "day" ? Math.min(ladder, s.otAfter) : ladder;
  const o15 = ladder - n;
  return { n, o15: o15 + atNight.o15, o2: o2 + atNight.o2 };
}

/* WHAT THE CARD'S HEADING SAYS, when the list under it is mixed.

   It used to name the single highest-priority issue and stop: a week with one
   unlogged Friday and two overtime days was headed "Missing entries to
   chase", over three bullets of which two were overtime. The heading was the
   only thing an approver read before deciding whether the card needed them,
   and it described a third of the card.

   So it names every kind present, in the order they matter. The verb survives
   for a single-issue card — "Overtime to confirm" is what an approver would
   say out loud, and that is most cards — and drops once there is more than
   one, because no one verb is true of them all. Three at most, then a count:
   a heading is a glance, and the bullets are already there for the rest. */
const ISSUE_KINDS = [
  ["missing", "Missing entries", "to chase"],
  ["off", "Days not worked", "to check"],
  ["ot2", "Double time", "to confirm"],
  ["ot", "Overtime", "to confirm"],
  ["under", "Short days", "to check"],
  ["sick", "Sick leave", "to confirm"],
  ["leave", "Annual leave", "to confirm"],
] as const;

export function issueHeading(counts: Record<(typeof ISSUE_KINDS)[number][0], number>): string {
  const present = ISSUE_KINDS.filter(([k]) => counts[k] > 0);
  if (present.length === 0) return "To confirm";
  if (present.length === 1) return `${present[0][1]} ${present[0][2]}`;
  const shown = present.slice(0, 3).map(([, label]) => label);
  const rest = present.length - shown.length;
  return shown.join(" · ") + (rest > 0 ? ` · +${rest}` : "");
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
    off = 0,
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
      /* A worked public holiday is an ordinary `work` entry on a holiday
         DATE — the calendar says which, not the entry. */
      const onHoliday = (ctx.holidays ?? []).includes(i);
      const sp = splitDay(d.h, dow, s, { publicHoliday: onHoliday, in: d.in, out: d.out });
      normal += sp.n;
      weekNormal[bucketOf(i)] = (weekNormal[bucketOf(i)] ?? 0) + sp.n;
      ot += sp.o15;
      ot2 += sp.o2;
      worked += d.h;
      entries++;
      /* Working a public holiday always reaches the approver: it is unusual
         by definition, and it is the most expensive day in the period. */
      if (onHoliday) {
        bullets.push(
          dlab(i) +
            " — worked the public holiday (" +
            fmt(d.h) +
            "h" +
            (s.rules.ph.on ? " at public-holiday rates" : ", at ordinary rates — the holiday rule is off") +
            ")",
        );
      } else if (isWeekend(dow)) {
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
        /* Night hours are a slice of an ordinary day, so they get their own
           line — the over-standard bullet below would otherwise report them
           as overtime, which is a different thing and a different reason. */
        const night = s.rules.night.on ? nightHours(d.in, d.out, d.h) : 0;
        if (night > 0)
          bullets.push(
            dlab(i) + " — " + fmt(night) + "h of night work (10 PM – 6 AM) at night rates",
          );
        /* Only the LADDER's overtime is "over standard". The night slice is
           already in o15/o2 and already has its own line — counting it here
           too would report the same hours twice, under the wrong reason. */
        const overStandard = Math.round((sp.o15 + sp.o2 - night) * 100) / 100;
        if (overStandard > 0)
          bullets.push(
            dlab(i) +
              " — worked " +
              d.in +
              " – " +
              d.out +
              " (" +
              fmt(d.h) +
              "h, " +
              fmt(overStandard) +
              "h over standard)"
          );
        /* Short only against a day you were EXPECTED to work. A casual's
           four-hour Wednesday isn't short of anything — they were rostered for
           four hours — and neither is a part-timer's day off that they picked
           up anyway. */
        if (expectsWork(ctx, dow) && d.h < s.standard) {
          under++;
          bullets.push(dlab(i) + " — under day: " + fmt(d.h) + "h of " + fmt(s.standard) + "h");
        }
      }
    } else if (d.t === "sick") {
      /* THE BOOKING IS NOT WHAT IS BEING REVIEWED. A timesheet cannot declare
         leave — `KINDS` on my-timesheet offers "Worked" and "Not worked" and
         nothing more — so every leave and sick day on a sheet arrived from a
         request the leave module already approved. Asking this screen to
         "check it was requested" was a second approval of that decision, on
         the screen that exists to end exactly that kind of double entry. The
         line says where the day came from instead.

         THE CERTIFICATE STAYS, and it is not the same thing. Nothing in this
         app records one: "certificate" appears in no other file, there is no
         field on a leave request and nothing to upload. So this bullet is the
         only place the obligation is ever raised — removing it would delete
         the prompt rather than move it. It asks about a document, not about
         whether the day off was allowed. */
      sick += d.h;
      entries++;
      /* THE CERTIFICATE LINE IS ANSWERABLE NOW. It used to read "chase a
         certificate if your workspace needs one" — a prompt with nothing
         behind it, because `certificate` appeared in no other file in the
         codebase. A leave request carries one, so this says which of the three
         states the day is actually in rather than making the approver guess:
         the workspace doesn't ask, it asked and got one, or it is outstanding. */
      bullets.push(
        dlab(i) +
          " — sick leave (" +
          fmt(d.h) +
          "h paid), approved in My leave" +
          ((ctx.certMissing ?? []).includes(i) ? " — still waiting on a medical certificate" : ""),
      );
    } else if (d.t === "leave") {
      leave += d.h;
      entries++;
      bullets.push(dlab(i) + " — annual leave (" + fmt(d.h) + "h), already approved in My leave");
    } else if (d.t === "ph") {
      ph += d.h;
      entries++;
    } else if (d.t === "off") {
      /* A deliberate "not worked" is an entry — the person answered — but it
         is never a normal workday, so it goes to the approver either way. */
      entries++;
      if (expectsWork(ctx, dow)) {
        off++;
        bullets.push(dlab(i) + " — not worked, and not booked as leave");
      }
    } else if (d.t === "empty" && expectsWork(ctx, dow) && isOver(ctx, i)) {
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
  /* AN ABSENT WEEK REACHES A PERSON. `sick` and `leave` put the week in
     "review", and that is Isaac's call (2026-08-10), taken back after a round
     where they didn't.

     The reasoning that removed them was that a timesheet cannot declare leave,
     so both arrive from an approved request and asking again is double entry —
     and a public holiday, which arrives the same way, never triggered review.
     True about the BOOKING, wrong about the week: a period somebody was absent
     for is one an approver should look at before it is paid, whoever approved
     the absence. A public holiday is different in the way that matters — the
     business closed, nobody made a choice, and every person on the calendar
     has the same day.

     So the trigger stands and the WORDING is where the double entry went: the
     bullets state that the booking is already approved rather than asking for
     it to be approved a second time. See the `sick`/`leave` branches above. */
  const status = ot || ot2 || under || off || missing || sick || leave ? "review" : "ready";
  const issueTitle = issueHeading({ missing, off, ot2, ot, under, sick, leave });

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
    off,
    missing,
    status,
    bullets,
    issueTitle,
    gross: grossFor(staff, s, { normal, ot, ot2, sick, leave, ph }),
  };
}

/** The week's money, respecting the pay basis.

    Hourly: every bucket at its multiplier — unchanged. Salaried with paid
    overtime: identical arithmetic, because the salaried rate IS annual ÷ 52 ÷
    weekly hours (the drift work's own conversion), so a full presumed week
    lands on the constant weekly figure and an extended day adds its premium.
    Salaried with ABSORBED overtime: the extra hours are inside the salary —
    recorded on the sheet, excluded from the money. Base hours (the `normal`
    bucket) and paid absences still pay; the ot/ot2 buckets don't. */
function grossFor(
  staff: StaffWeek,
  s: Settings,
  b: { normal: number; ot: number; ot2: number; sick: number; leave: number; ph: number },
): number | null {
  if (staff.rate == null) return null;
  const absorbed = staff.payBasis === "salary" && s.salariedOtPaid === false;
  if (absorbed) return (b.normal + b.sick + b.leave + b.ph) * staff.rate;
  return (
    b.normal * staff.rate +
    b.ot * staff.rate * 1.5 +
    b.ot2 * staff.rate * 2 +
    (b.sick + b.leave + b.ph) * staff.rate
  );
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
    if (entry.t !== "empty" && entry.t !== "off") groups[w].workedHours += entry.h;
  }
  return groups;
}

/* ---------------- the normal-day presumption ----------------

   A timesheet's default answer is "I worked my normal hours". You open a day
   only when it was DIFFERENT — and a day that was different for a reason the
   business already knows about (a public holiday, approved leave, a booked
   sick day) isn't yours to fill in either: it arrives already in that state.

   So nothing here asks a person to confirm an ordinary week. `presumeDays`
   takes what is actually STORED and fills the gaps:

     stored entry       → kept, always. An entry beats every presumption.
     casual             → nothing, ever. Their week is entered by hand.
     not an expected day → nothing. Added by hand, never presumed.
     public holiday     → a full day off, named from the org's calendar.
     approved leave     → annual leave or sick, from the leave module.
     expected, over     → worked, at that person's normal start and finish.
     expected, not over → nothing yet. Today isn't marked until today ends.

   Holidays outrank leave: a public holiday inside a booked week is a day the
   business is closed, not a day of entitlement spent — the same call
   `rangeBreakdown` already makes when it costs a leave request.

   This runs on BOTH sides — your screen and the approver's — because a
   presumption only one of you can see is a disagreement waiting to be paid
   out. It is derived, not written: a live period recomputes every load, and
   `submitWeek` is what turns the presumption into rows. */

export type NormalHours = { start: string; end: string };

/** Where a day's content came from. `entered` is a real row; everything else
    is this module filling in for a person who shouldn't have to. */
export type DaySource = "entered" | "holiday" | "leave" | "presumed" | "expected" | "none";

/** A person's normal hours: their own if they've set them, the workspace's
    otherwise. An override is only honoured when BOTH ends are readable —
    half an override would silently pay a day at the org's finish time. */
export function normalHours(s: Settings, own?: Partial<NormalHours> | null): NormalHours {
  const start = own?.start?.trim();
  const end = own?.end?.trim();
  if (start && end && parseClock(start) != null && parseClock(end) != null) return { start, end };
  return { start: s.defaultStart, end: s.defaultEnd };
}

/** What a person's ROSTER comes to in a week: their normal day, priced the way
    a worked day is priced, times the days they're expected.

    This exists because the app holds two separate answers to "how many hours a
    week does this person do", and until now neither mentioned the other.
    `staff_profiles.contracted_hours` is a number an owner types on the Payroll
    card; it feeds costing (the Rate Calculator's charge-out maths) and NOTHING
    reads it for pay. The roster — normal start, normal finish, working days,
    the org break — is what the timesheet actually presumes onto every week.
    They can disagree by hours without a word said, which is how a card can
    read "38" while every week it fills in comes to 40.

    Null for a casual: nothing is presumed for them, so there is no rostered
    week to state and a figure here would be a claim about hours nobody has
    agreed to. Null too when the times are unreadable — see derivedDayHours. */
export function rosteredWeekHours(
  s: Settings,
  own: { hours?: Partial<NormalHours> | null; workDays?: number[] | null },
  employment: "permanent" | "casual" | "subbie" | null = "permanent",
): number | null {
  if (employment === "casual" || employment === "subbie") return null;
  const { start, end } = normalHours(s, own.hours);
  const perDay = derivedDayHours(start, end, s);
  if (perDay == null) return null;
  const days = own.workDays ?? s.workDays;
  return Math.round(perDay * days.length * 100) / 100;
}

export type PresumeInput = {
  /** ISO date per day index, so nothing here has to redo period maths */
  dates: string[];
  /** date → holiday name, this org's calendar for this person's state */
  holidays: Map<string, string>;
  /** date → an absence already booked and approved elsewhere. Unpaid leave
      arrives as `off`: it is a day not worked, and it must never be presumed
      into paid hours. */
  /** date → the absence that covers it; `id` is the leave request it came
      from (provenance for materialised rows — never stored on the DayEntry) */
  absences: Map<string, { t: "leave" | "sick"; h: number; id: string } | { t: "off"; id: string }>;
  /** that person's normal hours, already resolved */
  hours: NormalHours;
  /** the last index whose day is OVER. −1 when the period hasn't started. */
  through: number;
  /** false for a CASUAL: nothing is ever filled in for them, not a normal day
      and not a public holiday. They work when they're rostered, so their week
      is theirs to enter and an empty day of it means nothing happened — not
      that something is missing. */
  presume: boolean;
};

export type PresumedWeek = { days: DayEntry[]; sources: DaySource[] };

export function presumeDays(
  stored: DayEntry[],
  ctx: WeekCtx,
  s: Settings,
  input: PresumeInput,
): PresumedWeek {
  const days: DayEntry[] = [];
  const sources: DaySource[] = [];
  /* A presumed day is the same clock every time, so the break deduction and
     rounding are computed once rather than per day. */
  const presumedHours = derivedDayHours(input.hours.start, input.hours.end, s);

  stored.forEach((entry, i) => {
    const date = input.dates[i] ?? "";
    const dow = dowOf(ctx.week[i]);

    if (entry.t !== "empty") {
      days.push(entry);
      sources.push("entered");
      return;
    }

    /* Not an expected day → nothing is presumed onto it, by anything. That is
       a weekend for most people, a Wednesday for a part-timer on Mon/Tue/Thu,
       and EVERY day for a casual. A public holiday falling on a day you were
       never going to work closes nothing, and a fortnight of annual leave
       covers its Saturdays only in the sense that nobody was going to be
       there — pay neither. A day you DID work has a stored entry and never
       reaches here. */
    if (!input.presume || !expectsWork(ctx, dow)) {
      days.push({ t: "empty" });
      sources.push("none");
      return;
    }

    if (input.holidays.get(date) !== undefined) {
      // a public holiday pays this person's ordinary day, not the org's
      // standard — someone on 7.6h normal hours gets 7.6, not a free 8
      days.push({ t: "ph", h: presumedHours ?? s.standard });
      sources.push("holiday");
      return;
    }

    const absence = input.absences.get(date);
    if (absence) {
      days.push(absence.t === "off" ? { t: "off" } : { t: absence.t, h: absence.h });
      sources.push("leave");
      return;
    }

    if (i <= input.through && presumedHours != null) {
      days.push({ t: "work", in: input.hours.start, out: input.hours.end, h: presumedHours });
      sources.push("presumed");
      return;
    }

    days.push({ t: "empty" });
    sources.push("expected");
  });

  return { days, sources };
}

/** Is this day's premium coming from the WEEKEND rule rather than from length?

    A worked Saturday goes through `splitDay`'s weekend branch, so every hour
    of it lands at 1.5× or 2× and `dayClass` calls it `over`. That is right
    about the PAY and wrong about the WORD: a four-hour Saturday was labelled
    "Overtime day", which reads as a long day when it was a short one. The
    premium is for the day of the week, not the hours.

    Only true when the weekend rule is actually on — a workspace that pays
    Saturdays at standard rates has ordinary days there, and `splitDay` falls
    through to the weekday path. */
export function isWeekendRate(d: DayEntry, dow: number, s: Settings): boolean {
  if (d.t !== "work" || !isWeekend(dow)) return false;
  return dow === 5 ? s.rules.sat.on : s.rules.sun.on;
}

/* Day → colour class, driven by the same split rules as pay. */
export function dayClass(d: DayEntry, i: number, s: Settings, ctx: WeekCtx): DayClass {
  const dow = dowOf(ctx.week[i]);
  const expected = expectsWork(ctx, dow);
  if (d.t === "off") return "off";
  if (d.t === "empty") return expected && isOver(ctx, i) ? "miss" : "empty";
  if (d.t === "leave") return "leave";
  if (d.t === "sick") return "sick";
  if (d.t === "ph") return "ph";
  // a WORKED holiday still reads as a holiday — the pill is what tells you a
  // day was unusual, and a public holiday is the most unusual day there is
  if ((ctx.holidays ?? []).includes(i)) return "ph";
  // only a worked day carries clocks for the night window to measure
  const sp = splitDay(d.h, dow, s, d.t === "work" ? { in: d.in, out: d.out } : {});
  if (sp.o15 || sp.o2) return "over";
  /* short days apply to EXPECTED days only, matching derive's review flag */
  return expected && d.h < s.standard ? "under" : "std";
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

/* "1.5× first 2h, then 2×" — a COMMA inside the rule, because the caller that
   lists rules joins them with " · ". With a dot in both places the footnote
   read "Sat 1.5× first 2h · then 2× · Sun 2× all day", where "then 2×" parses
   as a rule of its own about nothing. */
export const ruleSummary = (rl: RateRule): string =>
  rl.rate === 2 ? "2× all day" : "1.5× first " + fmtHval(rl.up ?? 0) + ", then 2×";

export const submitNote = (s: Settings): string =>
  "Open · auto-submits " + s.submitDay + " " + s.submitTime + (s.lock ? ", then locks" : "");

/* WHAT TO CALL THE PAY PERIOD, in the word the person on it would use.

   My timesheet knew the cycle well enough to head the totals card "My month",
   and then said "Submit week" on the button directly underneath it, "Your
   normal week is already filled in" in the status line, and "This week has
   been sent" once it was. A monthly workspace was told four different things
   about what it was looking at, three of them wrong.

   One helper rather than a ternary at each site, because the ternary is how it
   drifted: whoever added the heading wrote one, and nobody went back for the
   other four. Anything naming the period now spells it the same way. */
export const cycleNoun = (cycle: Settings["cycle"]): string =>
  cycle === "Fortnightly" ? "fortnight" : cycle === "Monthly" ? "month" : "week";
