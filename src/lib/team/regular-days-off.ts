/* REGULAR DAYS OFF, the pure half (v2, 18 October): TAFE every Tuesday, an
   RDO every second Friday, uni on Thursday afternoons. A rule, never leave:
   docs/migrations/staff_regular_days_off.sql says why.

   Days are 'YYYY-MM-DD' text and times 'HH:MM' on the business's clock, as
   everywhere on the diary; the one Date here reads a day, never a time. */

import type { ScheduleAway } from "@/lib/workboard/away";

export type RegularDayOff = {
  id: string;
  staffProfileId: string;
  reason: string;
  /** ISO weekdays, 1 Monday … 7 Sunday */
  weekdays: number[];
  everyWeeks: 1 | 2;
  fromDate: string;
  toDate: string | null;
  /** both null: the whole day */
  partFrom: string | null;
  partTo: string | null;
  skipDates: string[];
};

export const REASONS = ["TAFE", "RDO", "Uni"] as const;
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const utc = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
/** 1 Monday … 7 Sunday */
export const isoWeekday = (day: string) => ((new Date(utc(day)).getUTCDay() + 6) % 7) + 1;
/** The Monday of a day's week, as days since the epoch. */
const mondayOf = (day: string) => Math.floor(utc(day) / 86_400_000) - (isoWeekday(day) - 1);

/** Does the rule fall on this day? */
export function fallsOn(r: RegularDayOff, day: string): boolean {
  if (!DAY.test(day) || day < r.fromDate || (r.toDate && day > r.toDate)) return false;
  if (r.skipDates.includes(day)) return false;
  if (!r.weekdays.includes(isoWeekday(day))) return false;
  if (r.everyWeeks === 2 && (mondayOf(day) - mondayOf(r.fromDate)) % 14 !== 0) return false;
  return true;
}

/** The rules that fall on a day, as the diary's time off: each person by
    their ServiceM8 uuid (a person with no link has no row on the Schedule,
    and is left out), in the business's own word. */
export function awayOnDay(rules: readonly RegularDayOff[], day: string, sm8ByProfile: ReadonlyMap<string, string>): ScheduleAway[] {
  const out: ScheduleAway[] = [];
  for (const r of rules) {
    const staffUuid = sm8ByProfile.get(r.staffProfileId);
    if (!staffUuid || !fallsOn(r, day)) continue;
    const part = r.partFrom && r.partTo;
    out.push({
      uuid: `regular:${r.id}:${day}`,
      staffUuid,
      name: r.reason,
      start: `${day} ${part ? `${r.partFrom}:00` : "00:00:00"}`,
      end: `${day} ${part ? `${r.partTo}:00` : "23:59:59"}`,
    });
  }
  return out;
}

/** Laid over ServiceM8's own time off for the day: a rule says nothing where
    the business already typed the same word for the same person that day
    (TAFE typed into ServiceM8 by hand, the way it's done today). */
export function withRegular(away: readonly ScheduleAway[], regular: readonly ScheduleAway[]): ScheduleAway[] {
  const low = (s: string | null) => (s ?? "").trim().toLowerCase();
  const typed = new Set(away.map((a) => `${low(a.staffUuid)}|${a.start.slice(0, 10)}|${low(a.name)}`));
  return [...away, ...regular.filter((r) => !typed.has(`${low(r.staffUuid)}|${r.start.slice(0, 10)}|${low(r.name)}`))];
}

/** "Every Tuesday", "Every second Friday", "Every Monday and Thursday, from 12" */
export function ruleWords(r: Pick<RegularDayOff, "weekdays" | "everyWeeks" | "partFrom" | "partTo">): string {
  const names = [...r.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d - 1]);
  const days = names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const every = r.everyWeeks === 2 ? `Every second ${days}` : `Every ${days}`;
  if (!r.partFrom || !r.partTo) return every;
  const clock = (t: string) => {
    const h = Number(t.slice(0, 2));
    const m = t.slice(3, 5);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m === "00" ? `${h12}` : `${h12}:${m}`;
  };
  return `${every}, ${clock(r.partFrom)} to ${clock(r.partTo)}`;
}

/** What a save must hold, checked the same in the form and the action:
    the reason, a weekday, a start date, a sane end, and a part day's times
    in order. Null when it's fine; otherwise the words. */
export function invalidRule(r: Omit<RegularDayOff, "id" | "staffProfileId">): string | null {
  if (!r.reason.trim()) return "Say what it is: TAFE, RDO or your own word.";
  if (r.reason.trim().length > 40) return "Keep the reason to 40 letters.";
  if (r.weekdays.length === 0 || r.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return "Choose the day it falls on.";
  if (r.everyWeeks !== 1 && r.everyWeeks !== 2) return "Choose every week or every second week.";
  if (!DAY.test(r.fromDate)) return "Choose the day it starts.";
  if (r.toDate && (!DAY.test(r.toDate) || r.toDate < r.fromDate)) return "It has to end after it starts.";
  if ((r.partFrom === null) !== (r.partTo === null)) return "A part day needs both times.";
  if (r.partFrom && r.partTo && (!HHMM.test(r.partFrom) || !HHMM.test(r.partTo) || r.partTo <= r.partFrom)) return "The part day has to end after it starts.";
  if (r.skipDates.some((d) => !DAY.test(d))) return "One of the skipped days isn't a day.";
  return null;
}
