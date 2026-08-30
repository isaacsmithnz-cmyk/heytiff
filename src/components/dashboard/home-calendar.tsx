"use client";

import { isWeekendISO } from "@/lib/workboard/board-status";
import { type CalendarDay } from "@/lib/dashboard/calendar";

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

export function HomeCalendar({ days, today }: { days: readonly CalendarDay[]; today: string }) {
  /* PRESENTATIONAL NOW. The stepper, the range label and the summary chips
     moved up to the Calendar face, because they belong to the WINDOW rather
     than to the grid — the list views step through the same weeks and must
     not grow a second set of arrows that disagree with these ones.

     What is left is the part only a grid does: seven columns, and a cell that
     knows which day it is. */
  return (
    <>
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
