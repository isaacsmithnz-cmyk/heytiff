/* One voice for "how long until / how long since".

   The app used to render every countdown as a day count with a bare "d"
   suffix — "Expires 45d", "Rego expired 120d ago". It is compact, but it is
   also arithmetic homework: nobody reads 45 and thinks "six weeks", and past
   about a fortnight the number stops meaning anything at all.

   So the granularity adapts to the size of the gap, the way a person would say
   it out loud: days up close, weeks in the middle distance, months beyond that.

     0            today
     1            tomorrow  (and -1 → yesterday)
     2 – 13       "9 days"
     14 – 60      "6 weeks"
     61 +         "4 months"

   THE MATHS ALWAYS FLOORS. A coarser unit necessarily rounds, and rounding UP
   would quietly hand someone time they do not have — a rego with 45 days left
   reading "7 weeks" invites them to book the inspection in week seven. Flooring
   is the safe direction in both tenses: for time remaining it never overstates
   what is left, and for time elapsed it never overstates how long it has been.
   `durationDays` below is the property, and it is pinned in the tests.

   Months are 30-day months, not calendar months. That keeps the floor property
   arithmetically exact (`value * 30 <= days`) where a 30.44-day average would
   let a boundary case round past the real gap by a few hours. It also matches
   how the deadlines this labels actually behave — a renewal is 90 days away,
   not "three calendar months minus the short one".

   Pure: no imports, no dates, no DOM. Everything takes a whole-day count that
   the caller has already derived against an AU calendar date (see
   lib/au-dates.ts), so nothing here can reintroduce a timezone bug. */

/** The coarsest unit a duration was expressed in. "" for the wordy specials. */
export type DurationUnit = "day" | "days" | "week" | "weeks" | "month" | "months" | "";

export type Duration = {
  /** The number, as text. "" for today/tomorrow/yesterday, which carry none. */
  value: string;
  /** Pluralised unit, or "" for the specials — the flag for "this is a phrase". */
  unit: DurationUnit;
  /** The whole thing: "6 weeks", "today", "yesterday". */
  label: string;
  /** True when the gap is behind us. `value`/`label` still read as a magnitude. */
  past: boolean;
};

/** Above this many days a duration reads in weeks rather than days. */
export const WEEKS_FROM_DAYS = 14;
/** Above this many days a duration reads in months rather than weeks. */
export const MONTHS_FROM_DAYS = 61;
/** Days per month, for the purposes of this label. See the header note. */
export const DAYS_PER_MONTH = 30;

function plural(n: number, unit: "day" | "week" | "month"): DurationUnit {
  return (n === 1 ? unit : `${unit}s`) as DurationUnit;
}

/* The ladder, on a magnitude. Tense is the caller's business. */
function quantity(n: number): { value: number; unit: DurationUnit } {
  if (n < WEEKS_FROM_DAYS) return { value: n, unit: plural(n, "day") };
  if (n < MONTHS_FROM_DAYS) {
    const weeks = Math.floor(n / 7);
    return { value: weeks, unit: plural(weeks, "week") };
  }
  const months = Math.floor(n / DAYS_PER_MONTH);
  return { value: months, unit: plural(months, "month") };
}

/** How many days a rendered duration could AT MOST be claiming. The floor
    property is `durationDays(daysDuration(n)) <= n` for every n. */
export function durationDays(d: Duration): number {
  if (d.unit === "") return d.label === "today" ? 0 : 1; // today / tomorrow / yesterday
  const n = Number(d.value);
  if (d.unit === "week" || d.unit === "weeks") return n * 7;
  if (d.unit === "month" || d.unit === "months") return n * DAYS_PER_MONTH;
  return n;
}

/** The adaptive label for a whole-day gap. Negative = already past. */
export function daysDuration(days: number): Duration {
  const whole = Math.trunc(days) || 0; // -0 → 0
  const past = whole < 0;
  const n = Math.abs(whole);

  // The wordy specials. They read better than "0 days" / "1 day" and they are
  // what someone actually says, so they carry no number and no unit — `unit`
  // being "" is how a caller knows not to prefix them with "in".
  if (n === 0) return { value: "", unit: "", label: "today", past: false };
  if (n === 1) return { value: "", unit: "", label: past ? "yesterday" : "tomorrow", past };

  const { value, unit } = quantity(n);
  return { value: String(value), unit, label: `${value} ${unit}`, past };
}

/** Bare magnitude, no specials and no tense: "1 day", "6 weeks". For sentences
    that supply their own tense word ("Overdue 2 weeks"). */
export function magnitudeLabel(days: number): string {
  const n = Math.abs(Math.trunc(days) || 0);
  const { value, unit } = quantity(n);
  return `${value} ${unit}`;
}

/** "6 weeks ago" / "yesterday" / "today". Takes elapsed days; sign ignored, so
    a raw negative day-count from `daysUntil` works as-is. */
export function agoLabel(days: number): string {
  const d = daysDuration(-Math.abs(Math.trunc(days) || 0));
  return d.unit === "" ? d.label : `${d.label} ago`;
}

/* "in 6 weeks" — the duration with its preposition, for callers supplying their
   own verb ("renews in 6 weeks", "Rego in 3 days").

   The specials drop the "in" entirely, because they already are the phrase:
   "renews today", not "renews in today". That rule is the reason this is worth
   a function rather than a template at each call site — every site that
   interpolated a raw day count had the same latent "in 0 days" in it. */
export function inLabel(days: number): string {
  const d = daysDuration(days);
  return d.unit === "" ? d.label : `in ${d.label}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* Half the callers want the clause on its own ("Expires in 6 weeks" on a pill)
   and half want it after a subject ("ARC licence expires in 6 weeks"). Same
   words either way, so the clause is the primitive and the sentence is the
   clause with a capital — rather than two near-identical templates that can
   drift apart the next time the wording changes. */

/** "expires in 6 weeks" / "expires tomorrow" / "expired 2 weeks ago". */
export function expiryClause(days: number): string {
  const d = daysDuration(days);
  if (d.past) return `expired ${agoLabel(days)}`;
  return d.unit === "" ? `expires ${d.label}` : `expires in ${d.label}`;
}

/** "Expires in 6 weeks" / "Expires tomorrow" / "Expired 2 weeks ago". */
export function expiresIn(days: number): string {
  return capitalise(expiryClause(days));
}

/** "due in 12 days" / "due today" / "overdue 2 weeks". */
export function dueClause(days: number): string {
  const d = daysDuration(days);
  if (d.past) return `overdue ${magnitudeLabel(days)}`;
  return d.unit === "" ? `due ${d.label}` : `due in ${d.label}`;
}

/** "Due in 12 days" / "Due today" / "Overdue 2 weeks". */
export function dueIn(days: number): string {
  return capitalise(dueClause(days));
}

/* There used to be an HTML-string twin here (durationHtml/inHtml) for the
   injected-HTML profile. That screen is React now, so the string builders went
   with their last caller. The `.dur-u` class stays — it's the JSX's styling,
   still used wherever a duration is rendered number-heavy/unit-muted. */
