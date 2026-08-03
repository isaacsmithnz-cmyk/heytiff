"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuDayMonth } from "@/lib/au-dates";
import { isWeekendISO, mondayOf } from "@/lib/workboard/board-status";
import { plusDays } from "@/lib/workboard/dates";
import { calendarToneForCal, placedDayOfCal, toneOfCal, type CalVisit } from "./derive";

/* Calendar — a ROLLING FOUR WEEKS, read from the same status law as every
   other tab. A cell's colour derives from the visits SITTING on that day
   (placement first, linked diary second), so it can never disagree with the
   rows (K2's cure applied to the window).

   Four weeks from the Monday you are in, not a calendar month: a month view
   spends its first and last rows on days that have already gone or belong to
   next month, so the week you actually care about sits mid-grid and the run
   ahead runs off the bottom. Rolling forward keeps "now" in the top row and
   always shows the same amount of future. The arrows step a week at a time.

   ONE SIDE'S WORK ONLY. Decision P3 originally added a merged "Everything"
   view folding the other board's days in; it came out 2026-08-02 because
   service and installation are run by different crews, and the only thing
   telling the two apart on a busy day was a hollow ring at 11px — too
   subtle to trust for the clash-check that was its whole justification.
   Better absent than half-legible. If a shared-resource view is wanted
   later it needs to say WHOSE at a glance: two rows of dots, or a count per
   side. */

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Four weeks — the run you can actually plan for. */
const WINDOW_DAYS = 28;

/** "Aug" — marks where a month turns inside a window that ignores months. */
function monthWord(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-AU", {
    month: "short",
    timeZone: "UTC",
  });
}

export function CalendarTab({
  visits,
  today,
  onDay,
}: {
  /** This board's visits, already in the calendar shape. */
  visits: CalVisit[];
  today: string;
  onDay: (dayISO: string) => void;
}) {
  /** Weeks away from the Monday of the current week. 0 is "now". */
  const [weekShift, setWeekShift] = useState(0);

  const { cells, rangeLabel, services, toConfirm } = useMemo(() => {
    const byDay = new Map<string, CalVisit[]>();
    for (const v of visits) {
      const day = placedDayOfCal(v);
      if (!day) continue;
      const list = byDay.get(day) ?? [];
      list.push(v);
      byDay.set(day, list);
    }

    const first = plusDays(mondayOf(today), weekShift * 7);
    const out = [];
    for (let i = 0; i < WINDOW_DAYS; i += 1) {
      const iso = plusDays(first, i);
      out.push({ iso, dayVisits: byDay.get(iso) ?? [] });
    }
    const inWindow = out.flatMap((c) => c.dayVisits);
    return {
      cells: out,
      rangeLabel: `${fmtAuDayMonth(first)} – ${fmtAuDayMonth(plusDays(first, WINDOW_DAYS - 1))}`,
      services: inWindow.length,
      // what the window is still waiting on — the number you'd act on
      toConfirm: inWindow.filter((v) => {
        const t = toneOfCal(v, today);
        return t === "soon" || t === "flash" || t === "over";
      }).length,
    };
  }, [visits, today, weekShift]);

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
          {/* The arrows belong TO the label — a control that changes a value
              sits with the value, not across the room from it. */}
          <div className="wb2-mchead">
            <button
              className="wb2-mcarrow"
              aria-label="A week earlier"
              onClick={() => setWeekShift((w) => w - 1)}
            >
              <Icon name="chevL" size={15} />
            </button>
            <b>{rangeLabel}</b>
            <button
              className="wb2-mcarrow"
              aria-label="A week later"
              onClick={() => setWeekShift((w) => w + 1)}
            >
              <Icon name="chevR" size={15} />
            </button>
            {weekShift !== 0 && (
              <button className="wb2-mcnow" onClick={() => setWeekShift(0)}>
                Today
              </button>
            )}
          </div>
          <em>Colour says how ready each day is. Green is the goal, red is the queue.</em>
        </div>
        {/* The status slot, same as every other tab's — and it says what it
            counted. A bare "2 services" sat mid-header naming neither the
            window it counted nor the fact that these are the ones with a day
            on them; the calendar only ever draws placed work. */}
        <span className="wb2-mcsum">
          <span className="wb2-chip">
            {services} {services === 1 ? "service" : "services"} booked in
          </span>
          {toConfirm > 0 && <span className="wb2-chip warn">{toConfirm} to confirm</span>}
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
          const tone = calendarToneForCal(c.dayVisits, c.iso, today);
          /* A past day whose work all closed says so with a tick instead of
             dots: it's settled, and dots invite a second read of a day you
             can do nothing about. A past day still holding open work keeps
             its dots — that's exactly the day you need to see. */
          const settled =
            c.iso < today && c.dayVisits.length > 0 && c.dayVisits.every((v) => v.status === "done");
          return (
            <button
              key={c.iso}
              type="button"
              className={
                "wb2-mcc" +
                (c.iso < today ? " past" : "") +
                (isWeekendISO(c.iso) ? " we" : "") +
                (c.iso.slice(8, 10) === "01" ? " mstart" : "") +
                (c.iso === today ? " today" : "")
              }
              data-tone={tone}
              aria-label={`Open ${c.iso}`}
              onClick={() => onDay(c.iso)}
            >
              {/* Month on EVERY date, not just the 1st. A rolling window
                  crosses months mid-row, and "3" alone doesn't say whether
                  you're looking at this month or next. */}
              <span className="wb2-mcn">
                <b>{parseInt(c.iso.slice(8, 10), 10)}</b>
                <em>{monthWord(c.iso)}</em>
                {c.iso === today && <i>Today</i>}
              </span>
              {settled ? (
                <span className="wb2-mcdone" aria-label="All closed">
                  <span>
                    <Icon name="check" size={13} />
                  </span>
                </span>
              ) : (
                c.dayVisits.length > 0 && (
                  /* Each dot carries the job's name and service as hidden
                     children. Display mode unhides them (the cell is ~190px
                     tall there, and four dots in a card-sized box says far
                     less than four names) — one markup, two densities, so the
                     two readings of a day can never disagree. */
                  <span className="wb2-mcdots">
                    {c.dayVisits.slice(0, 4).map((v) => (
                      <i key={v.id} data-tone={toneOfCal(v, today)} title={`${v.name} — ${v.label}`}>
                        <b>{v.name}</b>
                        <em>{v.label}</em>
                      </i>
                    ))}
                    {c.dayVisits.length > 4 && <b>+{c.dayVisits.length - 4}</b>}
                  </span>
                )
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
