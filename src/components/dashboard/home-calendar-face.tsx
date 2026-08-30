"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { HomeCalendar } from "./home-calendar";
import { LeaveRows } from "./home-leave-list";
import { calWindow, windowSummary, type CalView, type LeaveCalendar } from "@/lib/dashboard/calendar";

/* THE CALENDAR FACE — one window, three ways of reading it.

   The card carried a seven-column grid, then a four-week list, and the honest
   answer is that both are right for different questions (Isaac, 2026-08-30):
   a list reads "who is off, from here on" and a grid reads "what does this
   fortnight look like". So the view is a choice, and the WINDOW — which days
   are on show, and how an arrow moves them — belongs up here where all three
   share it. A stepper inside the grid would be a second set of arrows able to
   disagree with the list's.

   The step follows the view's own unit: a week for the two lists and the
   grid, a month for the month. An arrow that walked seven days on a view
   titled "September" would be lying about what it does.

   Both ends are clamped to the days actually loaded (a week back, eight weeks
   ahead — `calendarSpan`), so an arrow is disabled rather than paging onto an
   empty month. */

const VIEWS: { key: CalView; label: string; hint: string }[] = [
  { key: "weeks", label: "4 weeks", hint: "Four weeks from today, as a list" },
  { key: "month", label: "Month", hint: "This calendar month, as a list" },
  { key: "grid", label: "Grid", hint: "Four weeks as a grid" },
];

export function HomeCalendarFace({ cal, today }: { cal: LeaveCalendar; today: string }) {
  const [view, setView] = useState<CalView>("weeks");
  const [shift, setShift] = useState(0);

  const win = calWindow(cal, today, view, shift);
  const sum = windowSummary(win.days);

  /* Changing the view keeps you where you are in time only when the step
     means the same thing on both sides; weeks → month would land you an
     arbitrary distance away, so the window goes back to now instead. */
  const go = (next: CalView) => {
    if (next === view) return;
    const sameUnit = next !== "month" && view !== "month";
    setView(next);
    if (!sameUnit) setShift(0);
  };

  return (
    <div className="hm-cal">
      <div className="hm-calhead">
        <div className="hm-calstep">
          <button
            className="wb2-mcarrow"
            aria-label={view === "month" ? "The month before" : "A week earlier"}
            disabled={!win.canBack}
            onClick={() => setShift((v) => v - 1)}
          >
            <Icon name="chevL" size={15} />
          </button>
          <b>{win.label}</b>
          <button
            className="wb2-mcarrow"
            aria-label={view === "month" ? "The month after" : "A week later"}
            disabled={!win.canForward}
            onClick={() => setShift((v) => v + 1)}
          >
            <Icon name="chevR" size={15} />
          </button>
          {shift !== 0 && (
            <button className="wb2-mcnow" onClick={() => setShift(0)}>
              Today
            </button>
          )}
        </div>

        <div className="hm-calseg" role="group" aria-label="How to show the calendar">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className={"hm-calsegb" + (view === v.key ? " on" : "")}
              aria-pressed={view === v.key}
              title={v.hint}
              onClick={() => go(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* What the WINDOW holds, never the whole loaded span — the counts have
          to describe the days you can actually see. Public holidays are one of
          the three: they are the only thing on this face that is not a person. */}
      {(sum.yoursOff > 0 || sum.othersOff > 0 || sum.holidays > 0) && (
        <div className="hm-calsum">
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
        </div>
      )}

      {win.days.length === 0 ? (
        <p className="hm-none">No dates to show yet.</p>
      ) : view === "grid" ? (
        <HomeCalendar days={win.days} today={today} />
      ) : (
        <LeaveRows days={win.days} today={today} />
      )}
    </div>
  );
}
