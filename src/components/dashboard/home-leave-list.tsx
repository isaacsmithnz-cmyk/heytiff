"use client";

import { Icon } from "@/components/shell/icon";
import { isWeekendISO } from "@/lib/workboard/board-status";
import { type CalendarDay } from "@/lib/dashboard/calendar";

/* THE CALENDAR'S ROWS — a day at a time, read downward.

   It was a seven-column grid with a stepper: the maintenance board's cells,
   reused whole, four weeks at a time. A grid is the right shape for comparing
   weeks and the wrong one for the question this tab actually answers, which is
   "who is off, from here on" — that reads as a sequence, not a fortnight of
   squares, and a sequence wants a list (Isaac, 2026-08-30).

   So: one day after the next, starting today, in the order they arrive. No
   stepper, because a list scrolls; no part-rows, because nothing is a row of
   seven any more; and the days that have gone are simply not in it.

   THE EMPTY WEEKS ARE THE ANSWER. A month of dates with nothing beside them
   says "nobody is off" more plainly than a sentence would, so the rows always
   draw — what varies is whether anything sits on the right of them.

   WHAT MAY NOT HAPPEN HERE is a state colour. Green, amber and red mean
   ok/warn/danger everywhere in this app, and leave is not a readiness problem.
   A closed office takes the info blue the public-holiday line already wore,
   your own leave takes the teal that means "yours" on this card, and a
   colleague's takes a neutral pill. Nothing else is tinted. */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Read the parts off the ISO string rather than a Date. `new Date("2026-09-01")`
    is UTC midnight, which in Australia is the afternoon of the day before — the
    weekday would be wrong for the whole country. */
function parts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  /* Zeller-free: Date.UTC is safe because we only ask it for the day of the
     week, which no timezone can shift once the date itself is fixed. */
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, dow };
}

function Row({ day, today }: { day: CalendarDay; today: string }) {
  const { m, d, dow } = parts(day.iso);
  const isToday = day.iso === today;
  const weekend = isWeekendISO(day.iso);
  /* A month label on the first of the month, so a list crossing into October
     says so once instead of on every row or nowhere at all. */
  const showMonth = d === 1 || isToday;

  return (
    <div
      className={"hm-lvr" + (isToday ? " today" : "") + (weekend ? " wknd" : "")}
      data-iso={day.iso}
    >
      <span className="hm-lvd">
        <b>{DOW[dow]}</b>
        <em>{d}</em>
        {showMonth && <u>{MONTH[m - 1]}</u>}
      </span>

      <span className="hm-lvw">
        {day.holiday && (
          <span className="hm-lvp closed">
            <Icon name="calendar" size={12} />
            {day.holiday}
          </span>
        )}
        {day.mine && (
          <span className="hm-lvp mine">
            {/* "You" and not your name: this is your own card. */}
            You&nbsp;&middot;&nbsp;{day.mine.label}
          </span>
        )}
        {day.others.map((o) => (
          <span className="hm-lvp" key={o.staffId} title={`${o.name} — ${o.label}`}>
            {o.firstName}
          </span>
        ))}
      </span>
    </div>
  );
}

export function LeaveRows({ days, today }: { days: readonly CalendarDay[]; today: string }) {
  /* Rows only. Which days these ARE — four weeks from here, a calendar month,
     wherever the arrows have walked to — is the face's question, and it asks
     it once for the grid and the list both (see ./home-calendar-face). */
  return (
    <div className="hm-lv">
      {days.map((day) => (
        <Row day={day} today={today} key={day.iso} />
      ))}
    </div>
  );
}
