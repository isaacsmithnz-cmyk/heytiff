"use client";

import { useLayoutEffect, useRef, type CSSProperties, type MouseEvent } from "react";
import type { CalItem } from "@/lib/calendar/items";
import {
  MONTH_WEIGHTS,
  barTop,
  fmtDay,
  fmtDayRange,
  laneReserve,
  type MonthBar,
  type MonthCell,
  type MonthWeek,
} from "@/lib/calendar/model";
import { CalSwatch, OWN_THING, type Pick, type PickDay } from "./home-cal-parts";

/* MONTH (his handoff "Calendar"): Monday first, the weekend columns at
   0.55, the month's whole weeks. Anything over days is a bar in its lane
   across the week (`monthWeeks`, lib/calendar/model: school holidays take
   the lanes first); a public holiday's name sits in its date row; a
   one-day event or admin date sits in its day. A bar that carries on from
   last week or into the next is square on that side.

   A DAY IS PICKED BY A PRESS ANYWHERE IN ITS CELL but on one of its things
   (Isaac, 2026-09-26: "if you go into the month view, you can't click on
   the day for it to show up on the right"): the panel then shows the day
   and everything on it, and the box over the panel adds to it. Its date
   row is the day's button, on every day of the twelve months, for the
   keyboard, pressed while the day is the one chosen, or the holiday it
   names; a holiday's date row picks its day, which lists the holiday. A
   thing or a bar picks itself.
   The first month's and the last month's whole weeks reach past the twelve
   months, and those days are not the calendar's to pick.

   OPENS ON TODAY'S WEEK. Under "Your day" the grid has room for about two
   weeks, so the month's first rows could hide today: a month opens at its
   top, and when today is in it and its week is not wholly in sight, that
   week is brought to the top of the grid (his calToWeek). A week already
   in sight is left where it is, with the days' heads above it. The grid
   can still be settling as it draws (the day's card opening above it, or
   the face coming back into view), so the grid is measured again as it
   settles: a week that falls out of sight is brought up then, and one
   brought up is held there, until you move the grid yourself. */

const DAY_HEAD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const flex = (column: number): CSSProperties => ({ flex: `${MONTH_WEIGHTS[column]} 1 0px` });

type Picks = {
  selected: string | null;
  /** The day chosen, when the choice is a day. */
  day: string | null;
  fresh: readonly string[] | null;
  onPick: Pick;
  onPickDay: PickDay;
};

export function CalMonth({
  weeks,
  anchor,
  selected,
  day,
  fresh,
  onPick,
  onPickDay,
}: {
  weeks: MonthWeek<CalItem>[];
  /** The month on view, so a step to another month brings its own top. */
  anchor: string;
} & Picks) {
  const grid = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const sc = grid.current;
    if (!sc) return;
    sc.scrollTop = 0;
    const wk = sc.querySelector<HTMLElement>(".hd-cal-wk[data-today]");
    if (!wk) return;
    /** Where today's week was brought to, once it had to be. */
    let want: number | null = null;
    const fit = () => {
      if (want !== null) {
        sc.scrollTop = want;
        return;
      }
      const r = wk.getBoundingClientRect();
      const s = sc.getBoundingClientRect();
      if (r.top < s.top - 1 || r.bottom > s.bottom + 1) {
        want = sc.scrollTop + (r.top - s.top);
        sc.scrollTop = want;
      }
    };
    fit();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(fit);
    ro.observe(sc);
    const stop = () => ro.disconnect();
    const moves = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
    for (const m of moves) sc.addEventListener(m, stop, { once: true, passive: true });
    return () => {
      ro.disconnect();
      for (const m of moves) sc.removeEventListener(m, stop);
    };
  }, [anchor]);

  return (
    <div className="hd-cal-mg" data-scroll="" ref={grid}>
      <div className="hd-cal-mh" aria-hidden="true">
        {DAY_HEAD.map((d, i) => (
          <div key={d} style={flex(i)}>
            <span>{d}</span>
          </div>
        ))}
      </div>
      {weeks.map((w) => (
        <div key={w.key} className="hd-cal-wk" data-today={w.cells.some((c) => c.today) ? "" : undefined}>
          {w.cells.map((c) => (
            <Cell
              key={c.day}
              cell={c}
              lanes={w.lanes}
              selected={selected}
              day={day}
              fresh={fresh}
              onPick={onPick}
              onPickDay={onPickDay}
            />
          ))}
          {w.bars.map((b) => (
            <Bar key={b.item.id} bar={b} selected={selected} onPick={onPick} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Cell({
  cell: c,
  lanes,
  selected,
  day,
  fresh,
  onPick,
  onPickDay,
}: { cell: MonthCell<CalItem>; lanes: number } & Picks) {
  const hol = c.holiday;
  const pickable = c.inWindow;
  /* Pressed while the day is the one chosen, or the holiday it names is,
     as Year's day is while the thing that leads it is. */
  const on = pickable && (c.day === day || (hol !== null && hol.id === selected));
  const row = (
    <>
      <span className="hd-cal-drn">{c.date}</span>
      {c.label && (
        <span className="hd-cal-drm" data-kind={c.labelKind ?? undefined}>
          {c.label}
        </span>
      )}
    </>
  );
  /* A press in the cell that is not on one of its things or their
     controls — the date row picks the day itself, from the keyboard too. */
  const onCell = (e: MouseEvent<HTMLDivElement>) => {
    if (!pickable) return;
    const hit = (e.target as Element).closest(OWN_THING);
    if (hit && e.currentTarget.contains(hit)) return;
    onPickDay(c.day, true);
  };
  return (
    <div
      className="hd-cal-mc"
      style={flex(c.column)}
      data-weekend={c.weekend && !hol ? "" : undefined}
      data-narrow={c.column >= 5 ? "" : undefined}
      data-holiday={hol ? "" : undefined}
      data-out={c.inMonth ? undefined : ""}
      data-last={c.column === 6 ? "" : undefined}
      data-pick={pickable ? "" : undefined}
      data-picked={on ? "" : undefined}
      onClick={onCell}
    >
      <div className="hd-cal-in">
        {pickable ? (
          <button
            type="button"
            className="hd-cal-dr"
            aria-pressed={on}
            aria-label={hol ? `${fmtDay(c.day)}: ${hol.title}` : fmtDay(c.day)}
            aria-current={c.today ? "date" : undefined}
            title={hol?.title}
            onClick={(e) => onPickDay(c.day, e.detail > 0)}
          >
            {row}
          </button>
        ) : (
          <div className="hd-cal-dr">{row}</div>
        )}
        {/* the room the week's bars run through */}
        {lanes > 0 && <div style={{ height: laneReserve(lanes) }} />}
        {c.items.length > 0 && (
          <div className="hd-cal-its">
            {c.items.map((m) => (
              <button
                key={m.item.id}
                type="button"
                className="hd-cal-mi"
                data-c={m.item.cat}
                data-late={m.overdue ? "" : undefined}
                data-fresh={fresh?.includes(m.item.id) ? "" : undefined}
                aria-pressed={m.item.id === selected}
                aria-label={`${fmtDay(c.day)}: ${m.title}${m.meta ? `, ${m.meta}` : ""}`}
                title={m.meta ? `${m.title}, ${m.meta}` : m.title}
                onClick={(e) => onPick(m.item.id, e.detail > 0)}
              >
                <CalSwatch cat={m.item.cat} late={m.overdue} />
                <span className="hd-cal-mit">
                  <span className="hd-cal-mtt">{m.title}</span>
                  {m.meta && <span className="hd-cal-mtm">{m.meta}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** A bar over its days in the week. Where it stands is the model's
    geometry, and stays inline; how it looks is the sheet's. */
function Bar({ bar: b, selected, onPick }: { bar: MonthBar<CalItem>; selected: string | null; onPick: Pick }) {
  const name = `${b.item.title}, ${fmtDayRange(b.item.start, b.item.end)}`;
  return (
    <button
      type="button"
      className="hd-cal-bar"
      data-kind={b.kind}
      data-c={b.item.cat}
      data-before={b.continuesBefore ? "" : undefined}
      data-after={b.continuesAfter ? "" : undefined}
      aria-pressed={b.item.id === selected}
      aria-label={name}
      title={name}
      style={{
        left: `calc(${b.left.toFixed(3)}% + 4px)`,
        width: `calc(${b.width.toFixed(3)}% - 8px)`,
        top: barTop(b.lane),
      }}
      onClick={(e) => onPick(b.item.id, e.detail > 0)}
    >
      <span className="hd-cal-barl">{b.item.title}</span>
    </button>
  );
}
