"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { TimeWheel } from "@/components/ui/time-wheel";
import { DateField } from "@/components/ui/date-field";
import {
  clearUnavailable,
  markUnavailable,
  saveDay,
  saveMyHours,
  submitWeek,
  type TimepayResult,
} from "@/app/actions/timepay";
import type { SheetState } from "@/lib/timepay/query";
import type { EmploymentClass } from "@/lib/staff/employment";
import {
  blockLabel,
  upcoming,
  validateBlock,
  type Unavailability,
} from "@/lib/timepay/availability";
import { dateOfDay } from "@/lib/timepay/period";
import { UpcomingHolidays } from "./upcoming-holidays";
import type { PayPeriod } from "./timepay";
import {
  type DayClass,
  type DayEntry,
  type DaySource,
  type NormalHours,
  type Settings,
  type WeekCtx,
  type StaffWeek,
  breakLine,
  dayClass,
  dayLabel,
  derive,
  derivedDayHours,
  dowOf,
  fmtH,
  fmtHval,
  expectsWork,
  ruleSummary,
  seedBreakMinutes,
  splitDay,
  submitNote,
  workDaysLabel,
  weekGroups,
} from "./logic";

/* My timesheet — everyone, always. The hours-ENTRY surface.

   TWO RULES SHAPE THIS SCREEN, and both are about not making a person do work
   the software could do or could refuse to get wrong.

   1. A NORMAL WEEK TAKES NO INPUT. Monday to Friday is presumed worked at your
      normal hours once the day is over; a public holiday, approved leave or a
      booked sick day arrives already in that state from the calendar and the
      leave module. You open a day only when it was DIFFERENT. The weekend is
      the mirror image: nothing is presumed onto it, and it stays greyed until
      you add it. `presumeDays` in logic.ts is the rule and the server applies
      it before this screen ever sees the week — so what is drawn here is what
      submits, and the approver's screen is drawing the same thing.

   2. A TIME CANNOT BE TYPED. It is scrolled. Free-text start and finish boxes
      were the last place on this screen where a person could produce something
      the software then had to reject, and there is no software left that asks
      you to type a clock time. `TimeWheel` emits only real times, so the
      "we can't read that" state is gone rather than handled.

   The week is ONE STRIP OF DAY CARDS and nothing else. It used to be a strip
   AND a vertical list of the same seven days, which meant every day was drawn
   twice and the editor opened in the copy rather than the thing you clicked.
   Now the strip is the control: a card is a tab, the selected one joins the
   panel below it, and the panel shows that day alone.

   The payroll line beside it is the REAL engine — `splitDay`, the same
   function the approver's screen and the pay run use — so what you're told
   your day is worth can't drift from what it is worth.

   NO MONEY LIVES HERE. Not a rate, not a gross, not a dollar sign. The wage
   isn't hidden at render time — `getMyWeek` doesn't select the column, so the
   payload has nothing to print. Multipliers and hours only. */

/* What you can say a day was. Leave, sick and public holidays are NOT here:
   they are booked in the leave module or set on the org's calendar, and they
   arrive on this screen already marked. A timesheet that could also declare
   annual leave would be a second place to record the same day — the exact
   double-entry this screen is meant to end. */
const KINDS: { t: "work" | "off"; label: string }[] = [
  { t: "work", label: "Worked" },
  { t: "off", label: "Didn't work" },
];

/* One word per day class, in the same palette the approver reads. `under` is
   not in the original design's list, but dropping it would call a short day
   "Normal" — and a workspace with an unpaid break configured makes short days
   routine, so it has to be sayable. */
const PILL: Record<DayClass, string> = {
  std: "Normal",
  over: "Overtime day",
  under: "Short day",
  leave: "Leave",
  sick: "Sick",
  ph: "Public holiday",
  miss: "Missing",
  off: "Not worked",
  empty: "No entry",
};

/* Why a day says what it says. A presumed day must never read as though the
   person logged it — they didn't, and if it's wrong they need to know it was
   filled in for them before they submit it. */
const SOURCE_NOTE: Record<DaySource, string> = {
  entered: "You logged this day.",
  holiday: "Public holiday — the business is closed. Nothing to do.",
  leave: "Booked leave — this came from your leave, not from here.",
  presumed: "Your normal day. Nobody had to enter it — change it only if it was different.",
  expected: "Not yet. This day is marked as worked once the day is over.",
  none: "Weekends aren't counted unless you add them.",
};

const STATUS_COPY: Record<SheetState["status"], { label: string; tone: string; sub: string }> = {
  draft: { label: "Draft", tone: "warn", sub: "Your normal week is already filled in — change anything that was different, then submit." },
  submitted: { label: "Submitted", tone: "ok", sub: "With your manager. You'll be told if anything needs a look." },
  approved: { label: "Approved", tone: "ok", sub: "Signed off. This week is closed." },
  sent_back: { label: "Sent back", tone: "bad", sub: "Your manager has a question — answer it and submit again." },
};

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* The legend, in the order a week is read: the ordinary day first, the ones
   that need a look after it. */
const LEGEND: [DayClass, string][] = [
  ["std", "Normal"],
  ["over", "Overtime"],
  ["under", "Short"],
  ["leave", "Leave"],
  ["sick", "Sick"],
  ["ph", "Public holiday"],
  ["off", "Not worked"],
  ["empty", "Nothing"],
];

const BREAK_STEP = 5;
const BREAK_MAX = 120;

/** What a day is worth in payroll hours, split by multiplier — read off the
    real engine so this line and the pay run can never disagree. */
function payrollChip(
  h: number,
  dow: number,
  s: Settings,
  day: { publicHoliday?: boolean; in?: string; out?: string } = {},
): { parts: string[]; total: number } {
  const sp = splitDay(h, dow, s, day);
  const parts: string[] = [];
  if (sp.n) parts.push(`${fmtH(sp.n)}h ×1.0`);
  if (sp.o15) parts.push(`${fmtH(sp.o15)}h ×1.5`);
  if (sp.o2) parts.push(`${fmtH(sp.o2)}h ×2.0`);
  if (parts.length === 0) parts.push("0h ×1.0");
  return { parts, total: sp.n + sp.o15 * 1.5 + sp.o2 * 2 };
}

/** The one-line summary a day card shows under its date. */
function daySummary(d: DayEntry): string {
  if (d.t === "empty") return "—";
  if (d.t === "off") return "Off";
  if (d.t === "work") return `${fmtH(d.h)}h`;
  return `${fmtH(d.h)}h`;
}

/* ---------------- the one editor ---------------- */

/* It opens in a single panel below the strip — the day you clicked, and only
   that day. Keyed by day index by the caller, so switching tabs re-seeds the
   fields from the new day. */
function DayEditor({
  index,
  entry,
  source,
  ctx,
  settings,
  normal,
  holidayName,
  busy,
  onSave,
}: {
  index: number;
  entry: DayEntry;
  source: DaySource;
  ctx: WeekCtx;
  settings: Settings;
  /** the hours a presumed day is filled in with — the wheels' starting point */
  normal: NormalHours;
  /** set when this day is a public holiday — named, so you know why */
  holidayName?: string;
  busy: boolean;
  onSave: (i: number, e: DayEntry) => void;
}) {
  const w = ctx.week[index];
  /* Not "is it a weekend" — "were you expected". A casual is never expected,
     so no day of theirs is short of anything and every day is one they added
     rather than one that was there. */
  const expected = expectsWork(ctx, dowOf(w));
  /* Leave is not editable here — it belongs to the leave module, and a Save
     button on it would offer to overwrite the booking that put it there.

     A PUBLIC HOLIDAY is different: the calendar says the day was a holiday,
     but only the person knows whether they WORKED it — and if they did, it is
     the best-paid day in the period and nothing else can report it. So the
     holiday stays read-only until they say otherwise, and saying so writes an
     ordinary worked day (the holiday rate comes from the date, not the
     entry). */
  const [workedHoliday, setWorkedHoliday] = useState(false);
  const locked =
    entry.t === "leave" || entry.t === "sick" || (entry.t === "ph" && !workedHoliday);

  const [kind, setKind] = useState<"work" | "off">(entry.t === "off" ? "off" : "work");
  const [start, setStart] = useState(entry.t === "work" ? entry.in : normal.start);
  const [end, setEnd] = useState(entry.t === "work" ? entry.out : normal.end);
  const [breakMin, setBreakMin] = useState(() => seedBreakMinutes(entry, settings));

  const hasBreak = settings.breakMinutes > 0;
  const adjustable = hasBreak && !settings.breakPaid;
  /* The wheels can only produce real times, so this is never null in practice.
     It stays nullable because `derivedDayHours` is shared with rows already in
     the database, which were typed. */
  const derived = derivedDayHours(start, end, settings, breakMin) ?? 0;
  /* The preview prices the day the pay run will price: same engine, same
     holiday flag, same clocks — so a night shift or a worked holiday shows
     its real multipliers before the person saves it. */
  const onHoliday = (ctx.holidays ?? []).includes(index);
  const chip = payrollChip(kind === "work" ? derived : 0, dowOf(w), settings, {
    publicHoliday: onHoliday,
    in: start,
    out: end,
  });
  const short = kind === "work" && expected && derived < settings.standard;

  const commit = () =>
    onSave(index, kind === "off" ? { t: "off" } : { t: "work", in: start, out: end, h: derived });

  if (locked) {
    return (
      <div className="mts2-edit">
        <div className="mts2-elock">
          <Icon name={entry.t === "ph" ? "calendar" : "check"} size={16} />
          <span>
            <b>
              {entry.t === "ph"
                ? (holidayName ?? "Public holiday")
                : entry.t === "sick"
                  ? "Sick leave"
                  : "Annual leave"}
              {" — "}
              {fmtH(entry.h)}h
            </b>
            <em>{SOURCE_NOTE[source]}</em>
          </span>
        </div>
        <div className="mts2-pay">
          <span className="mts2-payl">Payroll</span>
          <span className="mts2-paych">
            {fmtH(entry.h)}h ×1.0 = <b>{fmtH(entry.h)}h</b>
          </span>
        </div>
        {entry.t === "ph" && (
          <button
            type="button"
            className="mts2-ph-worked"
            disabled={busy}
            onClick={() => setWorkedHoliday(true)}
          >
            I worked this public holiday
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mts2-edit">
      <div className={`mts2-esrc ${source}`}>
        <Icon name={source === "presumed" ? "check" : "clock"} size={12} />
        {SOURCE_NOTE[source]}
      </div>

      <div className="mts2-kinds" role="group" aria-label="What this day was">
        {KINDS.map((k) => (
          <button
            key={k.t}
            type="button"
            className={`mts2-kind${kind === k.t ? " on" : ""}`}
            aria-pressed={kind === k.t}
            onClick={() => setKind(k.t)}
          >
            {k.label}
          </button>
        ))}
      </div>

      {/* the times, scrolled. There is no text input on this screen. */}
      {kind === "work" && (
        <>
          <div className="mts2-wheels">
            <TimeWheel label="Start" value={start} onChange={setStart} disabled={busy} />
            <TimeWheel label="Finish" value={end} onChange={setEnd} disabled={busy} />
          </div>

          {/* the break, only when this workspace has one. Paid breaks are on
              the clock: nothing to deduct, so nothing to adjust. */}
          {hasBreak && (
            <div className="mts2-brk">
              <span className="mts2-brkl">{breakLine(settings, breakMin)}</span>
              {adjustable && (
                <span className="mts2-brkstep">
                  <button
                    aria-label="Shorter break"
                    onClick={() => setBreakMin((m) => Math.max(0, m - BREAK_STEP))}
                  >
                    −
                  </button>
                  <b>{breakMin}</b>
                  <button
                    aria-label="Longer break"
                    onClick={() => setBreakMin((m) => Math.min(BREAK_MAX, m + BREAK_STEP))}
                  >
                    +
                  </button>
                </span>
              )}
            </div>
          )}

          {/* what the times mean, live. No hours box: this IS the hours field. */}
          <div className={`mts2-derv${short ? " short" : ""}`}>
            <Icon name="clock" size={13} />
            <span>
              {start} – {end} · <b>{fmtH(derived)}h</b>
              {short && ` · short of your ${fmtHval(settings.standard)} day — your manager will see it`}
            </span>
          </div>
        </>
      )}

      {kind === "off" && (
        <div className="mts2-derv off">
          <Icon name="clock" size={13} />
          <span>
            No hours for this day. If it was leave or sick, book it in <b>My leave</b> instead so it
            pays.
          </span>
        </div>
      )}

      {/* the same split the pay run uses — hours and multipliers, never money */}
      <div className="mts2-pay">
        <span className="mts2-payl">Payroll</span>
        <span className="mts2-paych">
          {chip.parts.join(" + ")} = <b>{fmtH(chip.total)}h</b>
        </span>
      </div>

      <div className="mts2-eacts">
        <button className="mts2-btn primary" disabled={busy} onClick={commit}>
          <Icon name="check" size={14} />
          Save day
        </button>
        {source === "entered" && (
          <button
            className="mts2-btn"
            disabled={busy}
            onClick={() => onSave(index, { t: "empty" })}
            title={expected ? "Go back to your normal day" : "Take this day off the timesheet"}
          >
            {expected ? "Back to normal" : "Remove day"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- my normal hours ---------------- */

/* The personal end of the setting the org owns. The workspace names a normal
   start and finish; this is where a person whose day genuinely differs says
   so, without needing the pay settings — and therefore without needing
   `financials`. */
const DOW_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const DOW_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function NormalHoursCard({
  normal,
  own,
  workDays,
  ownDays,
  settings,
  busy,
  onSave,
}: {
  normal: NormalHours;
  own: boolean;
  workDays: number[];
  ownDays: boolean;
  settings: Settings;
  busy: boolean;
  onSave: (start: string | null, end: string | null, days?: number[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(normal.start);
  const [end, setEnd] = useState(normal.end);
  const [days, setDays] = useState<number[]>(workDays);

  const mine = own || ownDays;
  const toggle = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  return (
    <section className="mts2-card">
      <div className="mts2-ch">
        <span>My normal week</span>
      </div>
      <div className="mts2-nh">
        <b>
          {normal.start} – {normal.end}
        </b>
        <em>{workDaysLabel(workDays)}</em>
        <em>
          {mine
            ? "Yours. These are the days that get filled in for you."
            : `The workspace default (${settings.defaultStart} – ${settings.defaultEnd}, ${workDaysLabel(settings.workDays)}).`}
        </em>
      </div>
      {open ? (
        <>
          <div className="mts2-wheels tight">
            <TimeWheel label="Start" value={start} onChange={setStart} disabled={busy} />
            <TimeWheel label="Finish" value={end} onChange={setEnd} disabled={busy} />
          </div>
          {/* WHICH DAYS, not just which hours. Without this a part-timer on
              Mon/Tue/Thu has a full Wednesday presumed onto them every week of
              their working life, and their only recourse is to open it and say
              "didn't work" — 52 times a year. */}
          <div className="mts2-dow" role="group" aria-label="Days I normally work">
            {DOW_LABELS.map((l, i) => (
              <button
                key={i}
                type="button"
                className={`mts2-dowb${days.includes(i) ? " on" : ""}`}
                aria-label={DOW_NAMES[i]}
                aria-pressed={days.includes(i)}
                disabled={busy}
                onClick={() => toggle(i)}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="mts2-eacts">
            <button
              className="mts2-btn primary"
              disabled={busy}
              onClick={() => {
                onSave(start, end, days);
                setOpen(false);
              }}
            >
              <Icon name="check" size={14} />
              Save
            </button>
            <button className="mts2-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            {mine && (
              <button
                className="mts2-btn"
                disabled={busy}
                onClick={() => {
                  onSave(null, null, null);
                  setOpen(false);
                }}
              >
                Use the default
              </button>
            )}
          </div>
        </>
      ) : (
        <button className="mts2-hlink" onClick={() => setOpen(true)}>
          Change my normal week
          <Icon name="chevR" size={13} />
        </button>
      )}
    </section>
  );
}

/* ---------------- unavailability (casuals) ---------------- */

/* A casual saying when they can't work. It is a DECLARATION, not a request —
   there is no approve step, because a casual has no entitlement to spend and
   an approval would imply the answer could be no. See
   lib/timepay/availability.ts.

   It lives on this screen rather than in My leave because a casual has no
   leave: this is the only place they have to say anything about their time,
   and it is where they already are when they think of it. */
function AvailabilityCard({
  blocks,
  todayISO,
  busy,
  onMark,
  onClear,
}: {
  blocks: Unavailability[];
  todayISO: string;
  busy: boolean;
  onMark: (from: string, to: string, note: string) => void;
  onClear: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const live = upcoming(blocks, todayISO);
  const check = from && to ? validateBlock(from, to, todayISO) : null;
  const problem = check && !check.ok ? check.error : null;

  return (
    <section className="mts2-card">
      <div className="mts2-ch">
        <span>When I can&rsquo;t work</span>
      </div>
      {live.length === 0 ? (
        <div className="mts2-none">Nothing marked. You&rsquo;re available.</div>
      ) : (
        <div className="mts2-ulist">
          {live.map((b) => (
            <div className="mts2-u" key={b.id}>
              <span>
                <b>{blockLabel(b)}</b>
                {b.note && <em>{b.note}</em>}
              </span>
              <button
                className="mts2-ux"
                aria-label={`Remove ${blockLabel(b)}`}
                disabled={busy}
                onClick={() => onClear(b.id)}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {open ? (
        <>
          <div className="mts2-udates">
            <label className="mts-f">
              <span>From</span>
              <DateField value={from} min={todayISO} onChange={setFrom} />
            </label>
            <label className="mts-f">
              <span>To</span>
              <DateField value={to} min={from ?? todayISO} onChange={setTo} />
            </label>
          </div>
          <label className="mts-f mts2-unote">
            <span>Why (optional)</span>
            <input
              value={note}
              maxLength={200}
              placeholder="e.g. away, second job"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {problem && <div className="mts2-uerr">{problem}</div>}
          <div className="mts2-eacts">
            <button
              className="mts2-btn primary"
              disabled={busy || !from || !to || !!problem}
              onClick={() => {
                if (from && to) onMark(from, to, note);
                setOpen(false);
                setFrom(null);
                setTo(null);
                setNote("");
              }}
            >
              <Icon name="check" size={14} />
              Mark unavailable
            </button>
            <button className="mts2-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button className="mts2-hlink" onClick={() => setOpen(true)}>
          Mark days I can&rsquo;t work
          <Icon name="chevR" size={13} />
        </button>
      )}
      <p className="mts2-unote-p">
        Nobody approves this — it just tells whoever does the roster not to put you on.
      </p>
    </section>
  );
}

/* ---------------- the screen ---------------- */

export function MyTimesheet({
  me,
  sources,
  normal,
  ownNormal,
  workDays,
  ownWorkDays,
  employment,
  salaried = false,
  unavailable,
  week,
  today,
  through,
  todayISO,
  periodStart,
  periods,
  periodIndex,
  settings,
  sheet,
  holidays,
  state,
}: {
  me: StaffWeek;
  /** where each day's content came from — see logic.ts `presumeDays` */
  sources: DaySource[];
  /** this person's normal hours, org default or their own override */
  normal: NormalHours;
  /** true when the hours above are theirs rather than the workspace's */
  ownNormal: boolean;
  /** the days this person is expected — EMPTY for a casual. Everything that
      reads the week must use it: it decides what's presumed, what's missing
      and what counts as a short day. */
  workDays: number[];
  ownWorkDays: boolean;
  employment: EmploymentClass;
  /** their week pays itself — the screen goes exception-only. The record
      keeps writing underneath (presumption + submit unchanged), because an
      annualised salary still wants hours behind it and the future payroll
      export needs a period. */
  salaried?: boolean;
  /** a casual's unavailability blocks; empty for everyone else */
  unavailable: Unavailability[];
  week: WeekCtx["week"];
  today: number;
  /** last index whose day is OVER — today isn't, so today can't be "missing" */
  through: number;
  todayISO: string;
  periodStart: string;
  /** the same period switcher the admin screen uses, newest first */
  periods: PayPeriod[];
  periodIndex: number;
  settings: Settings;
  sheet: SheetState;
  /** org holidays for this staff member's state — period + upcoming */
  holidays: { date: string; name: string }[];
  /** which state's calendar those are, for the rail's toggle */
  state?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /* Which tab is open. It starts on today — the day a person opening their
     timesheet is nearly always here about — rather than on nothing. */
  const [selected, setSelected] = useState<number>(() => Math.max(0, today));
  const [allHolidays, setAllHolidays] = useState(false);

  /* The roster travels with the week. `derive` and `dayClass` both ask "was
     this person expected today?" to decide missing days and short days, and
     answering that with a bare Mon–Fri would show a casual a week of missing
     days the server had just, correctly, declined to fill in. */
  const ctx: WeekCtx = { week, today, through, workDays, holidays: me.holidayDays };
  const casual = employment === "casual";
  const d = derive(me, settings, ctx);
  const groups = weekGroups(me.days);
  const multiWeek = groups.length > 1; // fortnight / month read as week-rows
  const period = periods[periodIndex];
  const sent = sheet.status === "submitted" || sheet.status === "approved";
  /* A salaried week is read-only at REST: same pay whatever the days say, so
     there is nothing to ask. "Add overtime" opens the editors for the one
     exception worth recording — otMode is the tick, not a different screen. */
  const [otMode, setOtMode] = useState(false);
  const salariedRest = salaried && !otMode;
  // a closed period is history: you can read it, you can't rewrite it
  const locked = sent || !period.live || salariedRest;
  const status = STATUS_COPY[sheet.status];

  // in-period holidays name themselves in the panel; the rail lists the month
  const holidayByDate = useMemo(() => new Map(holidays.map((h) => [h.date, h.name])), [holidays]);

  /* Which month the rail's holiday module is about: the one the middle of the
     period falls in, so a week straddling a month boundary belongs to the
     month it mostly lives in rather than to whichever day it happens to start
     on. A monthly cycle is trivially its own month. */
  const monthISO = dateOfDay(periodStart, Math.floor(week.length / 2)).slice(0, 7);
  const monthLabel = `${MONTHS_FULL[Number(monthISO.slice(5, 7)) - 1]} ${monthISO.slice(0, 4)}`;
  const monthHolidays = holidays.filter((h) => h.date.startsWith(monthISO));

  const run = (action: () => Promise<TimepayResult>) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  const goPeriod = (i: number) => {
    const target = periods[i];
    if (target) router.push(`/dashboard/my-timesheet?period=${target.start}`);
  };

  const cycleTitle =
    settings.cycle === "Fortnightly" ? "My fortnight" : settings.cycle === "Monthly" ? "My month" : "My week";

  /* hours × multiplier, the buckets that make up the payroll total. Paid
     absence sits in the ×1.0 bucket because that is how derive() weights it,
     so the chips add up to the number above them. */
  const buckets: [number, string][] = [
    [d.normal + d.leave + d.sick + d.ph, "×1.0"],
    [d.ot, "×1.5"],
    [d.ot2, "×2.0"],
  ];

  const rules = [
    /* A casual has no normal week, so stating one would be a lie about how
       their timesheet behaves — theirs says what it actually is instead. */
    casual ? "Casual · every day entered by hand" : `Normal ${normal.start} – ${normal.end}`,
    casual ? null : workDaysLabel(workDays),
    `Standard ${fmtHval(settings.standard)} day`,
    `OT after ${fmtHval(settings.otAfter)}/${settings.otUnit}`,
    settings.breakMinutes > 0
      ? `${settings.breakMinutes} min break · ${settings.breakPaid ? "paid" : "unpaid"}`
      : null,
    settings.rules.sat.on ? `Sat ${ruleSummary(settings.rules.sat)}` : null,
    settings.rules.sun.on ? `Sun ${ruleSummary(settings.rules.sun)}` : null,
    settings.rules.ph.on ? `Public holidays ${ruleSummary(settings.rules.ph)}` : null,
    settings.rules.night.on ? `Night 10 PM – 6 AM ${ruleSummary(settings.rules.night)}` : null,
    submitNote(settings).replace(/^Open · /, ""),
  ].filter(Boolean);

  return (
    <div className="page in">
      <div className="wrap">
        <div className={`stg tpr mts2${locked ? " locked" : ""}`}>
          <div className="rhead">
            <div>
              <h1>My timesheet</h1>
              <div className="wknav">
                <button
                  className="arw"
                  aria-label="Previous period"
                  disabled={periodIndex >= periods.length - 1 || pending}
                  onClick={() => goPeriod(periodIndex + 1)}
                >
                  <Icon name="chevL" size={17} />
                </button>
                <span className="range">
                  {period.range} <em>{period.year}</em>
                </span>
                <button
                  className="arw"
                  aria-label="Next period"
                  disabled={periodIndex <= 0 || pending}
                  onClick={() => goPeriod(periodIndex - 1)}
                >
                  <Icon name="chevR" size={17} />
                </button>
                {period.live ? (
                  <span className="pstatus live">
                    <span className="d"></span>LIVE
                  </span>
                ) : (
                  <span className="pstatus hist">Historical</span>
                )}
              </div>
              <div className="autosub">{period.live ? submitNote(settings) : period.note}</div>
            </div>
            <div className="racts">
              <span className={`dchip ${status.tone}`}>
                <Icon name={sheet.status === "approved" ? "check" : "clock"} size={12} />
                {status.label}
              </span>
            </div>
          </div>

          {error && <div className="tp-err">{error}</div>}

          <div className="mts2-cols">
            <div className="mts2-main">
              {sheet.status === "sent_back" && sheet.reviewNote && (
                <div className="mts-back">
                  <Icon name="send" size={15} />
                  <span>
                    <b>Sent back with a question</b>
                    <em>{sheet.reviewNote}</em>
                  </span>
                </div>
              )}

              {groups.map((g) => {
                const holdsSelection = g.days.some(({ index }) => index === selected);
                return (
                  <div className="mts2-wk" key={g.start}>
                    {multiWeek && (
                      <div className="mts-wh">
                        <span>{g.label}</span>
                        <em>{fmtH(g.workedHours)}h</em>
                      </div>
                    )}

                    {/* THE WEEK. One row of cards, and the only view of the
                        days — clicking one opens it in the panel below, the
                        way a browser tab opens its page. */}
                    <div className="mts2-tabs" role="tablist" aria-label={g.label}>
                      {g.days.map(({ entry, index }) => {
                        const w = week[index];
                        const cls = dayClass(entry, index, settings, ctx);
                        const on = selected === index;
                        const src = sources[index] ?? "entered";
                        return (
                          <button
                            type="button"
                            role="tab"
                            key={index}
                            className={`mts2-tab ${cls}${on ? " on" : ""}${
                              expectsWork(ctx, dowOf(w)) ? "" : " offroster"
                            }${index === today ? " today" : ""}${src === "expected" ? " ahead" : ""}`}
                            aria-selected={on}
                            aria-label={`${dayLabel(w)} — ${PILL[cls]}`}
                            onClick={() => setSelected(index)}
                          >
                            <span className="cw">{w[0]}</span>
                            <span className="cd">{w[1]}</span>
                            <span className="cs">{daySummary(entry)}</span>
                            <span className="cbar"></span>
                          </button>
                        );
                      })}
                    </div>

                    {/* the panel the tabs open onto — one day, never seven */}
                    {holdsSelection && (
                      <div className="mts2-panel" role="tabpanel">
                        <div className="mts2-phead">
                          <span className="mts2-pd">{dayLabel(week[selected])}</span>
                          <span className={`mts2-pill ${dayClass(me.days[selected], selected, settings, ctx)}`}>
                            {PILL[dayClass(me.days[selected], selected, settings, ctx)]}
                          </span>
                          {holidayByDate.get(dateOfDay(periodStart, selected)) && (
                            <span className="mts2-ehol">
                              <Icon name="calendar" size={11} />
                              {holidayByDate.get(dateOfDay(periodStart, selected))}
                            </span>
                          )}
                        </div>
                        {locked ? (
                          <div className="mts2-elock">
                            <Icon name="check" size={16} />
                            <span>
                              <b>{daySummary(me.days[selected])}</b>
                              <em>
                                {sent
                                  ? "This week has been sent — it can't be changed here."
                                  : !period.live
                                    ? "This period is closed."
                                    : "Salaried — the day pays itself. Add overtime if this one ran long."}
                              </em>
                            </span>
                          </div>
                        ) : (
                          <DayEditor
                            key={selected}
                            index={selected}
                            entry={me.days[selected]}
                            source={sources[selected] ?? "entered"}
                            ctx={ctx}
                            settings={settings}
                            normal={normal}
                            holidayName={holidayByDate.get(dateOfDay(periodStart, selected))}
                            busy={pending}
                            onSave={(idx, e) => run(() => saveDay(periodStart, idx, e))}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="mts2-legend">
                {LEGEND.map(([cls, label]) => (
                  <span className="mts2-lg" key={cls}>
                    <i className={cls}></i>
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <aside className="mts2-rail">
              <section className="mts2-card">
                <div className="mts2-ch">
                  <span>{cycleTitle}</span>
                  <span className={`dchip ${status.tone}`}>{status.label}</span>
                </div>
                <div className="mts2-range">
                  {period.range} <em>{period.year}</em>
                </div>
                <div className="mts2-tot">
                  <div className="mts2-t">
                    <b>{fmtH(d.worked)}h</b>
                    <em>Actual worked</em>
                  </div>
                  <div className="mts2-t pay">
                    <b>{fmtH(d.weighted)}h</b>
                    <em>Payroll hrs</em>
                  </div>
                </div>
                <div className="mts2-bk">
                  {buckets
                    .filter(([h]) => h > 0)
                    .map(([h, mult]) => (
                      <span className="mts2-bkc" key={mult}>
                        {fmtH(h)}h {mult}
                      </span>
                    ))}
                </div>
                <div className="mts2-sub">
                  {!period.live && !sent
                    ? "This period is closed."
                    : salariedRest && !sent
                      ? "Salaried — your pay is the same every week, so there's nothing to fill in. Leave and public holidays arrive from where they're booked."
                      : casual && sheet.status === "draft"
                        ? "Add the days you worked, then submit. Nothing is filled in for you."
                        : status.sub}
                </div>
                {salaried && !sent && period.live && (
                  <button className="bbtn mts2-submit" disabled={pending} onClick={() => setOtMode((v) => !v)}>
                    <Icon name={otMode ? "check" : "clock"} size={14} />
                    {otMode ? "Done adding overtime" : "Add overtime"}
                  </button>
                )}
                {otMode && !sent && period.live && (
                  <div className="mts2-sub">
                    Pick the day it happened and extend its times.
                    {settings.salariedOtPaid === false &&
                      " It's recorded with your week — your salary already covers additional hours."}
                  </div>
                )}
                {!sent && period.live && (
                  <button
                    className="bbtn ink mts2-submit"
                    disabled={pending || d.entries === 0}
                    onClick={() => run(() => submitWeek(periodStart))}
                  >
                    <Icon name="send" size={14} />
                    {sheet.status === "sent_back" ? "Submit again" : "Submit week"}
                  </button>
                )}
              </section>

              {/* A casual has no normal week to state — that is the whole
                  difference. What they have instead is days they can't work. */}
              {casual ? (
                <AvailabilityCard
                  blocks={unavailable}
                  todayISO={todayISO}
                  busy={pending}
                  onMark={(f, t, n) => run(() => markUnavailable(f, t, n))}
                  onClear={(id) => run(() => clearUnavailable(id))}
                />
              ) : (
                <NormalHoursCard
                  normal={normal}
                  own={ownNormal}
                  workDays={workDays}
                  ownDays={ownWorkDays}
                  settings={settings}
                  busy={pending}
                  onSave={(s, e, days) => run(() => saveMyHours(s, e, days))}
                />
              )}

              <section className="mts2-card">
                <div className="mts2-ch">
                  <span>Public holidays — {monthLabel}</span>
                </div>
                {monthHolidays.length === 0 ? (
                  <div className="mts2-none">No public holidays this month</div>
                ) : (
                  <div className="mts2-hlist">
                    {monthHolidays.map((h) => (
                      <div className="mts2-h" key={h.date}>
                        <b>{Number(h.date.slice(8, 10))}</b>
                        <em>{h.name}</em>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  className="mts2-hlink"
                  aria-expanded={allHolidays}
                  onClick={() => setAllHolidays((v) => !v)}
                >
                  {`All ${state ?? ""} public holidays`.replace(/\s+/g, " ")}
                  <Icon name={allHolidays ? "chevD" : "chevR"} size={13} />
                </button>
                {allHolidays && <UpcomingHolidays holidays={holidays} today={todayISO} />}
              </section>

              <p className="mts2-rules">{rules.join(" · ")}</p>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
