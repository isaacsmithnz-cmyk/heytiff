"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { addMonthsClamped } from "@/lib/workboard/visit-schedule";
import { isWeekendISO, mondayOf } from "@/lib/workboard/board-status";
import { plusDays } from "@/lib/workboard/dates";
import { calendarToneForCal, placedDayOfCal, toneOfCal, type CalVisit } from "./derive";

/* Calendar — the month, read from the same status law as every other tab.
   A cell's colour derives from the visits SITTING on that day (placement
   first, linked diary second), so it can never disagree with the rows
   (K2's cure applied to the month).

   Calendars stay PER-SIDE with a merged view on tap (decision P3, Isaac's
   words: "per side, but maybe add a 3rd view that is merged"): the toggle
   folds the OTHER board's day-load in, its dots wearing a hollow ring so
   whose work it is stays legible. Opening a day always opens THIS side's
   day modal — placing happens on the board that owns the work. */

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarTab({
  side,
  visits,
  others,
  sideWord,
  otherWord,
  today,
  onDay,
}: {
  /** Which board owns this calendar — the other side's dots wear the ring. */
  side: "maintenance" | "projects";
  /** This board's visits, already in the calendar shape. */
  visits: CalVisit[];
  /** The other board's visits — rendered only in the merged view. */
  others: CalVisit[];
  /** "Maintenance" / "Projects" — the toggle's words. */
  sideWord: string;
  otherWord: string;
  today: string;
  onDay: (dayISO: string) => void;
}) {
  const [monthStart, setMonthStart] = useState(() => `${today.slice(0, 7)}-01`);
  const [merged, setMerged] = useState(false);

  const { cells, monthLabel } = useMemo(() => {
    const byDay = new Map<string, CalVisit[]>();
    const all = merged ? [...visits, ...others] : visits;
    for (const v of all) {
      const day = placedDayOfCal(v);
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
  }, [visits, others, merged, monthStart]);

  const unplaced = useMemo(
    () =>
      visits.filter(
        (v) =>
          (v.status === "upcoming" || v.status === "booked") &&
          !placedDayOfCal(v) &&
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
        <div className="wb2-filters" role="group" aria-label="Calendar scope">
          <button
            type="button"
            className={"wb2-filter" + (!merged ? " on" : "")}
            aria-pressed={!merged}
            onClick={() => setMerged(false)}
          >
            {sideWord}
          </button>
          <button
            type="button"
            className={"wb2-filter" + (merged ? " on" : "")}
            aria-pressed={merged}
            onClick={() => setMerged(true)}
          >
            Everything
          </button>
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
        {merged && (
          <span>
            <i className="wb2-mckey-oth" /> From the {otherWord} board
          </span>
        )}
      </div>

      <div className="wb2-mcdow" aria-hidden="true">
        {DOW.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="wb2-mc">
        {cells.map((c) => {
          const tone = calendarToneForCal(c.dayVisits, c.iso, today);
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
                    <i
                      key={v.id}
                      data-tone={toneOfCal(v, today)}
                      data-oth={v.side !== side ? "" : undefined}
                      title={`${v.name} — ${v.label}`}
                    />
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
            unplaced.length === 1 ? "job isn't" : "jobs aren't"
          } on a day yet — giving one a day books it in, it doesn't make it on time. Open a day to place them.`}
        </p>
      )}
    </>
  );
}
