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

   Calendars stay PER-SIDE with a merged view on tap (decision P3, Isaac's
   words: "per side, but maybe add a 3rd view that is merged"): the toggle
   folds the OTHER board's day-load in, its dots wearing a hollow ring so
   whose work it is stays legible. Opening a day always opens THIS side's
   day modal — placing happens on the board that owns the work. */

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
  /** Weeks away from the Monday of the current week. 0 is "now". */
  const [weekShift, setWeekShift] = useState(0);
  const [merged, setMerged] = useState(false);

  const { cells, rangeLabel, services, toConfirm } = useMemo(() => {
    const byDay = new Map<string, CalVisit[]>();
    const all = merged ? [...visits, ...others] : visits;
    for (const v of all) {
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
  }, [visits, others, merged, today, weekShift]);

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
          <b>{rangeLabel}</b>
          <em>Colour says how ready each day is. Green is the goal, red is the queue.</em>
        </div>
        <span className="wb2-mcsum">
          <span className="wb2-chip">
            {services} {services === 1 ? "service" : "services"}
          </span>
          {toConfirm > 0 && <span className="wb2-chip warn">{toConfirm} to confirm</span>}
        </span>
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
            aria-label="A week earlier"
            onClick={() => setWeekShift((w) => w - 1)}
          >
            <Icon name="chevL" size={15} />
          </button>
          {weekShift !== 0 && (
            <button className="pbtn ghost" onClick={() => setWeekShift(0)}>
              Today
            </button>
          )}
          <button
            className="pbtn ghost"
            aria-label="A week later"
            onClick={() => setWeekShift((w) => w + 1)}
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
                (c.iso === today ? " today" : "")
              }
              data-tone={tone}
              aria-label={`Open ${c.iso}`}
              onClick={() => onDay(c.iso)}
            >
              <span className="wb2-mcn">
                {parseInt(c.iso.slice(8, 10), 10)}
                {(c.iso === today || c.iso.slice(8, 10) === "01") && (
                  <em>{c.iso === today ? "Today" : monthWord(c.iso)}</em>
                )}
              </span>
              {settled ? (
                <span className="wb2-mcdone" aria-label="All closed">
                  <Icon name="check" size={13} />
                </span>
              ) : (
                c.dayVisits.length > 0 && (
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
