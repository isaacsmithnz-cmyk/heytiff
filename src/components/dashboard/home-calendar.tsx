"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuDayMonth } from "@/lib/au-dates";
import { isWeekendISO } from "@/lib/workboard/board-status";
import {
  shiftBounds,
  windowFrom,
  windowSummary,
  type CalendarDay,
  type LeaveCalendar,
} from "@/lib/dashboard/calendar";

/* THE CALENDAR TAB — your leave, who else is off, and the days we're closed.

   The grid, the stepper, the day cell and the weekday rail are the maintenance
   board's (`.wb2-mc*`), reused whole, the same way every other face of this
   card reuses the board's rows. A rolling four weeks from the Monday you are
   in, for the reason calendar-tab.tsx gives: a calendar month spends its first
   and last rows on days that have gone or belong to next month.

   WHAT DOES NOT COME ACROSS IS `data-tone`. On the board a day's colour says
   how ready it is — green is the goal, red is the queue. Leave has no such
   axis, and this app's rule is that ok/warn/danger only ever mean state. So
   the only tinted cell here is a closed office, in the info blue the old
   public-holiday line already wore. See lib/dashboard/calendar for the rest of
   that argument.

   THE BAND IS THE POINT. A run of leave is one decision a person made, so it
   draws as one line across the row: squared where it carries on into the next
   day, rounded only at its true ends, and re-labelled at the top of each week
   so a run crossing Sunday still says what it is. It sits at the BOTTOM of
   every cell it touches — anchored, not stacked after whatever else the day
   happens to hold, or the line would step up and down across the week.

   Client, for `weekShift` alone. Every day arrives already shaped. */

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function HomeCalendar({ cal, today }: { cal: LeaveCalendar; today: string }) {
  const [weekShift, setWeekShift] = useState(0);
  const bounds = useMemo(() => shiftBounds(cal, today), [cal, today]);
  const days = useMemo(() => windowFrom(cal, today, weekShift), [cal, today, weekShift]);
  const sum = useMemo(() => windowSummary(days), [days]);

  /* An org with no leave and no holidays loaded still gets a grid — the empty
     four weeks ARE the answer to "is anyone off". What it cannot do is render
     a header counting a window that has no days in it. */
  if (days.length === 0) {
    return <p className="hm-none">No dates to show yet.</p>;
  }

  const rangeLabel = `${fmtAuDayMonth(days[0].iso)} – ${fmtAuDayMonth(days[days.length - 1].iso)}`;

  return (
    <>
      <div className="wb2-chd">
        <span className="wb2-ci blue">
          <Icon name="calendar" size={19} />
        </span>
        <div>
          {/* The arrows belong TO the label, as they do on the board. */}
          <div className="wb2-mchead">
            <button
              className="wb2-mcarrow"
              aria-label="A week earlier"
              disabled={weekShift <= bounds.min}
              onClick={() => setWeekShift((w) => Math.max(bounds.min, w - 1))}
            >
              <Icon name="chevL" size={15} />
            </button>
            <b>{rangeLabel}</b>
            <button
              className="wb2-mcarrow"
              aria-label="A week later"
              disabled={weekShift >= bounds.max}
              onClick={() => setWeekShift((w) => Math.min(bounds.max, w + 1))}
            >
              <Icon name="chevR" size={15} />
            </button>
            {weekShift !== 0 && (
              <button className="wb2-mcnow" onClick={() => setWeekShift(0)}>
                Today
              </button>
            )}
          </div>
          <em>Your leave, who else is off, and the days the office is closed.</em>
        </div>
        {/* What the window counted, never the whole loaded span. */}
        <span className="wb2-mcsum">
          {sum.yoursOff > 0 && (
            <span className="wb2-chip">
              You&rsquo;re off {sum.yoursOff} {sum.yoursOff === 1 ? "day" : "days"}
            </span>
          )}
          {sum.othersOff > 0 && (
            <span className="wb2-chip">
              {sum.othersOff} {sum.othersOff === 1 ? "person" : "people"} off
            </span>
          )}
          {sum.holidays > 0 && (
            <span className="wb2-chip">
              {sum.holidays} public {sum.holidays === 1 ? "holiday" : "holidays"}
            </span>
          )}
        </span>
      </div>

      <div className="wb2-mcdow" aria-hidden="true">
        {DOW.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="wb2-mc">
        {days.map((d) => (
          <Day key={d.iso} day={d} today={today} />
        ))}
      </div>
    </>
  );
}

/* A day is a `div`, not the board's `button`: there is nothing to open. The
   board's cell opens the day's visits; leave is read here and booked on the
   leave screen, and a control that does nothing when pressed is worse than a
   plain cell. */
function Day({ day, today }: { day: CalendarDay; today: string }) {
  const dow = new Date(`${day.iso}T12:00:00Z`).getUTCDay();
  const mine = day.mine;

  return (
    <div
      /* The ISO day, so a test can name a cell without counting squares — and
         so a screenshot diff points at a date rather than an index. */
      data-day={day.iso}
      className={
        "wb2-mcc" +
        (day.iso < today ? " past" : "") +
        (isWeekendISO(day.iso) ? " we" : "") +
        (day.iso === today ? " today" : "") +
        (day.holiday ? " hm-calph" : "")
      }
    >
      {/* Month on every date, not just the 1st — a rolling window crosses
          months mid-row, and "3" alone doesn't say which one. */}
      <span className="wb2-mcn">
        <b>{parseInt(day.iso.slice(8, 10), 10)}</b>
        <em>{monthWord(day.iso)}</em>
        {day.iso === today && <i>Today</i>}
      </span>

      {day.holiday && <span className="hm-calphl">{day.holiday} — closed</span>}

      {day.others.length > 0 && (
        <span className="hm-caloffs">
          {day.others.map((o) => (
            /* FIRST NAME ONLY in the pill. A cell is a seventh of the card and
               a full name wrapped to two lines or clipped mid-surname in every
               one of them. The initials disambiguate two Danes, the full name
               and the kind of leave are on the title, and "tell Dane…" is what
               anyone says out loud anyway. */
            <span className="hm-caloff" key={o.staffId} title={`${o.name} — ${o.label}`}>
              <i aria-hidden="true">{o.initials}</i>
              <b>{o.firstName}</b>
            </span>
          ))}
        </span>
      )}

      {mine && (
        <span
          className={
            "hm-calmine" +
            /* Monday re-opens the band because the row broke it; the true
               start and end are what earn a rounded edge. */
            (mine.runStart || dow === 1 ? " s" : "") +
            (mine.runEnd || dow === 0 ? " e" : "")
          }
        >
          {(mine.runStart || dow === 1) && `You — ${mine.label}`}
        </span>
      )}
    </div>
  );
}

/** "Aug" — marks where a month turns inside a window that ignores months. */
function monthWord(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-AU", {
    month: "short",
    timeZone: "UTC",
  });
}
