"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "./button";

/* A CALENDAR TO PICK DAYS ON (Isaac, 24 October 2026: "I want you to show me
   what happens going through the process of selecting those dates. Ideally,
   a calendar needs to be shown"; his mock, YRqKF87knq2N35tMLa5hkz, sections
   6 and 7).

   Monday first. A day off the person's roster is grey (for Monday to Friday,
   the weekend). Today is ringed thin. A public holiday is struck through
   with a small dot under its date, and the holidays on screen are named on
   one line under the months. The days picked are blue discs with white
   numbers, and the run between them a light fill of the same blue: blue is
   a selection (rule 17), so nothing picked is ever ink.

   Every day is a real button with its own name ("Fri 25 Dec, public
   holiday"), pressed while it is in the span. One day of the months takes
   the Tab key and the arrows move it, so the months are one stop, not sixty.

   It draws a span and reports presses; what a press does to the span is
   `pickDay`, which the form calls, so the steps a person reads above the
   months and the days drawn here can't disagree. Every date in and out is
   an ISO yyyy-mm-dd calendar date, worked out in UTC so no clock change
   moves a day. */

export type DaySpan = { start: string | null; end: string | null };

/* THE PRESSES. A first press picks the first day; a second, on or after it,
   the last; a press after that starts again. A second press before the first
   day makes it the new first day, so a slip never leaves a span backwards. */
export function pickDay(span: DaySpan, iso: string): DaySpan {
  if (!span.start || span.end) return { start: iso, end: null };
  if (iso < span.start) return { start: iso, end: null };
  return { start: span.start, end: iso };
}

/** The last day of the span: its end once there is one, else its first day. */
export const spanEnd = (span: DaySpan): string | null => span.end ?? span.start;

/* Names spelled out, not taken from Intl: they are the days' accessible
   names, and ICU's output moves between Node builds. They match en-AU's
   short forms (lib/au-dates' fmtAuWeekdayDayMonth): June, July and Sept are
   written out, as Australians write them. */
const WD_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WD_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WD_HEAD = ["M", "T", "W", "T", "F", "S", "S"];
const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
const MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Mon=0 … Sun=6, the roster's own convention. */
export const weekdayIndex = (iso: string): number => (new Date(utc(iso)).getUTCDay() + 6) % 7;
export const addDay = (iso: string, n: number): string => isoOf(utc(iso) + n * DAY_MS);

/** "Mon 21 Dec" */
export function dayWords(iso: string): string {
  return `${WD_SHORT[weekdayIndex(iso)]} ${Number(iso.slice(8, 10))} ${MON_SHORT[Number(iso.slice(5, 7)) - 1]}`;
}

/** "Saturday" */
export const weekdayWord = (iso: string): string => WD_LONG[weekdayIndex(iso)]!;

const monthOf = (iso: string) => iso.slice(0, 7);
function shiftMonth(month: string, n: number): string {
  const i = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${String(Math.floor(i / 12)).padStart(4, "0")}-${String((i % 12) + 1).padStart(2, "0")}`;
}
const monthTitle = (month: string) => `${MON_LONG[Number(month.slice(5, 7)) - 1]} ${Number(month.slice(0, 4))}`;

/** The month's days, with the empty cells before the 1st that put it under its weekday. */
function monthDays(month: string): (string | null)[] {
  const first = `${month}-01`;
  const lead = weekdayIndex(first);
  const out: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; monthOf(d) === month; d = addDay(d, 1)) out.push(d);
  return out;
}

/** "Fri 25 Dec Christmas Day, Sat 26 Dec Boxing Day and Fri 1 Jan New Year's Day" */
function holidayList(list: { date: string; name: string }[]): string {
  const words = list.map((h) => `${dayWords(h.date)} ${h.name}`);
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** The first day on screen that can be picked. */
function firstAllowed(from: string, through: string, allowed: (iso: string) => boolean): string | null {
  for (let d = `${from}-01`; monthOf(d) <= through; d = addDay(d, 1)) if (allowed(d)) return d;
  return null;
}

/** The first of the months on screen, kept inside the bounds the days can be picked in. */
function firstMonthFor(at: string, months: number, min?: string, max?: string): string {
  let m = monthOf(at);
  if (max && shiftMonth(m, months - 1) > monthOf(max)) m = shiftMonth(monthOf(max), -(months - 1));
  if (min && m < monthOf(min)) m = monthOf(min);
  return m;
}

export function RangeCalendar({
  today,
  months = 1,
  span,
  onPick,
  min,
  max,
  holidays,
  workDays = [0, 1, 2, 3, 4],
  also,
  label,
}: {
  /** the AU calendar date, from the server, never `new Date()` */
  today: string;
  /** one month, or two side by side */
  months?: 1 | 2;
  span: DaySpan;
  onPick: (iso: string) => void;
  /** the first and last days that can be picked; the rest are faded */
  min?: string;
  max?: string;
  /** ISO date to holiday name */
  holidays?: ReadonlyMap<string, string>;
  /** the days the person works, Mon=0; the rest are grey */
  workDays?: readonly number[];
  /** days off inside the span that were pressed in, drawn picked (Book a
      visit's Saturday in a run of weekdays) */
  also?: readonly string[];
  /** what the months are for, said to a screen reader */
  label: string;
}) {
  const [first, setFirst] = useState(() => firstMonthFor(span.start ?? today, months, min, max));
  const shown = Array.from({ length: months }, (_, i) => shiftMonth(first, i));
  const lastShown = shown[shown.length - 1]!;
  const visible = (iso: string) => monthOf(iso) >= first && monthOf(iso) <= lastShown;
  const allowed = (iso: string) => (!min || iso >= min) && (!max || iso <= max);

  /* the day that takes Tab: the one the keys moved to, else the first day
     picked, else today, else the first that can be picked */
  const [cursor, setCursor] = useState<string | null>(null);
  const tabbable =
    [cursor, span.start, today, firstAllowed(first, lastShown, allowed)].find((d): d is string => !!d && visible(d) && allowed(d)) ?? null;

  /* the day the arrows moved to takes focus once it is drawn, which may be
     in a month that wasn't on screen before the key */
  const grid = useRef<HTMLDivElement>(null);
  const focusTo = useRef<string | null>(null);
  useEffect(() => {
    const iso = focusTo.current;
    if (!iso) return;
    focusTo.current = null;
    grid.current?.querySelector<HTMLButtonElement>(`[data-iso="${iso}"]`)?.focus();
  });

  const last = spanEnd(span);
  const run = !!span.start && !!span.end && span.end > span.start;
  const inSpan = (iso: string) => !!span.start && !!last && iso >= span.start && iso <= last;
  /* where days off are pressed in (`also`), a day off inside the span is in
     it only when it was */
  const counted = (iso: string) =>
    !also || workDays.includes(weekdayIndex(iso)) || iso === span.start || iso === last || also.includes(iso);

  const moveTo = (from: string, n: number) => {
    const to = addDay(from, n);
    if (!allowed(to)) return;
    if (!visible(to)) setFirst(firstMonthFor(to, months, min, max));
    focusTo.current = to;
    setCursor(to);
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, iso: string) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    moveTo(iso, step);
  };

  const onScreenHolidays = [...(holidays ?? new Map<string, string>()).entries()]
    .filter(([d]) => visible(d))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, name]) => ({ date, name }));

  const prevOk = !min || shiftMonth(first, -1) >= monthOf(min);
  const nextOk = !max || shiftMonth(lastShown, 1) <= monthOf(max);

  return (
    <div className="pt-cal" role="group" aria-label={label}>
      <div ref={grid} className={`pt-cal-months${months === 2 ? " pt-cal-months--2" : ""}`}>
        {shown.map((month, i) => (
          <div key={month} className="pt-cal-month" role="group" aria-label={monthTitle(month)}>
            <div className="pt-cal-head">
              <span className="pt-cal-title" aria-hidden="true">
                {monthTitle(month)}
              </span>
              {i === shown.length - 1 && (
                <span className="pt-cal-nav">
                  <IconButton glyph="earlier" label="Earlier month" size={32} disabled={!prevOk} onClick={() => setFirst((m) => shiftMonth(m, -1))} />
                  <IconButton glyph="later" label="Later month" size={32} disabled={!nextOk} onClick={() => setFirst((m) => shiftMonth(m, 1))} />
                </span>
              )}
            </div>
            <div className="pt-cal-grid">
              {WD_HEAD.map((w, k) => (
                <span key={k} className="pt-cal-wd" aria-hidden="true">
                  {w}
                </span>
              ))}
              {monthDays(month).map((iso, k) => {
                if (!iso) return <span key={`e${k}`} className="pt-cal-cell" />;
                const holiday = holidays?.get(iso);
                const picked = iso === span.start || (!!span.end && iso === span.end) || !!also?.includes(iso);
                const cell = [
                  "pt-cal-cell",
                  run && inSpan(iso) && "pt-cal-cell--run",
                  run && iso === span.start && "pt-cal-cell--first",
                  run && iso === span.end && "pt-cal-cell--last",
                ];
                const day = [
                  "pt-cal-day",
                  !workDays.includes(weekdayIndex(iso)) && "pt-cal-day--off",
                  holiday !== undefined && "pt-cal-day--hol",
                  iso === today && "pt-cal-day--today",
                  picked && "pt-cal-day--picked",
                ];
                const name = [dayWords(iso), iso === today && "today", holiday !== undefined && "public holiday"].filter(Boolean).join(", ");
                return (
                  <span key={iso} className={cell.filter(Boolean).join(" ")}>
                    <button
                      type="button"
                      className={day.filter(Boolean).join(" ")}
                      data-iso={iso}
                      aria-label={name}
                      aria-pressed={inSpan(iso) && counted(iso)}
                      disabled={!allowed(iso)}
                      tabIndex={iso === tabbable ? 0 : -1}
                      onClick={() => {
                        setCursor(iso);
                        onPick(iso);
                      }}
                      onKeyDown={(e) => onKey(e, iso)}
                    >
                      <span className="pt-cal-num">{Number(iso.slice(8, 10))}</span>
                      {holiday !== undefined && <span className="pt-cal-mark" aria-hidden="true" />}
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {onScreenHolidays.length > 0 && (
        <p className="pt-cal-hols">
          <b>Public holidays, not counted:</b> {holidayList(onScreenHolidays)}
        </p>
      )}
    </div>
  );
}
