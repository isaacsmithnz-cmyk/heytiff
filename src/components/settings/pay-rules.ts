import { fmtHval, parseClock, ruleSummary, type RateRule, type Settings } from "@/components/timepay/logic";

/* PAY AND HOLIDAYS, the words and the checks (v2, 25 October 2026). Pure, so
   the screen and its tests read one set.

   The pay rules are one row, `pay_settings`, saved whole by
   `savePaySettings`: every group here turns its fields into a PATCH, and the
   screen lays the patch over the saved settings and sends the lot, so the
   saved shape is exactly the modal's. A group's fields are strings (the
   settings frame's EditGroup keeps its draft as strings); the numbers are
   checked here, against the limits the modal's steppers held. */

export type Fields = Record<string, string>;
export type Parsed = { ok: true; patch: Partial<Settings> } | { ok: false; error: string; fields: string[] };

export const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** "Mon" → "Monday"; anything else as it came. */
export const dayName = (key: string) => DAY_NAMES[DAY_KEYS.indexOf(key as (typeof DAY_KEYS)[number])] ?? key;

export const CYCLES = ["Weekly", "Fortnightly", "Monthly"] as const;

/** 1st, 2nd, 3rd, 4th … 21st, 22nd, 23rd … 28th */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}

/* The bounds the modal's steppers held, now the bounds a typed figure is
   checked against. A figure saved before them stays as it is until someone
   edits its group. */
export const LIMITS = {
  standard: [4, 12],
  otAfterDay: [4, 14],
  otAfterWeek: [30, 60],
  dblAfter: [8, 16],
  up: [0.5, 8],
  breakMinutes: [0, 120],
  superPct: [0, 25],
} as const satisfies Record<string, readonly [number, number]>;

export const between = ([lo, hi]: readonly [number, number], unit: string) => `Between ${lo} and ${hi} ${unit}`;

/** A plain figure, "7.6" or "38", or null for anything else. */
function figure(text: string | undefined): number | null {
  const t = (text ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

const within = (n: number | null, [lo, hi]: readonly [number, number]): n is number => n != null && n >= lo && n <= hi;

const CHECK = "Check the figures marked above.";

function result(patch: Partial<Settings>, bad: string[]): Parsed {
  return bad.length ? { ok: false, error: CHECK, fields: bad } : { ok: true, patch };
}

/* ---- the pay cycle, and when timesheets submit themselves ---- */

export const cycleValues = (s: Settings): Fields => ({
  cycle: s.cycle,
  fortnightAnchor: s.fortnightAnchor ?? "",
  monthStartDay: String(s.monthStartDay),
  weekStart: s.weekStart,
  submitDay: s.submitDay,
  submitTime: s.submitTime,
});

export function parseCycle(f: Fields): Parsed {
  const bad: string[] = [];
  const cycle = CYCLES.find((c) => c === f.cycle);
  if (!cycle) bad.push("cycle");
  const day = Number(f.monthStartDay);
  if (!Number.isInteger(day) || day < 1 || day > 28) bad.push("monthStartDay");
  if (!DAY_KEYS.includes(f.weekStart as (typeof DAY_KEYS)[number])) bad.push("weekStart");
  if (!DAY_KEYS.includes(f.submitDay as (typeof DAY_KEYS)[number])) bad.push("submitDay");
  if (parseClock(f.submitTime ?? "") == null) bad.push("submitTime");
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(f.fortnightAnchor ?? "") ? f.fortnightAnchor : null;
  return result(
    {
      cycle: cycle ?? "Weekly",
      fortnightAnchor: anchor,
      monthStartDay: day,
      weekStart: f.weekStart,
      submitDay: f.submitDay,
      submitTime: f.submitTime,
    },
    bad,
  );
}

/* ---- the ordinary day ---- */

export const hoursValues = (s: Settings): Fields => ({
  standard: String(s.standard),
  defaultStart: s.defaultStart,
  defaultEnd: s.defaultEnd,
  workDays: [...s.workDays].sort((a, b) => a - b).join(","),
  breakMinutes: String(s.breakMinutes),
  breakPaid: s.breakPaid ? "Yes" : "No",
});

/** "0,1,2,3,4" → [0, 1, 2, 3, 4] */
export const daysOf = (text: string): number[] =>
  [...new Set((text ?? "").split(",").filter(Boolean).map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort((a, b) => a - b);

export function parseHours(f: Fields): Parsed {
  const bad: string[] = [];
  const standard = figure(f.standard);
  if (!within(standard, LIMITS.standard)) bad.push("standard");
  if (parseClock(f.defaultStart ?? "") == null) bad.push("defaultStart");
  if (parseClock(f.defaultEnd ?? "") == null) bad.push("defaultEnd");
  const minutes = figure(f.breakMinutes);
  if (!within(minutes, LIMITS.breakMinutes) || !Number.isInteger(minutes)) bad.push("breakMinutes");
  return result(
    {
      standard: standard ?? 0,
      defaultStart: f.defaultStart,
      defaultEnd: f.defaultEnd,
      workDays: daysOf(f.workDays),
      breakMinutes: minutes ?? 0,
      // with no break there is nothing to pay or not: it stays as it was set
      breakPaid: f.breakPaid !== "No",
    },
    bad,
  );
}

/* ---- the ladder of an ordinary weekday ---- */

export const overtimeValues = (s: Settings): Fields => ({
  otAfter: String(s.otAfter),
  otUnit: s.otUnit,
  dblAfter: String(s.dblAfter),
  salariedOtPaid: (s.salariedOtPaid ?? true) ? "Yes" : "No",
});

export const otLimits = (unit: string) => (unit === "week" ? LIMITS.otAfterWeek : LIMITS.otAfterDay);

export function parseOvertime(f: Fields): Parsed {
  const bad: string[] = [];
  const unit = f.otUnit === "week" ? "week" : "day";
  const otAfter = figure(f.otAfter);
  if (!within(otAfter, otLimits(unit))) bad.push("otAfter");
  const dblAfter = figure(f.dblAfter);
  if (!within(dblAfter, LIMITS.dblAfter)) bad.push("dblAfter");
  return result({ otAfter: otAfter ?? 0, otUnit: unit, dblAfter: dblAfter ?? 0, salariedOtPaid: f.salariedOtPaid !== "No" }, bad);
}

/* ---- the days with their own rate ---- */

export type RuleKey = keyof Settings["rules"];

export const RULES: readonly { key: RuleKey; name: string }[] = [
  { key: "sat", name: "Saturdays" },
  { key: "sun", name: "Sundays" },
  { key: "ph", name: "Public holidays" },
  { key: "night", name: "Night shift, 10 PM to 6 AM" },
];

/** A rule as one of three: standard rates, time and a half then double, double all day. */
export type RuleChoice = "off" | "1.5" | "2";

export const RULE_CHOICES: readonly { value: RuleChoice; label: string }[] = [
  { value: "off", label: "Standard rates" },
  { value: "1.5", label: "1.5×, then 2×" },
  { value: "2", label: "2× all day" },
];

const choiceOf = (rl: RateRule): RuleChoice => (!rl.on ? "off" : rl.rate === 2 ? "2" : "1.5");

export const ruleWord = (rl: RateRule) => (rl.on ? ruleSummary(rl) : "Standard rates");

export function ratesValues(s: Settings): Fields {
  const f: Fields = {};
  for (const { key } of RULES) {
    f[key] = choiceOf(s.rules[key]);
    f[`${key}Up`] = String(s.rules[key].up ?? 2);
  }
  return f;
}

/* Standard rates keeps the rule's rate and its hours, as the modal's switch
   did, so turning a day back on lands where it was. Double all day has no
   second rung; time and a half asks after how many hours it doubles. */
export function parseRates(f: Fields, s: Settings): Parsed {
  const bad: string[] = [];
  const rules = { ...s.rules };
  for (const { key } of RULES) {
    const was = s.rules[key];
    const choice = f[key] as RuleChoice;
    if (choice === "off") rules[key] = { ...was, on: false };
    else if (choice === "2") rules[key] = { on: true, rate: 2, up: null };
    else {
      const up = figure(f[`${key}Up`]);
      if (!within(up, LIMITS.up)) bad.push(`${key}Up`);
      rules[key] = { on: true, rate: 1.5, up: up ?? 2 };
    }
  }
  return result({ rules }, bad);
}

/* ---- super ---- */

/** The statutory guarantee, shown until the business names its own. */
export const SUPER_DEFAULT = 12;

export const superValues = (s: Settings): Fields => ({ superPct: s.superPct == null ? "" : String(s.superPct) });

/* Blank is "the default": the row stores null, and My Pay and the Rate
   Calculator fall back to the statutory figure themselves. */
export function parseSuper(f: Fields): Parsed {
  if (!(f.superPct ?? "").trim()) return { ok: true, patch: { superPct: null } };
  const pct = figure(f.superPct);
  return result({ superPct: pct ?? 0 }, within(pct, LIMITS.superPct) ? [] : ["superPct"]);
}

export const superWord = (s: Settings) => (s.superPct == null ? `${SUPER_DEFAULT}%, the default` : `${s.superPct}%`);

/* ---- the settings that save themselves ---- */

export const CERT_DAYS = Array.from({ length: 14 }, (_, i) => i + 1);

export const certWord = (days: number | null | undefined) =>
  days == null ? "Never asked for" : days === 1 ? "From the first day" : `From ${days} working days`;

/** One self-saving field as its patch. */
export function selfPatch(f: Fields): Partial<Settings> {
  const p: Partial<Settings> = {};
  if ("lock" in f) p.lock = f.lock === "Yes";
  if ("exportDetail" in f) p.exportDetail = f.exportDetail === "Yes";
  // "0" is never asked for, which the row keeps as nothing
  if ("certAfterDays" in f) p.certAfterDays = Number(f.certAfterDays) > 0 ? Number(f.certAfterDays) : null;
  return p;
}

/* ---- the read faces ---- */

/** Mon to Fri as "Monday to Friday"; anything else listed. */
export function daysWord(days: readonly number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 0) return "";
  if (d.length === 7) return "Every day";
  const run = d.every((n, i) => i === 0 || n === d[i - 1] + 1);
  if (run && d.length >= 3) return `${DAY_NAMES[d[0]]} to ${DAY_NAMES[d[d.length - 1]]}`;
  const names = d.map((n) => DAY_NAMES[n]);
  return names.length < 2 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export const breakWord = (s: Settings) => (s.breakMinutes === 0 ? "None" : `${s.breakMinutes} min, ${s.breakPaid ? "paid" : "unpaid"}`);

export const overtimeWord = (s: Settings) => `After ${fmtHval(s.otAfter)} a ${s.otUnit === "week" ? "week" : "day"}`;

export const doubleWord = (s: Settings) => `After ${fmtHval(s.dblAfter)} in a day`;

export const salariedWord = (s: Settings) => ((s.salariedOtPaid ?? true) ? "Pays at the rules" : "Absorbed in salary");
