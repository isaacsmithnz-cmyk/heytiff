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
import { absenceMap, type AbsenceDay, type LeaveRequest } from "./leave";
import { approvedInSpan, certificatesFor, holidaysInSpan, markCertExpected } from "./leave-query";
import { getPaySettings, shiftDefaultsFor } from "./query";
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
  /** request ids that HAVE a certificate — membership only, never the file */
  certHeld: Set<string>;
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

  const [holidayLists, leaveRaw, defaults, { settings }] = await Promise.all([
    Promise.all(states.map((st) => holidaysInSpan(orgId, st, periodStart, end))),
    approvedInSpan(orgId, periodStart, end),
    shiftDefaultsFor(
      orgId,
      staff.map((s) => s.id),
    ),
    getPaySettings(orgId),
  ]);
  const { hours: ownHours, workDays: ownWorkDays } = defaults;

  const holidaysByState = new Map<string | null, Map<string, string>>();
  states.forEach((st, i) => {
    holidaysByState.set(st, new Map(holidayLists[i].map((h) => [h.date, h.name])));
  });

  /* CERTIFICATES, resolved once for the whole period rather than per person.

     The timesheet is where the certificate prompt has always lived — "confirm
     a certificate if required", on a sick day, with nothing behind it. Now
     there is something behind it, so the bullet can say which: attached, or
     still outstanding. Only whether, never the document — the file itself is
     the leave screen's business and is gated on `approvals` there. */
  const leave = await markCertExpected(
    orgId,
    leaveRaw,
    new Map(holidaysByState.get(states[0] ?? null) ?? []).size
      ? new Set(holidaysByState.get(states[0] ?? null)!.keys())
      : new Set<string>(),
    settings.workDays,
    settings.certAfterDays,
  );
  const certHeld = new Set(
    (await certificatesFor(
      orgId,
      leave.filter((r) => r.certExpected).map((r) => r.id),
    )).keys(),
  );

  const leaveByStaff = new Map<string, LeaveRequest[]>();
  for (const r of leave) leaveByStaff.set(r.staffId, [...(leaveByStaff.get(r.staffId) ?? []), r]);

  /* "Over" means the calendar day has ended — today is not presumed until
     today is done, which is exactly what "at the end of the day it's marked
     as worked" asks for. A fully elapsed period has every day over; one that
     hasn't started has none, and `through` is −1. */
  const through = dates.filter((d) => d < todayISO).length - 1;

  return { dates, holidaysByState, leaveByStaff, certHeld, ownHours, ownWorkDays, through };
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
  /* `frozen` — this person's sheet has gone for review. A submitted or
     approved week is a RECORD: only stored rows render, and nothing keeps
     being derived underneath it. Without this, a week submitted on Wednesday
     grew presumed Thursday and Friday hours after approval — on both screens,
     with no rows behind them. */
  opts: { frozen?: boolean } = {},
): {
  days: StaffWeek["days"];
  sources: DaySource[];
  hours: NormalHours;
  workDays: number[];
  presume: boolean;
  /** the absence map the presumption applied — date → covering request, so
      materialise can stamp each leave row with the request that paid it */
  absences: Map<string, AbsenceDay>;
  /** which of this period's days are public holidays for THIS person, by
      index — the pay rules need it, because a holiday somebody worked is an
      ordinary worked day sitting on a holiday date */
  holidayDays: number[];
  /** sick days whose request wants a certificate and hasn't got one, by index.
      Whether, never the document — see `certHeld`. */
  certMissing: number[];
} {
  const holidays = p.holidaysByState.get(state) ?? new Map<string, string>();
  const hours = normalHours(settings, p.ownHours.get(staff.id));
  const { workDays, presume } = patternFor(staff, settings, p);
  const live = presume && !opts.frozen;
  const rostered: WeekCtx = { ...ctx, workDays };
  // the spread follows the person's own roster — divisor and applier agree
  // (a casual has no pattern; their leave never lands, so the default is moot)
  const absences = absenceMap(
    p.leaveByStaff.get(staff.id) ?? [],
    holidays,
    workDays.length ? workDays : undefined,
  );
  const { days, sources } = presumeDays(staff.days, rostered, settings, {
    dates: p.dates,
    holidays,
    absences,
    hours,
    through: p.through,
    presume: live,
  });
  const holidayDays = p.dates.reduce<number[]>((out, date, i) => {
    if (holidays.has(date)) out.push(i);
    return out;
  }, []);

  /* Which sick days are still waiting on paperwork. Read off the absence map
     the presumption just applied, so it lines up with the days actually
     drawn — a request whose certificate is expected and absent marks every day
     it covers, and the bullet names them by date. */
  const wantsCert = new Set(
    (p.leaveByStaff.get(staff.id) ?? []).filter((r) => r.certExpected).map((r) => r.id),
  );
  const certMissing = p.dates.reduce<number[]>((out, date, i) => {
    const a = absences.get(date);
    if (a && a.t === "sick" && wantsCert.has(a.id) && !p.certHeld.has(a.id)) out.push(i);
    return out;
  }, []);

  return { days, sources, hours, workDays, presume: live, absences, holidayDays, certMissing };
}
