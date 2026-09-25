"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
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
import { CalSwatch, type Pick } from "./home-cal-parts";

/* MONTH (his handoff "Calendar"): Monday first, the weekend columns at
   0.55, the month's whole weeks. Anything over days is a bar in its lane
   across the week (`monthWeeks`, lib/calendar/model: school holidays take
   the lanes first); a public holiday's name sits in its date row, which
   picks it; a one-day event or admin date sits in its day. A bar that
   carries on from last week or into the next is square on that side.

   OPENS ON TODAY'S WEEK. Under "Your day" the grid has room for about two
   weeks, so the month's first rows would hide today: when today is in the
   month, its week is brought to the top of the grid. The grid can still be
   settling as it draws (the day's card opening above it, or the face
   coming back into view), so the week is held there until you move the
   grid yourself. */

const DAY_HEAD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const flex = (column: number): CSSProperties => ({ flex: `${MONTH_WEIGHTS[column]} 1 0px` });

type Picks = { selected: string | null; fresh: string | null; onPick: Pick };

export function CalMonth({
  weeks,
  anchor,
  selected,
  fresh,
  onPick,
}: {
  weeks: MonthWeek<CalItem>[];
  /** The month on view, so a step to another month brings its own top. */
  anchor: string;
} & Picks) {
  const grid = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const sc = grid.current;
    if (!sc) return;
    const fit = () => {
      const wk = sc.querySelector<HTMLElement>(".hd-cal-wk[data-today]");
      sc.scrollTop = wk ? wk.offsetTop : 0;
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
            <Cell key={c.day} cell={c} lanes={w.lanes} selected={selected} fresh={fresh} onPick={onPick} />
          ))}
          {w.bars.map((b) => (
            <Bar key={b.item.id} bar={b} selected={selected} onPick={onPick} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Cell({ cell: c, lanes, selected, fresh, onPick }: { cell: MonthCell<CalItem>; lanes: number } & Picks) {
  const hol = c.holiday;
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
  return (
    <div
      className="hd-cal-mc"
      style={flex(c.column)}
      data-weekend={c.weekend && !hol ? "" : undefined}
      data-narrow={c.column >= 5 ? "" : undefined}
      data-holiday={hol ? "" : undefined}
      data-out={c.inMonth ? undefined : ""}
      data-last={c.column === 6 ? "" : undefined}
    >
      <div className="hd-cal-in">
        {hol ? (
          <button
            type="button"
            className="hd-cal-dr"
            aria-pressed={hol.id === selected}
            aria-label={`${fmtDay(c.day)}: ${hol.title}`}
            title={hol.title}
            onClick={(e) => onPick(hol.id, e.detail > 0)}
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
                data-fresh={m.item.id === fresh ? "" : undefined}
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
function Bar({ bar: b, selected, onPick }: { bar: MonthBar<CalItem> } & Omit<Picks, "fresh">) {
  const name = `${b.item.title}, ${fmtDayRange(b.item.start, b.item.end)}`;
  return (
    <button
      type="button"
      className="hd-cal-bar"
      data-kind={b.kind}
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
