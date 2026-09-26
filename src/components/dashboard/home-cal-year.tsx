"use client";

import type { CalItem } from "@/lib/calendar/items";
import type { YearCell, YearMonth } from "@/lib/calendar/model";
import type { Pick } from "./home-cal-parts";

/* YEAR (his handoff "Calendar"): the twelve months from this one, as many
   to a row as the width takes — three at 1180, four at 1440. A day with
   something on is a button that picks it (`yearMonths`, lib/calendar/model,
   decides which: its public holiday, then an event or an admin date, then
   a shutdown, then school holidays), filled for a holiday, a shutdown or
   the school holidays' hatch, and dotted for an event or an admin date —
   red once late. Its tooltip, and its name, list everything on the day. */

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export function CalYear({
  months,
  selected,
  onPick,
}: {
  months: YearMonth<CalItem>[];
  selected: string | null;
  onPick: Pick;
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
              <Cell key={c.day} cell={c} selected={selected} onPick={onPick} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Cell({ cell: c, selected, onPick }: { cell: YearCell<CalItem>; selected: string | null; onPick: Pick }) {
  const marks = {
    "data-fill": c.fill ?? undefined,
    "data-past": c.past ? "" : undefined,
    /* A day gone by reads quiet, weekend or not. */
    "data-weekend": c.weekend && !c.past ? "" : undefined,
    "data-today": c.today ? "" : undefined,
  };
  const top = c.top;
  if (!top) {
    return (
      <span className="hd-cal-yc" {...marks}>
        {c.date}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="hd-cal-yc"
      {...marks}
      aria-pressed={c.ring !== null && c.ring === selected}
      aria-label={c.tip ?? undefined}
      title={c.tip ?? undefined}
      onClick={(e) => onPick(top.id, e.detail > 0)}
    >
      {c.date}
      {c.dot && <i data-dot={c.dot} aria-hidden="true" />}
    </button>
  );
}
