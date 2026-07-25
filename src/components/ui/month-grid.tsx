"use client";

import { Icon } from "@/components/shell/icon";

/* The calendar core — one month, drawn.

   Deliberately stateless: the caller owns which month is showing, what's
   selected and what's out of bounds. That's what lets the same grid serve a
   single-date popover (date-field.tsx) and, later, a two-ended range without
   either of them fighting an internal month cursor.

   Every date crossing this boundary is an ISO yyyy-mm-dd calendar date, in and
   out — the same protocol the rest of the app uses (lib/au-dates.ts). Nothing
   here constructs a local-time Date: every cell is derived by UTC millisecond
   arithmetic off the 1st, so a DST changeover can't shift a row by a day.

   Monday-first. That's the calendar convention here, not the JS `getDay()`
   order, so the lead-in offset is rotated by 6 rather than taken raw. */

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/* Month and weekday names are spelled out rather than taken from Intl. These
   strings are the picker's accessible names — the thing tests and screen
   readers both read — and ICU's en-AU output moves between Node builds (a
   comma after the weekday, "Sept" vs "September"). A fixed table can't drift.
   Display dates elsewhere still go through lib/au-dates.ts. */
const WEEKDAY_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAY_MS = 86_400_000;

/** The yyyy-mm an ISO date falls in. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** yyyy-mm ± n months. */
export function shiftMonth(month: string, delta: number): string {
  const i = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  return `${String(Math.floor(i / 12)).padStart(4, "0")}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** "September 2026" — the grid's header. */
export function monthTitle(month: string): string {
  return `${MONTH_LONG[Number(month.slice(5, 7)) - 1]} ${Number(month.slice(0, 4))}`;
}

/** "Friday 25 September 2026" — a day cell's accessible name. */
export function dayTitle(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAY_LONG[(dow + 6) % 7]} ${d} ${MONTH_LONG[m - 1]} ${y}`;
}

export type MonthCell = {
  iso: string;
  day: number;
  /** belongs to the month either side — shown, muted, still pickable */
  out: boolean;
  weekend: boolean;
};

/* Always 42 cells (6 rows), never a ragged 35/42 mix: a grid that changes
   height as you page through months makes the popover jump under the cursor. */
export function monthCells(month: string): MonthCell[] {
  const first = Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  const lead = (new Date(first).getUTCDay() + 6) % 7; // Monday-first
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(first + (i - lead) * DAY_MS);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    cells.push({
      iso,
      day: d.getUTCDate(),
      out: iso.slice(0, 7) !== month,
      weekend: dow === 0 || dow === 6,
    });
  }
  return cells;
}

export function MonthGrid({
  month,
  today,
  value,
  range,
  holidays,
  min,
  max,
  onPick,
  onMonthChange,
}: {
  /** yyyy-mm — the month on screen. Controlled. */
  month: string;
  /** AU calendar date, from the server (lib/au-dates.ts) — never `new Date()`. */
  today: string;
  value?: string | null;
  range?: { start: string; end: string } | null;
  /** ISO date -> holiday name; tints the cell violet and names it */
  holidays?: Map<string, string>;
  min?: string;
  max?: string;
  onPick?: (iso: string) => void;
  onMonthChange: (month: string) => void;
}) {
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  return (
    <div className="cal">
      <div className="cal-head">
        <button
          type="button"
          className="cal-arw"
          aria-label="Previous month"
          disabled={!!min && prev < monthOf(min)}
          onClick={() => onMonthChange(prev)}
        >
          <Icon name="chevL" size={15} />
        </button>
        <div className="cal-mo" aria-live="polite">
          {monthTitle(month)}
        </div>
        <button
          type="button"
          className="cal-arw"
          aria-label="Next month"
          disabled={!!max && next > monthOf(max)}
          onClick={() => onMonthChange(next)}
        >
          <Icon name="chevR" size={15} />
        </button>
      </div>

      <div className="cal-wd" aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="cal-grid">
        {monthCells(month).map((c) => {
          const holiday = holidays?.get(c.iso);
          const inRange = !!range && c.iso >= range.start && c.iso <= range.end;
          const cls = [
            "cal-d",
            c.out && "out",
            c.weekend && "wknd",
            inRange && "rng",
            inRange && c.iso === range.start && "rng-s",
            inRange && c.iso === range.end && "rng-e",
            /* A holiday keeps its violet inside a range — that band is "days
               you're taking", and a public holiday isn't one of them. Reading
               it off the grid beats counting the total twice. */
            holiday && "hol",
            value === c.iso && "on",
            today === c.iso && "today",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={c.iso}
              type="button"
              className={cls}
              data-iso={c.iso}
              disabled={(!!min && c.iso < min) || (!!max && c.iso > max)}
              aria-label={holiday ? `${dayTitle(c.iso)}, ${holiday}` : dayTitle(c.iso)}
              aria-pressed={value === c.iso}
              aria-current={today === c.iso ? "date" : undefined}
              title={holiday || undefined}
              onClick={() => onPick?.(c.iso)}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
