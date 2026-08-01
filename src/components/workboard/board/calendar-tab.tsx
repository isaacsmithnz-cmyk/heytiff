"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { addMonthsClamped } from "@/lib/workboard/visit-schedule";
import { isWeekendISO, mondayOf } from "@/lib/workboard/board-status";
import { plusDays } from "@/lib/workboard/dates";
import type { BoardVisit } from "@/lib/workboard/board-query";
import { calendarToneFor, placedDayOf, toneOf } from "./derive";

/* Calendar — the month, read from the same status law as every other tab.
   A cell's colour derives from the visits SITTING on that day (placement
   first, linked diary second), so it can never disagree with the rows
   (K2's cure applied to the month). First cut this step: the grid and its
   legend; the live day modal and place-on-this-day arrive with step 3. */

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarTab({
  visits,
  today,
  onDay,
}: {
  visits: BoardVisit[];
  today: string;
  onDay: (dayISO: string) => void;
}) {
  const [monthStart, setMonthStart] = useState(() => `${today.slice(0, 7)}-01`);

  const { cells, monthLabel } = useMemo(() => {
    const byDay = new Map<string, BoardVisit[]>();
    for (const v of visits) {
      const day = placedDayOf(v);
      if (!day) continue;
      const list = byDay.get(day) ?? [];
      list.push(v);
      byDay.set(day, list);
    }

    const first = mondayOf(monthStart);
    const out: { iso: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i += 1) {
      const iso = plusDays(first, i);
      out.push({ iso, inMonth: iso.slice(0, 7) === monthStart.slice(0, 7) });
    }
    const label = new Date(`${monthStart}T12:00:00Z`).toLocaleDateString("en-AU", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return { cells: out.map((c) => ({ ...c, dayVisits: byDay.get(c.iso) ?? [] })), monthLabel: label };
  }, [visits, monthStart]);

  const unplaced = useMemo(
    () =>
      visits.filter(
        (v) =>
          (v.status === "upcoming" || v.status === "booked") &&
          !placedDayOf(v) &&
          v.dueDate < today
      ),
    [visits, today]
  );

  return (
    <>
      <div className="wb2-chd">
        <span className="wb2-ci blue">
          <Icon name="calendar" size={19} />
        </span>
        <div>
          <b>{monthLabel}</b>
          <em>Colour says how ready each day is. Green is the goal, red is the queue.</em>
        </div>
        <span className="wb2-mcnav">
          <button
            className="pbtn ghost"
            aria-label="Previous month"
            onClick={() => setMonthStart((m) => addMonthsClamped(m, -1))}
          >
            <Icon name="chevL" size={15} />
          </button>
          <button
            className="pbtn ghost"
            aria-label="Next month"
            onClick={() => setMonthStart((m) => addMonthsClamped(m, 1))}
          >
            <Icon name="chevR" size={15} />
          </button>
        </span>
      </div>

      <div className="wb2-mckey">
        <span>
          <i style={{ background: "var(--ok)" }} /> Ready to run
        </span>
        <span>
          <i style={{ background: "var(--warn, #FF8A00)", opacity: 0.85 }} /> Gaps, 8–14 days out
        </span>
        <span>
          <i style={{ background: "#e0264f" }} /> Overdue or landing unconfirmed
        </span>
        <span>
          <i style={{ background: "rgba(5,5,5,.25)" }} /> Done and closed
        </span>
      </div>

      <div className="wb2-mcdow" aria-hidden="true">
        {DOW.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="wb2-mc">
        {cells.map((c) => {
          const tone = calendarToneFor(c.dayVisits, c.iso, today);
          return (
            <button
              key={c.iso}
              type="button"
              className={
                "wb2-mcc" +
                (c.inMonth ? "" : " out") +
                (isWeekendISO(c.iso) ? " we" : "") +
                (c.iso === today ? " today" : "")
              }
              data-tone={tone}
              aria-label={`Open ${c.iso}`}
              onClick={() => onDay(c.iso)}
            >
              <span className="wb2-mcn">
                {parseInt(c.iso.slice(8, 10), 10)}
                {c.iso === today && <em>Today</em>}
              </span>
              {c.dayVisits.length > 0 && (
                <span className="wb2-mcdots">
                  {c.dayVisits.slice(0, 4).map((v) => (
                    <i key={v.id} data-tone={toneOf(v, today)} title={`${v.clientName} — ${v.label}`} />
                  ))}
                  {c.dayVisits.length > 4 && <b>+{c.dayVisits.length - 4}</b>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {unplaced.length > 0 && (
        <p className="wb2-mcloose">
          {`${unplaced.length} overdue ${
            unplaced.length === 1 ? "service isn't" : "services aren't"
          } on a day yet — giving one a day books it in, it doesn't make it on time. Open a day to place them.`}
        </p>
      )}
    </>
  );
}
