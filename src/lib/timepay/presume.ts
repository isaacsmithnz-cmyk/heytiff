import { presumesDays } from "@/lib/staff/employment";
import {
  normalHours,
  presumeDays,
  type DaySource,
  type NormalHours,
  type Settings,
  type StaffWeek,
  type WeekCtx,
} from "@/components/timepay/logic";
import { absenceMap, type LeaveRequest } from "./leave";
import { approvedInSpan, holidaysInSpan } from "./leave-query";
import { shiftDefaultsFor } from "./query";
import { dateOfDay, periodEnd, periodLength, type PeriodConfig } from "./period";

/* Filling in the week nobody should have to fill in.

   `presumeDays` in logic.ts is the rule; this is the plumbing that feeds it —
   the org's holiday calendar, the leave module's approved bookings, and each
   person's normal hours. It is deliberately ONE module used by BOTH Time & Pay
   routes: the day a person's screen and their approver's screen presume
   different things is the day someone gets paid for a week neither of them
   agreed to.

   Nothing here writes. A live period is recomputed on every load, so a
   correction in the leave module or a holiday added to the calendar shows up
   on the timesheet immediately, without a sync step to forget. Submitting is
   what makes it permanent. */

export type PresumptionCtx = {
  dates: string[];
  /** state → its holiday calendar for this period, one query per state */
  holidaysByState: Map<string | null, Map<string, string>>;
  /** staff id → their approved leave overlapping this period */
  leaveByStaff: Map<string, LeaveRequest[]>;
  /** staff id → their own normal hours, where they've set them */
  ownHours: Map<string, NormalHours>;
  /** staff id → their own working pattern, where they've set one */
  ownWorkDays: Map<string, number[]>;
  /** last index whose day is over; −1 before the period starts */
  through: number;
};

/** Which days of the week this person is expected, and whether anything is
    presumed onto them at all.

    A CASUAL HAS NO WORKING PATTERN. Returning an empty set rather than a flag
    is what makes every downstream rule fall out correctly at once: nothing is
    presumed, no day of their week can be "missing", and a four-hour Wednesday
    isn't short of a standard day they were never on. */
export function patternFor(
  staff: StaffWeek,
  settings: Settings,
  p: PresumptionCtx,
): { workDays: number[]; presume: boolean } {
  const cls = staff.employment ?? "permanent";
  if (!presumesDays(cls)) return { workDays: [], presume: false };
  return { workDays: p.ownWorkDays.get(staff.id) ?? settings.workDays, presume: true };
}

/** Everything the presumption needs, in a fixed number of queries: one per
    distinct state (nearly always one), one for leave, one for overrides. */
export async function presumptionCtx(
  orgId: string,
  periodStart: string,
  cfg: PeriodConfig,
  todayISO: string,
  staff: { id: string; state: string | null }[],
): Promise<PresumptionCtx> {
  const dates = Array.from({ length: periodLength(periodStart, cfg) }, (_, i) =>
    dateOfDay(periodStart, i),
  );
  const end = periodEnd(periodStart, cfg);
  const states = Array.from(new Set(staff.map((s) => s.state)));

  const [holidayLists, leave, defaults] = await Promise.all([
    Promise.all(states.map((st) => holidaysInSpan(orgId, st, periodStart, end))),
    approvedInSpan(orgId, periodStart, end),
    shiftDefaultsFor(
      orgId,
      staff.map((s) => s.id),
    ),
  ]);
  const { hours: ownHours, workDays: ownWorkDays } = defaults;

  const holidaysByState = new Map<string | null, Map<string, string>>();
  states.forEach((st, i) => {
    holidaysByState.set(st, new Map(holidayLists[i].map((h) => [h.date, h.name])));
  });

  const leaveByStaff = new Map<string, LeaveRequest[]>();
  for (const r of leave) leaveByStaff.set(r.staffId, [...(leaveByStaff.get(r.staffId) ?? []), r]);

  /* "Over" means the calendar day has ended — today is not presumed until
     today is done, which is exactly what "at the end of the day it's marked
     as worked" asks for. A fully elapsed period has every day over; one that
     hasn't started has none, and `through` is −1. */
  const through = dates.filter((d) => d < todayISO).length - 1;

  return { dates, holidaysByState, leaveByStaff, ownHours, ownWorkDays, through };
}

/** Apply the presumption to one person's stored week.

    Returns the working pattern it used, because the CALLER has to keep reading
    the week through the same one: `derive` and `dayClass` decide "missing" and
    "short" from the roster too, and a screen that presumed with one pattern
    and coloured with another would show a casual a week of missing days it had
    just declined to fill in. */
export function presumeFor(
  staff: StaffWeek,
  state: string | null,
  settings: Settings,
  ctx: WeekCtx,
  p: PresumptionCtx,
): {
  days: StaffWeek["days"];
  sources: DaySource[];
  hours: NormalHours;
  workDays: number[];
  presume: boolean;
} {
  const holidays = p.holidaysByState.get(state) ?? new Map<string, string>();
  const hours = normalHours(settings, p.ownHours.get(staff.id));
  const { workDays, presume } = patternFor(staff, settings, p);
  const rostered: WeekCtx = { ...ctx, workDays };
  const { days, sources } = presumeDays(staff.days, rostered, settings, {
    dates: p.dates,
    holidays,
    absences: absenceMap(p.leaveByStaff.get(staff.id) ?? [], holidays),
    hours,
    through: p.through,
    presume,
  });
  return { days, sources, hours, workDays, presume };
}
