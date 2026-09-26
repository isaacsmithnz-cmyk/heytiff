"use client";

import type { CalItem } from "@/lib/calendar/items";
import { fmtDay, type YearCell, type YearMonth } from "@/lib/calendar/model";
import type { PickDay } from "./home-cal-parts";

/* YEAR (his handoff "Calendar"): the twelve months from this one, as many
   to a row as the width takes — three at 1180, four at 1440. A day with
   something on is filled for a holiday, a shutdown or the school holidays'
   hatch, and dotted for an event or an admin date — red once late
   (`yearMonths`, lib/calendar/model). Its tooltip, and its name, list
   everything on the day.

   EVERY DAY IS A BUTTON THAT PICKS THE DAY (Isaac, 2026-09-26: "simplify
   it"), empty or not: the panel then shows the day and everything on it,
   each of which picks itself there, and the box over the panel adds to the
   day. A day chosen wears his ring (a named exemption, law 14), and so do
   the days a chosen thing leads, as they did. */

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export function CalYear({
  months,
  selected,
  day,
  onPickDay,
}: {
  months: YearMonth<CalItem>[];
  selected: string | null;
  /** The day chosen, when the choice is a day. */
  day: string | null;
  onPickDay: PickDay;
}) {
  return (
    <div className="hd-cal-yg" data-scroll="">
      {months.map((m) => (
        <section key={m.key} className="hd-cal-ym" aria-labelledby={`hdcal-ym-${m.key}`}>
          <div className="hd-cal-ymh">
            <h3 className="hd-cal-ymt" id={`hdcal-ym-${m.key}`} data-past={m.past ? "" : undefined}>
              {m.title}
            </h3>
            {m.note && <span className="hd-cal-ymn">{m.note}</span>}
          </div>
          <div className="hd-cal-yd">
            {LETTERS.map((l, i) => (
              <span key={`d${i}`} className="hd-cal-ydl" aria-hidden="true">
                {l}
              </span>
            ))}
            {Array.from({ length: m.lead }, (_, i) => (
              <span key={`l${i}`} aria-hidden="true" />
            ))}
            {m.cells.map((c) => (
              <Cell key={c.day} cell={c} selected={selected} day={day} onPickDay={onPickDay} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Cell({
  cell: c,
  selected,
  day,
  onPickDay,
}: {
  cell: YearCell<CalItem>;
  selected: string | null;
  day: string | null;
  onPickDay: PickDay;
}) {
  return (
    <button
      type="button"
      className="hd-cal-yc"
      data-fill={c.fill ?? undefined}
      data-past={c.past ? "" : undefined}
      /* A day gone by reads quiet, weekend or not. */
      data-weekend={c.weekend && !c.past ? "" : undefined}
      data-today={c.today ? "" : undefined}
      aria-pressed={c.day === day || (c.ring !== null && c.ring === selected)}
      aria-label={c.tip ?? fmtDay(c.day)}
      aria-current={c.today ? "date" : undefined}
      title={c.tip ?? undefined}
      onClick={(e) => onPickDay(c.day, e.detail > 0)}
    >
      {c.date}
      {c.dot && <i data-dot={c.dot} aria-hidden="true" />}
    </button>
  );
}
