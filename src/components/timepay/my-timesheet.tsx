"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, IconButton, LinkButton } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextInput } from "@/components/parts/field";
import { Dot, StateWord, type Hue, type Tone } from "@/components/parts/state";
import { Wrong } from "@/components/parts/states";
import { Tray } from "@/components/parts/tabs";
import { TimeField } from "@/components/parts/time-field";
import { Icon } from "@/components/shell/icon";
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
import { upcomingHolidays } from "@/lib/timepay/leave";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { dateOfDay } from "@/lib/timepay/period";
import { submitDayIndex } from "@/lib/timepay/auto-submit";
import type { PayPeriod } from "./timepay";
import {
  type DayClass,
  type DayEntry,
  type DaySource,
  type NormalHours,
  type Settings,
  type WeekCtx,
  type WeekDay,
  type StaffWeek,
  DAY_WORD,
  breakLine,
  cycleNoun,
  dayClass,
  dayLabel,
  daysToCome,
  derive,
  derivedDayHours,
  dowOf,
  fmtH,
  fmtHval,
  expectedDay,
  expectsWork,
  isOver,
  isWeekendRate,
  lastDayToCome,
  ruleSummary,
  seedBreakMinutes,
  splitDay,
  workDaysLabel,
  weekGroups,
} from "./logic";
import { legendFor } from "./tiles";

/* YOUR TIMESHEET (v2, step 5; the board 6-timesheet): the week as a row per
   day on the left, the day you opened in a card on the right, the period's
   totals and the key under the rows. Your name › Timesheet, at the address
   it always had.

   TODAY'S ENGINE, A NEW LAYOUT. Every rule this screen applied before v2 is
   applied here unchanged, and every write is the same action:

   1. A NORMAL WEEK TAKES NO INPUT. The server presumes the week (logic.ts
      `presumeDays`) before this screen sees it, so what is drawn is what
      submits. A presumed day says it was filled in for you; a booked
      absence or a public holiday arrives already marked and is read only.

   2. A TIME CANNOT BE TYPED. Started and Finished are the TimeField part,
      the wheel (rule 34). The unpaid break is minutes in a number field
      (6-revisions, decision 27), kept to fives and to the two hours the
      stepper allowed.

   3. THE PAYROLL LINES ARE THE PAY RUN'S: `splitDay` and `derive`, the
      functions the approver's screen and the pay run read.

   NO MONEY LIVES HERE: not a rate, not a gross, not a dollar sign. The
   wage isn't hidden at render time: `getMyWeek` doesn't select it.

   Started is never filled in from check-ins (Isaac's open call, taken as
   recommended): a worked day's times are what was saved, or the normal
   hours a presumed day carries. */

/* What you can say a day was. Leave, sick and public holidays are booked
   elsewhere and arrive already marked, so they are not offered here; both
   words come from DAY_WORD, the one name for each state. */
const KINDS = [
  { value: "work", label: "Worked" },
  { value: "off", label: DAY_WORD.off },
] as const;

/** What to CALL a day: a worked weekend is at a premium for the day of the
    week, not because it ran long, so it says so. */
function dayWord(entry: DayEntry, cls: DayClass, dow: number, s: Settings): string {
  return isWeekendRate(entry, dow, s) ? "Weekend rates" : DAY_WORD[cls];
}

/* Where a saved day came from, so a presumed day never reads as though the
   person logged it. */
const SOURCE_NOTE: Record<DaySource, string> = {
  entered: "You logged this day.",
  holiday: "Public holiday — the business is closed.",
  leave: "Booked leave — this came from your leave, not from here.",
  presumed: "Your normal day, filled in for you.",
  expected: "Not yet. This day is marked as worked once the day is over.",
  none: "Weekends aren't counted unless you add them.",
};

/* The sheet's state as one word (rule 17), in the cycle's noun. */
const statusCopy = (
  status: SheetState["status"],
  noun: string,
): { label: string; tone: Tone; sub: string } =>
  ({
    draft: { label: "Draft", tone: "look" as Tone, sub: "" },
    submitted: { label: "Submitted", tone: "good" as Tone, sub: "With your manager. You'll be told if anything needs a look." },
    approved: { label: "Approved", tone: "good" as Tone, sub: `Signed off. This ${noun} is closed.` },
    sent_back: { label: "Sent back", tone: "wrong" as Tone, sub: "Your manager has a question — answer it and submit again." },
  })[status];

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_FULL: Record<string, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
};

/** "Monday 29 June", the open day's title. */
function fullDay(w: WeekDay): string {
  const month = MONTHS_FULL.find((m) => m.slice(0, 3) === w[2]) ?? w[2];
  return `${WEEKDAY_FULL[w[0]] ?? w[0]} ${w[1]} ${month}`;
}

/** "Mon 29", the row's day. */
const shortDay = (w: WeekDay): string => `${w[0].charAt(0)}${w[0].slice(1).toLowerCase()} ${w[1]}`;

/* The break's limits: the stepper went 0 to 120 in fives, and a typed
   number keeps to the same. */
const BREAK_STEP = 5;
const BREAK_MAX = 120;
const clampBreak = (n: number) => Math.min(BREAK_MAX, Math.max(0, Math.round(n)));

/** A day's stored content as one string: the card's remount key, so the
    open card always shows what was saved rather than what it mounted with. */
function entryKey(d: DayEntry): string {
  if (d.t === "work") return `work:${d.in}:${d.out}:${d.h}`;
  if (d.t === "empty" || d.t === "off") return d.t;
  return `${d.t}:${d.h}`;
}

/* ---------------- a day's mark (rule 21) ----------------

   A dot for a day worked, in the key's colour; a day away is a small white
   card with its symbol, a sun for leave and a plaster for sick. Nothing for
   a day with nothing on it. The word beside it says what it means. */
const DOT_HUE: Partial<Record<DayClass, Hue>> = {
  std: "green",
  over: "orange",
  under: "pink",
  ph: "purple",
  miss: "red",
  off: "grey",
};

function DayMark({ cls }: { cls: DayClass }) {
  if (cls === "leave" || cls === "sick")
    return (
      <span className="ts2-away" aria-hidden="true">
        <Icon name={cls === "leave" ? "sun" : "plaster"} size={14} />
      </span>
    );
  const hue = DOT_HUE[cls];
  if (!hue) return <span className="ts2-nomark" aria-hidden="true" />;
  return <Dot hue={hue} />;
}

/** The tone a day's word takes in its row: needs a look, wrong, or plain. */
const WORD_TONE: Partial<Record<DayClass, "look" | "wrong">> = { over: "look", under: "look", miss: "wrong" };

/* ---------------- the open day ---------------- */

function DayCard({
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
  /** the hours a day is filled in with once you say you worked it */
  normal: NormalHours;
  holidayName?: string;
  busy: boolean;
  onSave: (i: number, e: DayEntry) => void;
}) {
  const w = ctx.week[index];
  const startId = useId();
  /* Not "is it a weekend": "were you expected". A casual is never expected,
     so no day of theirs is short and every day is one they added. */
  const expected = expectsWork(ctx, dowOf(w));
  /* Leave is the leave module's, read only here. A public holiday stays
     read only until the person says they worked it, and then it is an
     ordinary worked day (the holiday rate comes from the date). */
  const [workedHoliday, setWorkedHoliday] = useState(false);
  const lockedDay = entry.t === "leave" || entry.t === "sick" || (entry.t === "ph" && !workedHoliday);

  /* A DAY WITH NOTHING ON IT ANSWERS NOTHING FOR YOU: no switch and no
     times until you say which it was, so the most expensive day in the
     period is never one press from real. */
  const [kind, setKind] = useState<"work" | "off" | null>(
    entry.t === "empty" ? null : entry.t === "off" ? "off" : "work",
  );
  /* Save exists once there is something to save. */
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);
  const [start, setStart] = useState(entry.t === "work" ? entry.in : normal.start);
  const [end, setEnd] = useState(entry.t === "work" ? entry.out : normal.end);
  const [breakMin, setBreakMin] = useState(() => seedBreakMinutes(entry, settings));

  const cls = dayClass(entry, index, settings, ctx);
  const word = dayWord(entry, cls, dowOf(w), settings);

  const hasBreak = settings.breakMinutes > 0;
  const adjustable = hasBreak && !settings.breakPaid;
  const derived = derivedDayHours(start, end, settings, breakMin) ?? 0;
  /* The pay run's split, with the same holiday flag and clocks. */
  const onHoliday = (ctx.holidays ?? []).includes(index);
  const split = splitDay(kind === "work" ? derived : 0, dowOf(w), settings, {
    publicHoliday: onHoliday,
    in: start,
    out: end,
  });
  const plain = !split.o15 && !split.o2;
  const forPayroll = split.n + split.o15 * 1.5 + split.o2 * 2;
  /* Short of the day THEY work, not the workspace's (`expectedDay`). */
  const ownDay = expectedDay(ctx, settings);
  const short = kind === "work" && expected && derived < ownDay;

  /* Cancel puts the day back to what is stored. */
  const reset = () => {
    setDirty(false);
    setKind(entry.t === "empty" ? null : entry.t === "off" ? "off" : "work");
    setStart(entry.t === "work" ? entry.in : normal.start);
    setEnd(entry.t === "work" ? entry.out : normal.end);
    setBreakMin(seedBreakMinutes(entry, settings));
  };

  const commit = () => {
    if (kind === null) return;
    onSave(index, kind === "off" ? { t: "off" } : { t: "work", in: start, out: end, h: derived });
  };

  /* Saying you worked a day puts you on its Started field. */
  const startWork = () => {
    touch();
    setKind("work");
    requestAnimationFrame(() => document.getElementById(startId)?.focus());
  };

  const head = (
    <div className="ts2-card-head">
      <div className="ts2-card-title">
        <h2 className="ts2-card-h">{fullDay(w)}</h2>
        {holidayName && (
          <p className="ts2-card-hol">
            <Icon name="calendar" size={14} />
            {holidayName}
          </p>
        )}
      </div>
      {lockedDay || kind === null ? (
        <span className={`ts2-word${WORD_TONE[cls] ? ` ts2-word--${WORD_TONE[cls]}` : ""}`}>{word}</span>
      ) : (
        <Tray
          ariaLabel="What this day was"
          options={KINDS}
          value={kind}
          disabled={busy}
          onChange={(k) => {
            touch();
            setKind(k);
          }}
        />
      )}
    </div>
  );

  if (lockedDay) {
    return (
      <div className="ts2-card-body">
        {head}
        <div className="ts2-lock">
          <b>
            {entry.t === "ph"
              ? (holidayName ?? "Public holiday")
              : entry.t === "sick"
                ? "Sick leave"
                : "Annual leave"}
            {" — "}
            {fmtH(entry.h)}h
          </b>
          <span className="ts2-note">{SOURCE_NOTE[source]}</span>
        </div>
        {entry.t === "ph" && (
          <div className="ts2-acts">
            <Button
              kind="second"
              disabled={busy}
              /* saying you worked it IS the change, so Save comes with it */
              onClick={() => {
                setWorkedHoliday(true);
                touch();
              }}
            >
              I worked this public holiday
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ts2-card-body">
      {head}
      {/* where the SAVED day came from, quiet while you change it */}
      {!dirty && <p className={`ts2-note ts2-src ts2-src--${source}`}>{SOURCE_NOTE[source]}</p>}

      {/* A rostered day that is over and still empty is missing: both
          answers. One still to come can only be declared off in advance. A
          day you are not rostered on can only be added. */}
      {kind === null && (
        <div className="ts2-acts ts2-acts--start">
          {(!expected || isOver(ctx, index)) && (
            <Button kind="main" icon="clock" disabled={busy} onClick={startWork}>
              {expected ? "Log hours" : "Add this day"}
            </Button>
          )}
          {expected && (
            <Button
              kind="second"
              disabled={busy}
              onClick={() => {
                touch();
                setKind("off");
              }}
            >
              Mark as {DAY_WORD.off.toLowerCase()}
            </Button>
          )}
        </div>
      )}

      {kind === "work" && (
        <>
          <div className="ts2-times">
            <Field label="Started" id={startId}>
              <TimeField
                value={start}
                disabled={busy}
                onChange={(v) => {
                  touch();
                  setStart(v);
                }}
              />
            </Field>
            <Field label="Finished">
              <TimeField
                value={end}
                disabled={busy}
                onChange={(v) => {
                  touch();
                  setEnd(v);
                }}
              />
            </Field>
          </div>
          <div className="ts2-times">
            {/* the break, only when the workspace has one; a paid break is
                on the clock, so there is nothing to change on a day */}
            {adjustable ? (
              <Field label="Unpaid break, minutes">
                <TextInput
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={BREAK_MAX}
                  step={BREAK_STEP}
                  value={breakMin}
                  disabled={busy}
                  onChange={(e) => {
                    touch();
                    setBreakMin(clampBreak(Number(e.target.value) || 0));
                  }}
                  /* kept to fives, as the stepper was */
                  onBlur={() => setBreakMin((m) => clampBreak(Math.round(m / BREAK_STEP) * BREAK_STEP))}
                />
              </Field>
            ) : hasBreak ? (
              <div className="ts2-fig">
                <span className="ts2-fig-l">Break</span>
                <span className="ts2-fig-v ts2-fig-v--plain">{breakLine(settings, breakMin)}</span>
              </div>
            ) : null}
            <div className="ts2-fig">
              <span className="ts2-fig-l">Hours</span>
              <span className="ts2-fig-v ts2-hours">{fmtH(derived)}h</span>
            </div>
          </div>
          {short && (
            <StateWord tone="look" className="ts2-short">
              Short of your {fmtHval(ownDay)} day, your manager will see it
            </StateWord>
          )}
        </>
      )}

      {kind === "off" && (
        <p className="ts2-note ts2-offline">
          No hours for this day. If it was leave or sick, book it in{" "}
          <LinkButton href="/dashboard/my-leave">My leave</LinkButton> instead so it pays.
        </p>
      )}

      {/* the same split the pay run uses, hours and multipliers, and only
          when the day is worth more than its hours */}
      {kind === "work" && !plain && (
        <dl className="ts2-pay">
          {split.n > 0 && (
            <div>
              <dt>Ordinary</dt>
              <dd>{fmtH(split.n)}h</dd>
            </div>
          )}
          {split.o15 > 0 && (
            <div>
              <dt>Time and a half</dt>
              <dd>{fmtH(split.o15)}h</dd>
            </div>
          )}
          {split.o2 > 0 && (
            <div>
              <dt>Double time</dt>
              <dd>{fmtH(split.o2)}h</dd>
            </div>
          )}
          <div className="ts2-pay-total">
            <dt>For payroll</dt>
            <dd>{fmtH(forPayroll)}h</dd>
          </div>
        </dl>
      )}

      {/* Save once there is something to save; Back to normal undoes an
          earlier edit, so it is not gated the same way */}
      {(dirty || busy || source === "entered") && (
        <div className="ts2-acts" aria-busy={busy}>
          {source === "entered" && !dirty && (
            <Button kind="second" disabled={busy} onClick={() => onSave(index, { t: "empty" })}>
              {expected ? "Back to normal" : "Remove day"}
            </Button>
          )}
          {dirty && !busy && (
            <Button kind="second" onClick={reset}>
              Cancel
            </Button>
          )}
          {(dirty || busy) && (
            <Button kind="main" disabled={busy || kind === null} onClick={commit}>
              {busy ? "Saving the day" : "Save day"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- your normal week, a dialog ----------------

   The personal end of the workspace's setting: which days are filled in for
   you, and at what hours. It saves through `saveMyHours`, as it always has. */

const DOW_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DOW_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function NormalWeekDialog({
  normal,
  workDays,
  mine,
  busy,
  onSave,
  onClose,
}: {
  normal: NormalHours;
  workDays: number[];
  mine: boolean;
  busy: boolean;
  onSave: (start: string | null, end: string | null, days?: number[] | null) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState(normal.start);
  const [end, setEnd] = useState(normal.end);
  const [days, setDays] = useState<number[]>(workDays);
  const toggle = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  return (
    <Dialog
      heading="Your normal week"
      onClose={onClose}
      width={560}
      foot={
        <>
          {mine && (
            <Button
              kind="second"
              disabled={busy}
              onClick={() => {
                onSave(null, null, null);
                onClose();
              }}
            >
              Use the default
            </Button>
          )}
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button
            kind="main"
            disabled={busy}
            onClick={() => {
              onSave(start, end, days);
              onClose();
            }}
          >
            Save normal week
          </Button>
        </>
      }
    >
      <div className="ts2-form">
        <div className="ts2-times">
          <Field label="Start">
            <TimeField value={start} onChange={setStart} disabled={busy} />
          </Field>
          <Field label="Finish">
            <TimeField value={end} onChange={setEnd} disabled={busy} />
          </Field>
        </div>
        <div className="pt-field">
          <span className="pt-field-label">Days you normally work</span>
          <div className="ts2-dow" role="group" aria-label="Days I normally work">
            {DOW_LABELS.map((l, i) => (
              <button
                key={i}
                type="button"
                className="ts2-dowb"
                aria-label={DOW_NAMES[i]}
                aria-pressed={days.includes(i)}
                disabled={busy}
                onClick={() => toggle(i)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------- when a casual can't work, a dialog ----------------

   A DECLARATION, not a request: nobody approves it (lib/timepay/
   availability). It lives here because a casual has no leave. */
function UnavailableDialog({
  todayISO,
  busy,
  onMark,
  onClose,
}: {
  todayISO: string;
  busy: boolean;
  onMark: (from: string, to: string, note: string) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const fromId = useId();
  const toId = useId();
  const check = from && to ? validateBlock(from, to, todayISO) : null;
  const problem = check && !check.ok ? check.error : null;

  return (
    <Dialog
      heading="Days you can’t work"
      onClose={onClose}
      width={560}
      foot={
        <>
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button
            kind="main"
            disabled={busy || !from || !to || !!problem}
            onClick={() => {
              if (from && to) onMark(from, to, note);
              onClose();
            }}
          >
            Mark unavailable
          </Button>
        </>
      }
    >
      <div className="ts2-form">
        <p className="ts2-note">Nobody approves this — it just tells whoever does the roster not to put you on.</p>
        <div className="ts2-times">
          <Field label="From" id={fromId} error={null}>
            <DateField id={fromId} value={from} min={todayISO} today={todayISO} onChange={setFrom} />
          </Field>
          <Field label="To" id={toId} error={problem}>
            <DateField id={toId} value={to} min={from ?? todayISO} today={todayISO} onChange={setTo} />
          </Field>
        </div>
        <Field label="Why (optional)">
          <TextInput value={note} maxLength={200} placeholder="Away, a second job" onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
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
  pastSend = false,
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
  /** the days this person is expected — EMPTY for a casual */
  workDays: number[];
  ownWorkDays: boolean;
  employment: EmploymentClass;
  /** their week pays itself, so the days are read only at rest */
  salaried?: boolean;
  /** a casual's unavailability blocks; empty for everyone else */
  unavailable: Unavailability[];
  week: WeekCtx["week"];
  today: number;
  /** last index whose day is OVER — today isn't, so today can't be "missing" */
  through: number;
  /** the workspace's send moment for this period has come (server clock) */
  pastSend?: boolean;
  todayISO: string;
  periodStart: string;
  /** the same period switcher the admin screen uses, newest first */
  periods: PayPeriod[];
  periodIndex: number;
  settings: Settings;
  sheet: SheetState;
  /** org holidays for this staff member's state — period + upcoming */
  holidays: { date: string; name: string }[];
  /** which state's calendar those are */
  state?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /* Which day is TODAY, by date: `today` is clamped to the last day of a
     period that is over, which is right for missing days and wrong for this. */
  const todayAt = week.findIndex((_, i) => dateOfDay(periodStart, i) === todayISO);
  /* The open day starts on today; on another week, on its first day. */
  const [selected, setSelected] = useState<number>(() => Math.max(0, todayAt));
  const [allHolidays, setAllHolidays] = useState(false);
  const [dialog, setDialog] = useState<null | "normal" | "unavailable">(null);
  /* the salaried exception: ONE day unlocked, from the day itself */
  const [otDay, setOtDay] = useState<number | null>(null);

  const ctx: WeekCtx = {
    week,
    today,
    through,
    workDays,
    dayHours: me.dayHours,
    holidays: me.holidayDays,
    certMissing: me.certMissing,
  };
  const casual = employment === "casual";
  const d = derive(me, settings, ctx);
  const groups = weekGroups(me.days);
  const multiWeek = groups.length > 1;
  const period = periods[periodIndex];
  const sent = sheet.status === "submitted" || sheet.status === "approved";
  /* With the lock off, a sent week stays open while it runs; approved never
     reopens. */
  const openAfterSending = sheet.status === "submitted" && !settings.lock && period.live;
  const frozenSent = sent && !openAfterSending;
  const salariedRest = salaried && otDay !== selected;
  /* A closed period is history, except a sheet sent back with a question,
     which has to stay answerable wherever it sits. */
  const reopened = sheet.status === "sent_back";
  const locked = frozenSent || (!period.live && !reopened) || salariedRest;
  const noun = cycleNoun(settings.cycle);
  const status = statusCopy(sheet.status, noun);

  /* Sending waits for the days it would freeze; a sent-back sheet never
     waits, since its answer IS a resubmission. */
  const toCome = daysToCome(ctx);
  const holdForDays = toCome > 0 && sheet.status !== "sent_back";

  const holidayByDate = useMemo(() => new Map(holidays.map((h) => [h.date, h.name])), [holidays]);
  const classes = me.days.map((entry, i) => dayClass(entry, i, settings, ctx));
  const legend = legendFor(classes);

  /* The month the period mostly lives in, for its public holidays. */
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

  /* Paid absence is its own figure, so the worked hours and the payroll
     hours both add up from what is shown. */
  const paidAbsence = d.leave + d.sick + d.ph;
  const figures: [string, number][] = (
    [
      ["Ordinary", d.normal],
      ["Time and a half", d.ot],
      ["Double time", d.ot2],
      ["Paid, not worked", paidAbsence],
    ] as [string, number][]
  ).filter(([, h]) => h > 0);

  /* The pay rules, only those stated nowhere else on the screen. */
  const rules = (
    [
      casual ? ["Casual", "Every day entered by hand"] : null,
      ["Standard day", fmtHval(settings.standard)],
      ["Overtime", `After ${fmtHval(settings.otAfter)} a ${settings.otUnit}`],
      settings.breakMinutes > 0
        ? [settings.breakPaid ? "Paid break" : "Unpaid break", `${settings.breakMinutes} min`]
        : null,
      settings.rules.sat.on ? ["Saturday", ruleSummary(settings.rules.sat)] : null,
      settings.rules.sun.on ? ["Sunday", ruleSummary(settings.rules.sun)] : null,
      settings.rules.ph.on ? ["Public holidays", ruleSummary(settings.rules.ph)] : null,
      settings.rules.night.on ? ["Nights, 10 PM – 6 AM", ruleSummary(settings.rules.night)] : null,
    ] as ([string, string] | null)[]
  ).filter((r): r is [string, string] => r !== null);

  /* A draft past the send moment is closed when the workspace locks; one
     with days on it was already sent by the loader on the way here. */
  const closedAtSend = settings.lock && pastSend && sheet.status === "draft";

  /* WHEN THIS SHEET GOES, said once, beside the button. */
  const canSend = !sent && (period.live || reopened) && !closedAtSend && !holdForDays && d.entries > 0;
  const lastAhead = lastDayToCome(ctx);
  const submitAt = submitDayIndex(week, settings.submitDay);
  const itSends = `it sends itself ${settings.submitDay} ${settings.submitTime}${
    settings.lock ? " and locks" : ""
  }`;
  const sendLine = holdForDays
    ? (casual ? "Add the days you worked. " : "") +
      (lastAhead >= 0 && lastAhead < submitAt
        ? `Send this ${noun} once ${dayLabel(week[lastAhead]!)} is over. If you don't, ${itSends}.`
        : `${itSends.charAt(0).toUpperCase()}${itSends.slice(1)}.`)
    : d.entries === 0
      ? `${casual ? "Add" : "Log"} the days you worked to send this ${noun}.`
      : `Ready to send. If you don't, ${itSends}.`;

  const sub =
    !period.live && !sent
      ? "This period is closed."
      : closedAtSend
        ? `This ${noun} locked at ${settings.submitDay} ${settings.submitTime}.`
        : salaried && !sent
          ? `Salaried — your pay is the same every ${noun}, so there's nothing to fill in. Leave and public holidays arrive from where they're booked.${
              settings.salariedOtPaid === false
                ? " A long day is still worth recording, but your salary already covers the extra hours."
                : ""
            }`
          : sheet.status === "draft"
            ? sendLine
            : openAfterSending
              ? `${status.sub} You can still change it until the ${noun} ends.`
              : status.sub;

  const mineNormal = ownNormal || ownWorkDays;
  const liveBlocks = upcoming(unavailable, todayISO);
  const yearHolidays = upcomingHolidays(holidays, todayISO);
  const selEntry = me.days[selected];
  const selCls = classes[selected];

  return (
    <div className="wrap ts2">
      <header className="ts2-head">
        <h1 className="ts2-h1">Timesheet</h1>
        <div className="ts2-send">
          <p className="ts2-sub">{sub}</p>
          {canSend && (
            <Button kind="second" icon="send" disabled={pending} onClick={() => run(() => submitWeek(periodStart))}>
              {sheet.status === "sent_back" ? "Send again" : `Send ${noun}`}
            </Button>
          )}
        </div>
      </header>

      <div className="ts2-bar">
        <div className="ts2-pager">
          <IconButton
            glyph="earlier"
            label="Previous period"
            size={32}
            disabled={periodIndex >= periods.length - 1 || pending}
            onClick={() => goPeriod(periodIndex + 1)}
          />
          <span className="ts2-range">
            {period.range} <span className="ts2-year">{period.year}</span>
          </span>
          <IconButton
            glyph="later"
            label="Next period"
            size={32}
            disabled={periodIndex <= 0 || pending}
            onClick={() => goPeriod(periodIndex - 1)}
          />
          <StateWord tone={status.tone} className="ts2-status">
            {status.label}
          </StateWord>
        </div>
        {/* a casual has no normal week; their days off are in the rail */}
        {!casual && (
          <p className="ts2-fact">
            {mineNormal ? "Your normal week" : "The workspace’s normal week"}: {workDaysLabel(workDays)}, {normal.start} to{" "}
            {normal.end}.{" "}
            <Button kind="quiet" size={32} disabled={pending} onClick={() => setDialog("normal")}>
              Change normal week
            </Button>
          </p>
        )}
      </div>

      {error && <Wrong word="Not saved" means={error} />}

      <div className="ts2-cols">
        <div className="ts2-main">
          {sheet.status === "sent_back" && sheet.reviewNote && (
            <div className="ts2-back">
              <StateWord tone="wrong">Sent back with a question</StateWord>
              <p className="ts2-back-q">{sheet.reviewNote}</p>
            </div>
          )}

          <div className="ts2-table">
            <div className="ts2-day ts2-day--head" aria-hidden="true">
              <span>Day</span>
              <span />
              <span className="ts2-num">Hours</span>
              <span>Times</span>
              <span>What</span>
            </div>
            {groups.map((g) => (
              <div className="ts2-wk" key={g.start}>
                {multiWeek && (
                  <div className="ts2-wh">
                    <span>{g.label}</span>
                    <span className="ts2-wh-h">{fmtH(g.workedHours)}h</span>
                  </div>
                )}
                {/* the days are the tabs of the open day's card */}
                <div className="ts2-days" role="tablist" aria-label={g.label}>
                  {g.days.map(({ entry, index }) => {
                    const w = week[index];
                    const cls = classes[index];
                    const on = selected === index;
                    const src = sources[index] ?? "entered";
                    const word = dayWord(entry, cls, dowOf(w), settings);
                    const tone = WORD_TONE[cls];
                    /* a rostered day not over yet; once over and still empty it is Missing */
                    const ahead = src === "expected" && !isOver(ctx, index);
                    const times =
                      entry.t === "work"
                        ? `${entry.in} to ${entry.out}`
                        : entry.t === "leave"
                          ? "Annual leave"
                          : entry.t === "sick"
                            ? "Sick leave"
                            : entry.t === "ph"
                              ? (holidayByDate.get(dateOfDay(periodStart, index)) ?? "Public holiday")
                              : ahead
                                ? `${normal.start} to ${normal.end}`
                                : "";
                    return (
                      <button
                        type="button"
                        role="tab"
                        key={index}
                        id={`ts2-day-${index}`}
                        aria-controls="ts2-card"
                        className={`ts2-day ts2-day--${cls}${on ? " ts2-day--on" : ""}${
                          expectsWork(ctx, dowOf(w)) ? "" : " ts2-day--off-roster"
                        }${index === todayAt ? " ts2-day--today" : ""}${ahead ? " ts2-day--ahead" : ""}`}
                        aria-selected={on}
                        aria-label={`${dayLabel(w)} — ${word}`}
                        onClick={() => setSelected(index)}
                      >
                        <span className="ts2-dayname">{shortDay(w)}</span>
                        <span className="ts2-mark">
                          {cls !== "empty" && <DayMark cls={cls} />}
                        </span>
                        <span className="ts2-num">{entry.t === "empty" || entry.t === "off" ? "" : fmtH(entry.h)}</span>
                        <span className={`ts2-times-cell${entry.t === "work" ? "" : " ts2-quiet"}`}>{times}</span>
                        <span className="ts2-what">
                          {ahead ? (
                            <span className="ts2-quiet">
                              {index === todayAt ? "Fills in when the day is over" : "Your normal day, once it’s over"}
                            </span>
                          ) : src === "leave" && (entry.t === "leave" || entry.t === "sick") ? (
                            <span className="ts2-word ts2-word--good">Approved</span>
                          ) : (
                            <span className={`ts2-word${tone ? ` ts2-word--${tone}` : ""}`}>{word}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <section className="ts2-sum" aria-label="What the week comes to">
            <div className="ts2-big">
              <span className="ts2-big-l">
                {period.live ? `This ${noun} so far, for payroll` : `This ${noun}, for payroll`}
              </span>
              <b className="ts2-big-v">{fmtH(d.weighted)}h</b>
            </div>
            <dl className="ts2-figs">
              <div className="ts2-figs-worked">
                <dt>Worked</dt>
                <dd>{fmtH(d.worked)}h</dd>
              </div>
              {figures.map(([label, h]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{fmtH(h)}h</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* the key: every colour the week draws, and nothing else */}
          {legend.length > 0 && (
            <ul className="ts2-key" aria-label="Day colour">
              {legend.map(([k, caption]) => (
                <li key={k} className="ts2-key-item">
                  <DayMark cls={k} />
                  {caption}
                </li>
              ))}
            </ul>
          )}

          <div className="ts2-ref">
            <section className="ts2-group">
              <h2 className="ts2-gh">Pay rules</h2>
              <dl className="ts2-rules">
                {rules.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="ts2-group">
              <h2 className="ts2-gh">Public holidays in {monthLabel}</h2>
              {monthHolidays.length === 0 ? (
                <p className="ts2-note">No public holidays this month</p>
              ) : (
                <ul className="ts2-hols">
                  {monthHolidays.map((h) => (
                    <li key={h.date}>
                      <b>{Number(h.date.slice(8, 10))}</b>
                      <span>{h.name}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <Button kind="quiet" size={32} aria-expanded={allHolidays} onClick={() => setAllHolidays((v) => !v)}>
                  {`All ${state ?? ""} public holidays`.replace(/\s+/g, " ")}
                </Button>
              </div>
              {allHolidays && yearHolidays.length > 0 && (
                <ul className="ts2-hols ts2-hols--year" aria-label="Public holidays coming up">
                  {yearHolidays.map((h) => (
                    <li key={h.date}>
                      <b>{fmtAuWeekdayDayMonth(h.date)}</b>
                      <span>{h.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        <aside className="ts2-rail">
          <section className="ts2-card" id="ts2-card" role="tabpanel" aria-labelledby={`ts2-day-${selected}`}>
            {locked || closedAtSend ? (
              <div className="ts2-card-body">
                <div className="ts2-card-head">
                  <div className="ts2-card-title">
                    <h2 className="ts2-card-h">{fullDay(week[selected])}</h2>
                    {holidayByDate.get(dateOfDay(periodStart, selected)) && (
                      <p className="ts2-card-hol">
                        <Icon name="calendar" size={14} />
                        {holidayByDate.get(dateOfDay(periodStart, selected))}
                      </p>
                    )}
                  </div>
                  <span className={`ts2-word${WORD_TONE[selCls] ? ` ts2-word--${WORD_TONE[selCls]}` : ""}`}>
                    {dayWord(selEntry, selCls, dowOf(week[selected]), settings)}
                  </span>
                </div>
                {/* the day as it was, and nothing where there was nothing */}
                {(selEntry.t !== "empty" || frozenSent || (period.live && salariedRest)) && (
                  <div className="ts2-lock">
                    {selEntry.t !== "empty" && (
                      <b>{selEntry.t === "off" ? DAY_WORD.off : `${fmtH(selEntry.h)}h`}</b>
                    )}
                    {(frozenSent || (period.live && salariedRest)) && (
                      <span className="ts2-note">
                        {frozenSent
                          ? `This ${noun} has been sent — it can't be changed here.`
                          : "Salaried — this day pays itself whatever the hours say."}
                      </span>
                    )}
                  </div>
                )}
                {salariedRest && !frozenSent && period.live && !closedAtSend && (
                  <div className="ts2-acts ts2-acts--start">
                    <Button kind="second" disabled={pending} onClick={() => setOtDay(selected)}>
                      This day ran long — record the hours
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <DayCard
                key={`${selected}:${entryKey(selEntry)}`}
                index={selected}
                entry={selEntry}
                source={sources[selected] ?? "entered"}
                ctx={ctx}
                settings={settings}
                normal={normal}
                holidayName={holidayByDate.get(dateOfDay(periodStart, selected))}
                busy={pending}
                onSave={(idx, e) => run(() => saveDay(periodStart, idx, e))}
              />
            )}
          </section>

          {casual && (
            <section className="ts2-group">
              <h2 className="ts2-gh">When you can’t work</h2>
              {liveBlocks.length === 0 ? (
                <p className="ts2-note">Nothing marked. You’re available.</p>
              ) : (
                <ul className="ts2-blocks">
                  {liveBlocks.map((b) => (
                    <li key={b.id}>
                      <span className="ts2-block-t">
                        <b>{blockLabel(b)}</b>
                        {b.note && <span className="ts2-note">{b.note}</span>}
                      </span>
                      <Button
                        kind="quiet"
                        size={32}
                        aria-label={`Remove ${blockLabel(b)}`}
                        disabled={pending}
                        onClick={() => run(() => clearUnavailable(b.id))}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <Button kind="second" size={32} disabled={pending} onClick={() => setDialog("unavailable")}>
                  Mark days you can’t work
                </Button>
              </div>
            </section>
          )}
        </aside>
      </div>

      {dialog === "normal" && (
        <NormalWeekDialog
          normal={normal}
          workDays={workDays}
          mine={mineNormal}
          busy={pending}
          onSave={(s, e, days) => run(() => saveMyHours(s, e, days))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "unavailable" && (
        <UnavailableDialog
          todayISO={todayISO}
          busy={pending}
          onMark={(f, t, n) => run(() => markUnavailable(f, t, n))}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
